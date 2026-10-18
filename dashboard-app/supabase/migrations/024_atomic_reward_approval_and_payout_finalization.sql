-- Phase 1: atomically approve reward periods and finalize confirmed payouts.
--
-- These functions close two partial-commit windows:
--   1. Reward approval previously updated user_rewards and reward_periods through
--      separate PostgREST calls without the shared period advisory lock.
--   2. Payout confirmation previously made payout_operations immutable before
--      updating the exact user_rewards row, allowing a confirmed operation to
--      coexist with an approved reward after a later write failure.

-- -----------------------------------------------------------------------------
-- Atomic, period-locked reward approval.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_reward_period(
  p_period_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_period_status TEXT;
  v_approved_count INT := 0;
  v_period_update_count INT := 0;
BEGIN
  IF p_period_id IS NULL THEN
    RAISE EXCEPTION 'period is required';
  END IF;

  -- Serialize approval with calculation, correction, and payout claiming.
  PERFORM pg_advisory_xact_lock(0, hashtext(p_period_id::text));

  SELECT status INTO v_period_status
  FROM public.reward_periods
  WHERE id = p_period_id
  FOR UPDATE;

  IF v_period_status IS NULL THEN
    RAISE EXCEPTION 'period not found';
  END IF;
  IF v_period_status IS DISTINCT FROM 'calculating' THEN
    RAISE EXCEPTION 'period is not awaiting approval (status %)', v_period_status;
  END IF;

  -- Every active reward must still be pending. A mixed state indicates a prior
  -- partial transition and must be reconciled rather than silently approved.
  IF EXISTS (
    SELECT 1
    FROM public.user_rewards
    WHERE reward_period_id = p_period_id
      AND superseded_at IS NULL
      AND status IS DISTINCT FROM 'pending'
  ) THEN
    RAISE EXCEPTION 'period has active rewards outside pending state';
  END IF;

  UPDATE public.user_rewards
  SET status = 'approved'
  WHERE reward_period_id = p_period_id
    AND superseded_at IS NULL
    AND status = 'pending';
  GET DIAGNOSTICS v_approved_count = ROW_COUNT;

  UPDATE public.reward_periods
  SET status = 'approved'
  WHERE id = p_period_id
    AND status = 'calculating';
  GET DIAGNOSTICS v_period_update_count = ROW_COUNT;

  IF v_period_update_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'period approval transition affected % rows', v_period_update_count;
  END IF;

  RETURN jsonb_build_object(
    'period_id', p_period_id,
    'period_status', 'approved',
    'approved_rewards', v_approved_count
  );
END;
$$;

ALTER FUNCTION public.approve_reward_period(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_reward_period(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_reward_period(UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- Atomic payout finalization.
--
-- The RPC accepts a previously verified on-chain confirmation payload. It locks
-- the payout period, transitions submitted/uncertain operations to confirmed,
-- updates the exact reward row in the same transaction, and marks the period
-- distributed only when every active reward has a confirmed payout. Calling the
-- RPC for an already-confirmed operation repairs legacy partial commits without
-- attempting to mutate the immutable payout row.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_payout_confirmation(
  p_operation_id TEXT,
  p_blockchain_confirmation JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_period_id UUID;
  v_operation public.payout_operations%ROWTYPE;
  v_reward_update_count INT := 0;
  v_period_distributed BOOLEAN := FALSE;
BEGIN
  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' THEN
    RAISE EXCEPTION 'operation id is required';
  END IF;

  -- Read only the period key first, then re-read and lock the operation after
  -- acquiring the shared period advisory lock.
  SELECT reward_period_id INTO v_period_id
  FROM public.payout_operations
  WHERE operation_id = p_operation_id;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'normal payout operation not found';
  END IF;

  PERFORM pg_advisory_xact_lock(0, hashtext(v_period_id::text));

  SELECT * INTO v_operation
  FROM public.payout_operations
  WHERE operation_id = p_operation_id
  FOR UPDATE;

  IF v_operation.id IS NULL OR v_operation.reward_period_id IS DISTINCT FROM v_period_id THEN
    RAISE EXCEPTION 'payout operation changed during finalization';
  END IF;
  IF v_operation.is_test IS TRUE OR v_operation.reward_id IS NULL THEN
    RAISE EXCEPTION 'test payout operations require the test finalization path';
  END IF;
  IF v_operation.transaction_hash IS NULL OR btrim(v_operation.transaction_hash) = '' THEN
    RAISE EXCEPTION 'payout operation has no transaction hash';
  END IF;
  IF v_operation.status NOT IN ('submitted', 'uncertain', 'confirmed') THEN
    RAISE EXCEPTION 'payout operation is not finalizable (status %)', v_operation.status;
  END IF;

  IF v_operation.status IS DISTINCT FROM 'confirmed' THEN
    IF p_blockchain_confirmation IS NULL THEN
      RAISE EXCEPTION 'blockchain confirmation is required';
    END IF;

    UPDATE public.payout_operations
    SET status = 'confirmed',
        confirmed_at = COALESCE(confirmed_at, NOW()),
        blockchain_confirmation = p_blockchain_confirmation,
        submission_error = NULL,
        updated_at = NOW()
    WHERE id = v_operation.id
      AND status IN ('submitted', 'uncertain');

    IF NOT FOUND THEN
      RAISE EXCEPTION 'payout operation confirmation transition failed';
    END IF;
  END IF;

  -- Update the exact reward referenced by the immutable payout operation. The
  -- already-distributed case is idempotent; any other state is unsafe.
  UPDATE public.user_rewards
  SET status = 'distributed',
      distribution_tx_hash = v_operation.transaction_hash,
      distributed_at = COALESCE(distributed_at, NOW())
  WHERE id = v_operation.reward_id
    AND reward_period_id = v_period_id
    AND status IN ('approved', 'distributed');
  GET DIAGNOSTICS v_reward_update_count = ROW_COUNT;

  IF v_reward_update_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'exact payout reward is missing or not distributable';
  END IF;

  -- A period is complete only when it has at least one active reward, every
  -- active reward is distributed, and each active reward is backed by a
  -- confirmed payout operation.
  IF EXISTS (
    SELECT 1
    FROM public.user_rewards
    WHERE reward_period_id = v_period_id
      AND superseded_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_rewards r
    WHERE r.reward_period_id = v_period_id
      AND r.superseded_at IS NULL
      AND (
        r.status IS DISTINCT FROM 'distributed'
        OR NOT EXISTS (
          SELECT 1
          FROM public.payout_operations p
          WHERE p.reward_period_id = v_period_id
            AND p.reward_id = r.id
            AND p.status = 'confirmed'
        )
      )
  ) THEN
    UPDATE public.reward_periods
    SET status = 'distributed'
    WHERE id = v_period_id
      AND status = 'approved';
  END IF;

  SELECT status = 'distributed' INTO v_period_distributed
  FROM public.reward_periods
  WHERE id = v_period_id;

  RETURN jsonb_build_object(
    'operation_id', p_operation_id,
    'operation_status', 'confirmed',
    'reward_id', v_operation.reward_id,
    'reward_status', 'distributed',
    'period_id', v_period_id,
    'period_distributed', COALESCE(v_period_distributed, FALSE)
  );
END;
$$;

ALTER FUNCTION public.finalize_payout_confirmation(TEXT, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_payout_confirmation(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_payout_confirmation(TEXT, JSONB) TO service_role;
