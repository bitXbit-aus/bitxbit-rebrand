-- Phase 1 payout incident state.
-- Forward-only migration that adds a non-retryable 'incident' status for confirmed
-- on-chain transactions that fail recipient/amount verification. Incidents require
-- manual investigation and must not be automatically retried.

-- -----------------------------------------------------------------------------
-- Timestamp for when an operation entered the incident state.
-- -----------------------------------------------------------------------------
ALTER TABLE public.payout_operations
  ADD COLUMN IF NOT EXISTS incident_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- Expand the status check to include 'incident'. An incident is a confirmed
-- on-chain outcome that does not match the expected payout; it is non-retryable
-- and requires explicit investigation or controlled replacement.
-- -----------------------------------------------------------------------------
ALTER TABLE public.payout_operations
  DROP CONSTRAINT IF EXISTS payout_operations_status_check;

ALTER TABLE public.payout_operations
  ADD CONSTRAINT payout_operations_status_check
  CHECK (status IN ('pending', 'submitting', 'submitted', 'uncertain', 'confirmed', 'failed', 'cancelled', 'incident')) NOT VALID;

-- -----------------------------------------------------------------------------
-- Atomic claiming of a payout operation before on-chain submission.
-- Only 'pending' and 'failed' operations are retryable. Incident, confirmed,
-- submitted, uncertain, submitting, and cancelled operations are non-retryable
-- through this path.
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
-- Prevent silently rewriting a confirmed or incident payout operation.
-- Both confirmed and incident records are immutable financial history; any
-- correction requires a new operation or explicit controlled reversal.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_confirmed_payout_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status IN ('confirmed', 'incident') THEN
    RAISE EXCEPTION '% payout operations are immutable', OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.prevent_confirmed_payout_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_confirmed_payout_mutation() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Reward corrections must not recalculate periods with incident payouts.
-- An incident is a confirmed on-chain mismatch and is non-retryable; it must be
-- investigated before the period can be corrected.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_reward_correction(
  p_period_id UUID,
  p_reason TEXT,
  p_new_rewards JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_correction_id UUID := uuid_generate_v4();
  v_inserted_count INT := 0;
  v_superseded_count INT := 0;
  v_cancelled_count INT := 0;
  v_period_status TEXT;
BEGIN
  IF p_period_id IS NULL OR p_reason IS NULL OR p_reason = '' THEN
    RAISE EXCEPTION 'period and reason are required';
  END IF;

  SELECT status INTO v_period_status
  FROM public.reward_periods
  WHERE id = p_period_id;

  IF v_period_status IS NULL THEN
    RAISE EXCEPTION 'period not found';
  END IF;
  IF v_period_status = 'distributed' THEN
    RAISE EXCEPTION 'cannot correct a distributed period';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payout_operations
    WHERE reward_period_id = p_period_id
      AND status IN ('submitting', 'submitted', 'uncertain', 'confirmed', 'incident')
  ) THEN
    RAISE EXCEPTION 'period has non-recalculable payouts';
  END IF;

  UPDATE public.payout_operations
  SET status = 'cancelled',
      cancellation_reason = 'Cancelled during reward correction: ' || p_reason,
      updated_at = NOW()
  WHERE reward_period_id = p_period_id
    AND status IN ('pending', 'failed');
  GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;

  UPDATE public.user_rewards
  SET status = 'superseded',
      superseded_at = NOW(),
      superseded_by_correction_id = v_correction_id,
      correction_reason = p_reason
  WHERE reward_period_id = p_period_id
    AND superseded_at IS NULL;
  GET DIAGNOSTICS v_superseded_count = ROW_COUNT;

  UPDATE public.reward_periods
  SET status = 'pending', total_income = 0
  WHERE id = p_period_id;

  INSERT INTO public.user_rewards (
    user_id,
    reward_period_id,
    estimated_aud_value,
    bitxbit_amount,
    status,
    version
  )
  SELECT
    (r->>'user_id')::UUID,
    p_period_id,
    (r->>'estimated_aud_value')::DECIMAL(12,2),
    (r->>'bitxbit_amount')::DECIMAL(18,8),
    'pending',
    COALESCE((
      SELECT MAX(version)
      FROM public.user_rewards
      WHERE reward_period_id = p_period_id
        AND user_id = (r->>'user_id')::UUID
    ), 0) + 1
  FROM jsonb_array_elements(p_new_rewards) AS r;
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'correction_id', v_correction_id,
    'cancelled_payouts', v_cancelled_count,
    'superseded_rewards', v_superseded_count,
    'inserted_rewards', v_inserted_count
  );
END;
$$;

ALTER FUNCTION public.apply_reward_correction(UUID, TEXT, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_reward_correction(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_reward_correction(UUID, TEXT, JSONB) TO service_role;