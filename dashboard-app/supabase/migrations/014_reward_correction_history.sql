-- Phase 1: make reward corrections transactional and preserve historical reward records.
-- Corrections no longer delete user_rewards (which would violate payout_operations
-- foreign keys). Instead, prior reward records are superseded and new records are
-- inserted with an incremented version, all inside a single database transaction.

-- -----------------------------------------------------------------------------
-- Versioning columns for user_rewards.
-- version            : monotonic correction sequence per user/period.
-- superseded_at      : timestamp when this record was replaced by a correction.
-- superseded_by_correction_id : the correction that replaced this record.
-- correction_reason  : the operator-provided reason stored on superseded records.
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_rewards
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_correction_id UUID,
  ADD COLUMN IF NOT EXISTS correction_reason TEXT;

-- Only one active (non-superseded) reward record may exist per user per period.
-- Superseded records remain for audit but are excluded from active reads.
DROP INDEX IF EXISTS idx_user_rewards_period_user_active;
CREATE UNIQUE INDEX idx_user_rewards_period_user_active
  ON public.user_rewards (reward_period_id, user_id, version)
  WHERE superseded_at IS NULL;

-- Keep the existing period-status index useful for active reward lookups.
DROP INDEX IF EXISTS idx_user_rewards_period_status;
CREATE INDEX idx_user_rewards_period_status
  ON public.user_rewards (reward_period_id, status)
  WHERE superseded_at IS NULL;

-- -----------------------------------------------------------------------------
-- Atomic reward correction.
-- Cancels safe payouts, supersedes active reward records, resets the period,
-- and inserts the newly calculated reward records. All steps run in one
-- transaction, so a failure leaves the prior financial records untouched.
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

  -- Refuse correction if any payout has entered the blockchain pipeline.
  IF EXISTS (
    SELECT 1 FROM public.payout_operations
    WHERE reward_period_id = p_period_id
      AND status IN ('submitting', 'submitted', 'uncertain', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'period has non-recalculable payouts';
  END IF;

  -- Cancel pending/failed payouts so they remain in the audit trail.
  UPDATE public.payout_operations
  SET status = 'cancelled',
      cancellation_reason = 'Cancelled during reward correction: ' || p_reason,
      updated_at = NOW()
  WHERE reward_period_id = p_period_id
    AND status IN ('pending', 'failed');
  GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;

  -- Supersede active reward records for this period, preserving FK targets.
  UPDATE public.user_rewards
  SET status = 'superseded',
      superseded_at = NOW(),
      superseded_by_correction_id = v_correction_id,
      correction_reason = p_reason
  WHERE reward_period_id = p_period_id
    AND superseded_at IS NULL;
  GET DIAGNOSTICS v_superseded_count = ROW_COUNT;

  -- Reset period so it can be recalculated/approved again.
  UPDATE public.reward_periods
  SET status = 'pending', total_income = 0
  WHERE id = p_period_id;

  -- Insert new reward records with the next version per user.
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
