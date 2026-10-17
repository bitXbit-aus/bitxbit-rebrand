-- Phase 1: strengthen create_or_claim_payout_operation() by re-checking the
-- current verified wallet, period status, and expected recipient while holding
-- the period lock.
--
-- The previous version verified the reward's approval/supersession status and
-- amount, but it trusted the wallet address supplied by the application. Between
-- the application's eligibility check and the locked database transaction, a
-- user could verify a different wallet or an administrator could change the
-- period status. This migration updates the function to re-read and validate:
--   1. the reward period is still 'approved',
--   2. the requested user still exists with a verified wallet,
--   3. the supplied payout address exactly matches the verified wallet.

-- -----------------------------------------------------------------------------
-- Atomic creation or claiming of a payout operation for an active reward,
-- with independent re-verification of the destination wallet and period status.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_or_claim_payout_operation(
  p_period_id UUID,
  p_reward_id UUID,
  p_user_id UUID,
  p_wallet_address TEXT,
  p_amount_raw BIGINT,
  p_token_decimals INT,
  p_actor_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_period RECORD;
  v_user RECORD;
  v_reward RECORD;
  v_existing public.payout_operations%ROWTYPE;
  v_operation_id TEXT;
  v_expected_raw BIGINT;
BEGIN
  IF p_period_id IS NULL OR p_reward_id IS NULL OR p_user_id IS NULL OR p_wallet_address IS NULL OR p_amount_raw IS NULL OR p_token_decimals IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'all parameters are required';
  END IF;

  -- Serialize with reward corrections and any other claimers on this period.
  PERFORM pg_advisory_xact_lock(0, hashtext(p_period_id::text));

  -- Re-verify the period is still approved for distribution.
  SELECT id, status INTO v_period
  FROM public.reward_periods
  WHERE id = p_period_id;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'period not found';
  END IF;
  IF v_period.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'period is not approved for payout (status %)', v_period.status;
  END IF;

  -- Re-verify the recipient still has a verified wallet and it matches the
  -- supplied payout address.
  SELECT wallet_address, wallet_verified INTO v_user
  FROM public.users
  WHERE id = p_user_id;

  IF v_user.wallet_address IS NULL OR v_user.wallet_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'user does not have a verified wallet';
  END IF;
  IF v_user.wallet_address IS DISTINCT FROM p_wallet_address THEN
    RAISE EXCEPTION 'wallet address does not match verified wallet';
  END IF;

  -- Re-verify the reward is still approved, active, and matches the request.
  SELECT id, user_id, bitxbit_amount, status, superseded_at
  INTO v_reward
  FROM public.user_rewards
  WHERE id = p_reward_id
    AND reward_period_id = p_period_id;

  IF v_reward.id IS NULL THEN
    RAISE EXCEPTION 'reward not found';
  END IF;
  IF v_reward.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'reward has been superseded';
  END IF;
  IF v_reward.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'reward is not approved (status %)', v_reward.status;
  END IF;
  IF v_reward.user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'reward recipient mismatch';
  END IF;

  v_expected_raw := (v_reward.bitxbit_amount * (10 ^ p_token_decimals))::BIGINT;
  IF v_expected_raw IS DISTINCT FROM p_amount_raw THEN
    RAISE EXCEPTION 'reward amount mismatch: expected %, got %', v_expected_raw, p_amount_raw;
  END IF;

  v_operation_id := 'payout:' || p_period_id::text || ':' || p_reward_id::text;

  -- Lock any existing operation for this reward to serialise concurrent claims.
  SELECT * INTO v_existing
  FROM public.payout_operations
  WHERE operation_id = v_operation_id
    AND reward_period_id = p_period_id
    AND reward_id = p_reward_id
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status NOT IN ('pending', 'failed') THEN
      RAISE EXCEPTION 'existing payout operation is not claimable (status %)', v_existing.status;
    END IF;

    UPDATE public.payout_operations
    SET status = 'submitting',
        actor_id = p_actor_id,
        wallet_address = p_wallet_address,
        token_amount_raw = p_amount_raw,
        submission_error = NULL,
        updated_at = NOW()
    WHERE id = v_existing.id;

    RETURN v_operation_id;
  END IF;

  -- No existing operation: insert one already in the submitting state.
  INSERT INTO public.payout_operations (
    operation_id,
    reward_period_id,
    reward_id,
    user_id,
    wallet_address,
    token_amount_raw,
    token_decimals,
    status,
    actor_id
  ) VALUES (
    v_operation_id,
    p_period_id,
    p_reward_id,
    p_user_id,
    p_wallet_address,
    p_amount_raw,
    p_token_decimals,
    'submitting',
    p_actor_id
  );

  RETURN v_operation_id;
END;
$$;

ALTER FUNCTION public.create_or_claim_payout_operation(UUID, UUID, UUID, TEXT, BIGINT, INT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_or_claim_payout_operation(UUID, UUID, UUID, TEXT, BIGINT, INT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_claim_payout_operation(UUID, UUID, UUID, TEXT, BIGINT, INT, UUID) TO service_role;
