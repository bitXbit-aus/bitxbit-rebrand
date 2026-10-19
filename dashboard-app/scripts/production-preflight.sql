-- Production migration preflight — READ-ONLY, safe to run against production.
--
-- Purpose: establish the upgrade path from the target database's ACTUAL state
-- before applying the Phase 1 migration range, and abort on a hard stop.
--
-- Usage:
--   psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/production-preflight.sql
--
-- Exit status: non-zero when a hard stop is detected (RAISE EXCEPTION).
--
-- Why this is written defensively: the first version of this check assumed the
-- Phase 1 schema was already present. Against a pre-Phase-1 database it did not
-- return a failing result — it errored on a missing column, which is worse,
-- because "the check crashed" can be mistaken for "the check passed". Every
-- statement below guards on the object it depends on.

\echo ''
\echo '=========================================='
\echo ' PRODUCTION MIGRATION PREFLIGHT (read-only)'
\echo '=========================================='

\echo ''
\echo '--- 1. Migration ledger presence ---'
SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ledger_present;

\echo ''
\echo '--- 2. Applied migrations (ledger, or explicit NO LEDGER) ---'
DO $$
DECLARE
  n int;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE NOTICE 'NO LEDGER: this database has never used the migration runner.';
    RAISE NOTICE 'Derive the starting state from the schema (step 3/4), not the ledger.';
  ELSE
    EXECUTE 'SELECT count(*) FROM supabase_migrations.schema_migrations' INTO n;
    RAISE NOTICE 'Ledger present: % recorded migration(s).', n;
  END IF;
END $$;

\echo ''
\echo '--- 3. Phase 1 schema landmarks ---'
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='user_authorizations')      AS m010_user_authorizations,
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='payout_operations')        AS m013_payout_operations,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='user_rewards'
            AND column_name='superseded_at')                                     AS m014_superseded_at,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='user_rewards'
            AND column_name='version')                                           AS m014_version,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='approve_reward_period')         AS m024_approve_reward_period,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='finalize_payout_confirmation')  AS m024_finalize_payout_confirmation,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='get_reward_payout_candidates_exact') AS m025_exact_reads;

\echo ''
\echo '--- 4. Obsolete RPC overload (migration 023 must leave 0) ---'
DO $$
DECLARE
  legacy int := 0;
  hardened int := 0;
BEGIN
  IF to_regclass('pg_proc') IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO legacy
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_or_claim_payout_operation'
     AND p.pronargs = 6;
  SELECT count(*) INTO hardened
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_or_claim_payout_operation'
     AND p.pronargs = 7;
  RAISE NOTICE 'create_or_claim_payout_operation: 6-arg(obsolete)=% 7-arg(hardened)=%', legacy, hardened;
  IF legacy > 0 THEN
    RAISE EXCEPTION 'HARD STOP: obsolete 6-argument create_or_claim_payout_operation overload still present.';
  END IF;
END $$;

\echo ''
\echo '--- 5. Data volume (context for the migration window) ---'
SELECT
  (SELECT count(*) FROM public.users)          AS users,
  (SELECT count(*) FROM public.reward_periods) AS reward_periods,
  (SELECT count(*) FROM public.user_rewards)   AS user_rewards;

\echo ''
\echo '--- 6. HARD STOP: active duplicate rewards (migration 017) ---'
DO $$
DECLARE
  has_col boolean;
  dupes   bigint;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='user_rewards'
                   AND column_name='superseded_at') INTO has_col;

  IF NOT has_col THEN
    RAISE NOTICE 'NOT APPLICABLE YET: user_rewards.superseded_at is absent, so migration 014 is not applied.';
    RAISE NOTICE 'The uniqueness constraint migration 017 tightens does not exist yet.';
    RAISE NOTICE 'Expect the FULL 010 -> 026 range, not 024 -> 026.';
    RETURN;
  END IF;

  EXECUTE $q$
    SELECT count(*) FROM (
      SELECT 1 FROM public.user_rewards
       WHERE superseded_at IS NULL
       GROUP BY reward_period_id, user_id
      HAVING count(*) > 1
    ) d
  $q$ INTO dupes;

  IF dupes > 0 THEN
    RAISE EXCEPTION 'HARD STOP: % active duplicate (reward_period_id,user_id) group(s). Migration 017 refuses to apply. Resolve via a forward migration; do NOT delete financial rows.', dupes;
  END IF;
  RAISE NOTICE 'OK: no active duplicate rewards.';
END $$;

\echo ''
\echo '--- 7. Payout state that recovery may need to reconcile ---'
DO $$
DECLARE
  n bigint := 0;
BEGIN
  IF to_regclass('public.payout_operations') IS NULL THEN
    RAISE NOTICE 'payout_operations absent (pre-013). Nothing to reconcile.';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.payout_operations WHERE status IN (''submitted'',''uncertain'',''incident'')' INTO n;
  RAISE NOTICE 'Open payout_operations (submitted/uncertain/incident): %', n;
  IF n > 0 THEN
    RAISE NOTICE 'Reconcile these on-chain before the upgrade — see database-migration-and-recovery.md.';
  END IF;
END $$;

\echo ''
\echo '=========================================='
\echo ' PREFLIGHT COMPLETE — no hard stop detected'
\echo '=========================================='
\echo ''
