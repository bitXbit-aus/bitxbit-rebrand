-- Phase 1: coordinate reward corrections and payout claims.
-- The atomic correction RPC previously checked for in-flight payouts and then
-- cancelled safe ones, but it did not serialize with the separate claim path.
-- A concurrent claim could move a pending payout to 'submitting' after the
-- correction's eligibility check but before it cancelled/superseded rewards.
-- This migration adds a transaction-scoped advisory lock keyed by period ID to
-- both `claim_payout_operation()` and `apply_reward_correction()`, so all
-- period-scoped payout mutations are serialised and the eligibility check is
-- rechecked while holding the lock.

-- -----------------------------------------------------------------------------
-- Atomic claiming of a payout operation. Now acquires a period-wide advisory
-- lock so that reward corrections cannot interleave between the eligibility
-- check and the state change.
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
  v_period_id UUID;
BEGIN
  IF p_operation_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'invalid claim parameters';
  END IF;

  -- Look up the period first so we can acquire the period-wide lock. The actual
  -- operation row is locked after this, once the period lock is held.
  SELECT reward_period_id INTO v_period_id
  FROM public.payout_operations
  WHERE operation_id = p_operation_id;

  IF v_period_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(0, hashtext(v_period_id::text));
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
-- Atomic reward correction. Acquires the same period-wide advisory lock before
-- rechecking eligibility, so it cannot race with a concurrent claim.
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

  -- Serialize all period-scoped mutation: corrections, claims, and recalculations
  -- contend for the same advisory lock. This recheck happens inside the lock.
  PERFORM pg_advisory_xact_lock(0, hashtext(p_period_id::text));

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

-- -----------------------------------------------------------------------------
-- Reward recalculation should also contend for the same period lock, preventing
-- a claim from starting while the active reward set is being replaced.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_reward_calculation(
  p_period_id UUID,
  p_total_income DECIMAL(12,2),
  p_new_rewards JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_period_status TEXT;
  v_operation_count INT;
  v_inserted_count INT := 0;
  v_superseded_count INT := 0;
BEGIN
  IF p_period_id IS NULL OR p_new_rewards IS NULL OR jsonb_array_length(p_new_rewards) = 0 THEN
    RAISE EXCEPTION 'period and rewards are required';
  END IF;

  PERFORM pg_advisory_xact_lock(0, hashtext(p_period_id::text));

  SELECT status INTO v_period_status
  FROM public.reward_periods
  WHERE id = p_period_id;

  IF v_period_status IS NULL THEN
    RAISE EXCEPTION 'period not found';
  END IF;
  IF v_period_status IN ('approved', 'distributed') THEN
    RAISE EXCEPTION 'cannot recalculate an approved or distributed period';
  END IF;

  SELECT COUNT(*) INTO v_operation_count
  FROM public.payout_operations
  WHERE reward_period_id = p_period_id;

  IF v_operation_count > 0 THEN
    RAISE EXCEPTION 'period already has payout operations';
  END IF;

  DELETE FROM public.user_rewards
  WHERE reward_period_id = p_period_id
    AND superseded_at IS NULL;
  GET DIAGNOSTICS v_superseded_count = ROW_COUNT;

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

  UPDATE public.reward_periods
  SET status = 'calculating',
      total_income = p_total_income
  WHERE id = p_period_id;

  RETURN jsonb_build_object(
    'superseded_rewards', v_superseded_count,
    'inserted_rewards', v_inserted_count
  );
END;
$$;

ALTER FUNCTION public.apply_reward_calculation(UUID, DECIMAL(12,2), JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_reward_calculation(UUID, DECIMAL(12,2), JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_reward_calculation(UUID, DECIMAL(12,2), JSONB) TO service_role;
