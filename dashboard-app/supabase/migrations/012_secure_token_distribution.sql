-- Phase 1 Task 4: secure token distribution and affiliate payouts.
-- Forward-only, data-preserving. Existing distributed rewards and their
-- transaction hashes are left untouched.

-- -----------------------------------------------------------------------------
-- Durable payout operations for idempotent, auditable, reconciliable airdrops.
-- token_amount_raw is the exact integer number of smallest token units
-- (e.g., lamports for 9-decimal tokens). Floating-point arithmetic is not used
-- for on-chain amounts.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payout_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operation_id TEXT NOT NULL UNIQUE,
  reward_period_id UUID NOT NULL REFERENCES public.reward_periods(id),
  reward_id UUID NOT NULL REFERENCES public.user_rewards(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  wallet_address TEXT NOT NULL,
  token_amount_raw BIGINT NOT NULL,
  token_decimals INTEGER NOT NULL DEFAULT 9,
  status TEXT NOT NULL DEFAULT 'pending',
  transaction_hash TEXT,
  signed_transaction_base58 TEXT,
  last_blockhash TEXT,
  submission_error TEXT,
  cancellation_reason TEXT,
  blockchain_confirmation JSONB,
  actor_id UUID,
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  uncertain_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payout_operations'::regclass
      AND conname = 'payout_operations_status_check'
  ) THEN
    ALTER TABLE public.payout_operations
      ADD CONSTRAINT payout_operations_status_check
      CHECK (status IN ('pending', 'submitting', 'submitted', 'uncertain', 'confirmed', 'failed', 'cancelled')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payout_operations_period_status
  ON public.payout_operations (reward_period_id, status);
CREATE INDEX IF NOT EXISTS idx_payout_operations_reward
  ON public.payout_operations (reward_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_operations_tx
  ON public.payout_operations (transaction_hash);

-- -----------------------------------------------------------------------------
-- Reward period status guard. Status must follow the lifecycle
-- pending -> calculating -> approved -> distributed. NOT VALID preserves any
-- legacy rows that do not match; new/changed rows are enforced.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reward_periods'::regclass
      AND conname = 'reward_periods_status_check'
  ) THEN
    ALTER TABLE public.reward_periods
      ADD CONSTRAINT reward_periods_status_check
      CHECK (status IN ('pending', 'calculating', 'approved', 'distributed')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.payout_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payout_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payout_operations TO service_role;

DROP POLICY IF EXISTS "Payout operations admin read" ON public.payout_operations;
CREATE POLICY "Payout operations admin read"
  ON public.payout_operations FOR SELECT TO authenticated
  USING (public.is_active_admin());

-- Members can read their own payout operations via service-role aggregations;
-- direct authenticated SELECT is admin-only.

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
-- Audit trigger for payout operation state changes.
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
  -- Fail closed for financial operations: if we cannot record an audit log of
  -- a payout state change, the state change itself must not succeed. This
  -- prevents a payout from silently mutating without a durable record.
  RAISE EXCEPTION 'payout audit logging failed: %', SQLERRM;
END;
$$;

ALTER FUNCTION public.write_payout_audit_trigger() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.write_payout_audit_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_payout_operations ON public.payout_operations;
CREATE TRIGGER audit_payout_operations
  AFTER INSERT OR UPDATE OR DELETE ON public.payout_operations
  FOR EACH ROW EXECUTE FUNCTION public.write_payout_audit_trigger();

-- -----------------------------------------------------------------------------
-- Prevent silently rewriting a confirmed payout operation. Confirmed operations
-- are immutable; any correction requires a new operation or explicit reversal.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_confirmed_payout_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Confirmed payout records are entirely immutable. No field may change once
  -- the operation has reached its final on-chain verified state.
  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'confirmed payout operations are immutable';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.prevent_confirmed_payout_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_confirmed_payout_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_confirmed_payout_mutation ON public.payout_operations;
CREATE TRIGGER prevent_confirmed_payout_mutation
  BEFORE UPDATE ON public.payout_operations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_confirmed_payout_mutation();
