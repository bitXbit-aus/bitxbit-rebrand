-- Phase 1: prevent deletion of finalised payout records and protect test
-- airdrops with the same durable operation model.
-- The existing immutability trigger only blocks updates to confirmed and incident
-- payout operations. A privileged client could still DELETE them, erasing
-- financial history. This migration adds a BEFORE DELETE trigger that rejects
-- any attempt to remove confirmed or incident records.
-- It also adds an `is_test` flag so the optional test-airdrop action can create
-- durable `payout_operations` records without a backing reward period/reward,
-- while non-test operations remain required to reference both.

-- -----------------------------------------------------------------------------
-- Reject deletion of confirmed or incident payout operations.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_confirmed_payout_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status IN ('confirmed', 'incident') THEN
    RAISE EXCEPTION '% payout operations cannot be deleted', OLD.status;
  END IF;
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.prevent_confirmed_payout_deletion() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_confirmed_payout_deletion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_confirmed_payout_deletion() TO service_role;

DROP TRIGGER IF EXISTS prevent_confirmed_payout_deletion ON public.payout_operations;

CREATE TRIGGER prevent_confirmed_payout_deletion
  BEFORE DELETE ON public.payout_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_confirmed_payout_deletion();

-- -----------------------------------------------------------------------------
-- Allow test payout operations to exist without a reward period/reward. Non-test
-- operations must still reference both, preserving referential integrity for the
-- normal reward lifecycle.
-- -----------------------------------------------------------------------------
ALTER TABLE public.payout_operations
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.payout_operations
  ALTER COLUMN reward_period_id DROP NOT NULL;

ALTER TABLE public.payout_operations
  ALTER COLUMN reward_id DROP NOT NULL;

ALTER TABLE public.payout_operations
  DROP CONSTRAINT IF EXISTS payout_operations_test_or_rewarded;

ALTER TABLE public.payout_operations
  ADD CONSTRAINT payout_operations_test_or_rewarded
  CHECK (is_test = true OR (reward_period_id IS NOT NULL AND reward_id IS NOT NULL));
