-- Phase 1 exact token-unit read boundary.
-- PostgreSQL BIGINT/NUMERIC values returned through PostgREST JSON can be parsed
-- as JavaScript numbers and lose precision. These service-role-only functions
-- return canonical raw token units as decimal text so the application can
-- construct bigint values without any floating-point intermediate.

CREATE OR REPLACE FUNCTION public.get_reward_payout_candidates_exact(
  p_period_id UUID,
  p_token_decimals INTEGER
)
RETURNS TABLE (
  reward_id UUID,
  user_id UUID,
  wallet_address TEXT,
  wallet_verified BOOLEAN,
  amount_raw TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_period_id IS NULL THEN
    RAISE EXCEPTION 'period ID is required';
  END IF;

  IF p_token_decimals IS NULL OR p_token_decimals < 0 OR p_token_decimals > 18 THEN
    RAISE EXCEPTION 'token decimals must be between 0 and 18';
  END IF;

  RETURN QUERY
  SELECT
    reward.id,
    reward.user_id,
    profile.wallet_address,
    COALESCE(profile.wallet_verified, FALSE),
    (ROUND(reward.bitxbit_amount * POWER(10::NUMERIC, p_token_decimals))::BIGINT)::TEXT
  FROM public.user_rewards AS reward
  JOIN public.users AS profile ON profile.id = reward.user_id
  WHERE reward.reward_period_id = p_period_id
    AND reward.status = 'approved'
    AND reward.superseded_at IS NULL
  ORDER BY reward.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_period_payout_operations_exact(
  p_period_id UUID
)
RETURNS TABLE (
  operation_id TEXT,
  reward_id UUID,
  status TEXT,
  transaction_hash TEXT,
  token_amount_raw TEXT,
  wallet_address TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_period_id IS NULL THEN
    RAISE EXCEPTION 'period ID is required';
  END IF;

  RETURN QUERY
  SELECT
    operation.operation_id,
    operation.reward_id,
    operation.status,
    operation.transaction_hash,
    operation.token_amount_raw::TEXT,
    operation.wallet_address
  FROM public.payout_operations AS operation
  WHERE operation.reward_period_id = p_period_id
  ORDER BY operation.created_at, operation.operation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_reward_payout_candidates_exact(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_period_payout_operations_exact(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reward_payout_candidates_exact(UUID, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_period_payout_operations_exact(UUID)
  TO service_role;
