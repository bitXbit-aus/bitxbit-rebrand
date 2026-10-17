-- Phase 1: fix the active reward uniqueness rule.
-- Migration 014 introduced a partial unique index that included `version`, which
-- unintentionally allowed multiple active reward records for the same member and
-- period as long as they had different version numbers. This migration replaces
-- that index with a true one-active-reward-per-member-per-period constraint.

-- -----------------------------------------------------------------------------
-- Safety check: refuse to apply the corrected constraint if active duplicates
-- already exist. Any duplicates must be resolved manually (e.g., by superseding
-- all but the intended active record) before this migration can run safely.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_duplicate_count INT;
BEGIN
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT reward_period_id, user_id
    FROM public.user_rewards
    WHERE superseded_at IS NULL
    GROUP BY reward_period_id, user_id
    HAVING COUNT(*) > 1
  ) d;

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION 'Active duplicate user_rewards found for % period/user pairs. Resolve duplicates before applying this migration.', v_duplicate_count;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Replace the incorrect index with the correct one-active-reward constraint.
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_user_rewards_period_user_active;

CREATE UNIQUE INDEX idx_user_rewards_period_user_active
  ON public.user_rewards (reward_period_id, user_id)
  WHERE superseded_at IS NULL;
