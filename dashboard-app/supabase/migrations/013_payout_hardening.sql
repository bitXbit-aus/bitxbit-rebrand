-- Phase 1 payout hardening upgrade.
-- Forward-only migration that upgrades payout_operations from the baseline
-- created by 012_secure_token_distribution.sql. Safe to re-run.

-- -----------------------------------------------------------------------------
-- Additional columns to make payout submission durable and auditable.
-- signed_transaction_base58 preserves the signed transaction before broadcast
-- so an uncertain submission can be reconciled without resubmission.
-- last_blockhash captures the blockhash used to sign the transaction.
-- cancellation_reason records why a payout was cancelled while preserving the
-- historical record.
-- uncertain_at records when an operation entered the non-retryable uncertain
-- state (broadcast occurred but settlement could not be confirmed).
-- -----------------------------------------------------------------------------
ALTER TABLE public.payout_operations
  ADD COLUMN IF NOT EXISTS signed_transaction_base58 TEXT,
  ADD COLUMN IF NOT EXISTS last_blockhash TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS uncertain_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- Expand the status check to include 'uncertain'. An uncertain operation is one
-- where broadcast likely occurred but on-chain settlement could not be verified;
-- it is non-retryable and must be reconciled against reliable chain evidence.
-- Drop and recreate the constraint so existing databases that already have the
-- old constraint from 012 are upgraded reliably.
-- -----------------------------------------------------------------------------
ALTER TABLE public.payout_operations
  DROP CONSTRAINT IF EXISTS payout_operations_status_check;

ALTER TABLE public.payout_operations
  ADD CONSTRAINT payout_operations_status_check
  CHECK (status IN ('pending', 'submitting', 'submitted', 'uncertain', 'confirmed', 'failed', 'cancelled')) NOT VALID;

-- -----------------------------------------------------------------------------
-- Atomic claiming of a payout operation before on-chain submission.
-- Only one process can claim a pending/failed operation. Once an operation has
-- entered submitting, submitted, uncertain, or confirmed it is non-retryable
-- through this path; it must be reconciled against on-chain evidence or handled
-- by an explicit controlled replacement flow. Concurrent callers receive NULL.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_payout_operation(
  p_operation_id TEXT,
  p_actor_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  op_id UUID;
BEGIN
  IF p_operation_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'invalid claim parameters';
  END IF;

  SELECT id INTO op_id
  FROM public.payout_operations
  WHERE operation_id = p_operation_id
    AND status IN ('pending', 'failed')
  FOR UPDATE SKIP LOCKED;

  IF op_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.payout_operations
  SET status = 'submitting',
      actor_id = p_actor_id,
      submission_error = NULL,
      updated_at = NOW()
  WHERE id = op_id;

  RETURN op_id;
END;
$$;

ALTER FUNCTION public.claim_payout_operation(TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_payout_operation(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payout_operation(TEXT, UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- Fail-closed audit trigger for payout operation state changes.
-- If the audit log cannot be written, the state change itself must not succeed.
-- This prevents a payout from silently mutating without a durable record.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_payout_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_row JSONB;
  new_row JSONB;
  target_row JSONB;
  request_headers JSONB;
BEGIN
  old_row := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  new_row := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  target_row := COALESCE(new_row, old_row, '{}'::JSONB);

  BEGIN
    request_headers := NULLIF(current_setting('request.headers', TRUE), '')::JSONB;
  EXCEPTION WHEN OTHERS THEN
    request_headers := '{}'::JSONB;
  END;

  INSERT INTO public.security_audit_log (
    actor_id,
    actor_role,
    actor_status,
    action,
    target_table,
    target_id,
    before_data,
    after_data,
    metadata,
    request_id,
    success
  )
  VALUES (
    auth.uid(),
    NULL,
    NULL,
    'payout_operation.' || lower(TG_OP),
    'public.payout_operations',
    target_row->>'id',
    old_row,
    new_row,
    jsonb_build_object('operation_id', target_row->>'operation_id', 'status', target_row->>'status'),
    COALESCE(
      request_headers->>'x-request-id',
      request_headers->>'x-correlation-id'
    ),
    TRUE
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'payout audit logging failed: %', SQLERRM;
END;
$$;

ALTER FUNCTION public.write_payout_audit_trigger() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.write_payout_audit_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_payout_operations ON public.payout_operations;
CREATE TRIGGER audit_payout_operations
  AFTER INSERT OR UPDATE OR DELETE ON public.payout_operations
  FOR EACH ROW EXECUTE FUNCTION public.write_payout_audit_trigger();
