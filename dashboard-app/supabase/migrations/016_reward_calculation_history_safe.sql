-- Phase 1: make initial reward calculation preserve historical reward records.
-- After migration 014 introduced versioned rewards, executeRewardCalculation() must
-- not delete superseded historical records when recalculating. This migration
-- provides an atomic RPC that replaces only active (non-superseded) records and
-- computes the next version per user so history remains intact.

-- -----------------------------------------------------------------------------
-- Atomic reward calculation.
-- Replaces only active reward records for the period, preserving any superseded
-- historical records. New records receive the next version per user. The period
-- is reset to 'calculating' with the computed total income.
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
  v_payout_count INT;
  v_inserted_count INT := 0;
BEGIN
  IF p_period_id IS NULL THEN
    RAISE EXCEPTION 'period is required';
  END IF;

  SELECT status INTO v_period_status
  FROM public.reward_periods
  WHERE id = p_period_id;

  IF v_period_status IS NULL THEN
    RAISE EXCEPTION 'period not found';
  END IF;
  IF v_period_status IN ('approved', 'distributed') THEN
    RAISE EXCEPTION 'cannot recalculate an approved or distributed period';
  END IF;

  -- Do not recalculate once any payout activity exists; use correction instead.
  SELECT COUNT(*) INTO v_payout_count
  FROM public.payout_operations
  WHERE reward_period_id = p_period_id;

  IF v_payout_count > 0 THEN
    RAISE EXCEPTION 'period has existing payout activity';
  END IF;

  -- Delete only active records. Superseded historical records are preserved.
  DELETE FROM public.user_rewards
  WHERE reward_period_id = p_period_id
    AND superseded_at IS NULL;

  -- Insert new active records with the next version per user.
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

  -- Update period so it can be approved/distributed again.
  UPDATE public.reward_periods
  SET status = 'calculating',
      total_income = p_total_income
  WHERE id = p_period_id;

  RETURN jsonb_build_object(
    'period_id', p_period_id,
    'inserted_rewards', v_inserted_count
  );
END;
$$;

ALTER FUNCTION public.apply_reward_calculation(UUID, DECIMAL(12,2), JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_reward_calculation(UUID, DECIMAL(12,2), JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_reward_calculation(UUID, DECIMAL(12,2), JSONB) TO service_role;
