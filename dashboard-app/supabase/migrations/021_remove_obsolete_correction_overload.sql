-- Phase 1: remove the obsolete three-parameter overload of apply_reward_correction
-- and install the authoritative four-parameter version.
--
-- Background:
--   - Migrations 014 and 015 originally defined apply_reward_correction(UUID, TEXT, JSONB).
--   - Migration 018 added a p_total_income parameter intending to update period
--     accounting inside the same transaction. Because PostgreSQL treats functions
--     with different signatures as distinct objects, this created an overloaded
--     function rather than replacing the older one.
--   - Migration 018 was also edited after its initial creation, so databases that
--     applied an earlier revision of 018 may still have only the three-parameter
--     version (or a different four-parameter body).
--
-- This migration:
--   1. Creates/replaces the definitive four-parameter function with the corrected
--      body that updates reward_periods.status and total_income atomically.
--   2. Drops the obsolete three-parameter overload so service_role callers cannot
--      invoke the older, accounting-unsafe definition.
--   3. Re-applies permissions on the authoritative signature.

-- -----------------------------------------------------------------------------
-- Authoritative reward correction function.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_reward_correction(
  p_period_id UUID,
  p_reason TEXT,
  p_total_income DECIMAL(12,2),
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
  IF p_total_income IS NULL THEN
    RAISE EXCEPTION 'total income is required';
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

  -- Update the period's totals and status inside the same transaction so the
  -- application never sees committed reward changes with stale financial data.
  UPDATE public.reward_periods
  SET status = 'calculating',
      total_income = p_total_income
  WHERE id = p_period_id;

  RETURN jsonb_build_object(
    'correction_id', v_correction_id,
    'cancelled_payouts', v_cancelled_count,
    'superseded_rewards', v_superseded_count,
    'inserted_rewards', v_inserted_count,
    'period_status', 'calculating',
    'total_income', p_total_income
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Remove the obsolete three-parameter overload. Any existing callers would have
-- been using the pre-018 signature; the application has already been updated to
-- pass p_total_income, so this overload should have no live callers.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.apply_reward_correction(UUID, TEXT, JSONB);

-- -----------------------------------------------------------------------------
-- Permissions on the authoritative signature.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.apply_reward_correction(UUID, TEXT, DECIMAL(12,2), JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_reward_correction(UUID, TEXT, DECIMAL(12,2), JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_reward_correction(UUID, TEXT, DECIMAL(12,2), JSONB) TO service_role;
