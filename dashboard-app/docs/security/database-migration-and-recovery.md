# Database Migration and Recovery Guide

This guide covers staged application of the Phase 1 security migrations (`010` through `026`). It is operational guidance; production rollout remains prohibited until explicitly authorized.

## Principles

- Apply migrations in numerical order and never edit an already-applied migration.
- Take recoverable backups before changing production authorization or RLS.
- Test with representative member, suspended member, admin, anonymous, and service-role sessions.
- Prefer a new forward-fix migration over manual drift or rewriting migration `010`.
- Preserve users, identifiers, roles, statuses, wallets, referrals, rewards, records, and storage objects.

## Migration files

- `010_phase1_security_foundation.sql` — protected authorization, RLS hardening, audit log, trusted offer clicks, integrity constraints.
- `011_wallet_verification.sql` — challenge table, wallet verification status, atomic challenge consumption, verification reset trigger.
- `012_secure_token_distribution.sql` through `023_remove_obsolete_create_or_claim_overload.sql` — durable payout state, exact token units, correction/recalculation history, period-lock coordination, immutable final states, test-operation constraints, atomic create-or-claim authorization, and obsolete-overload removal.
- `024_atomic_reward_approval_and_payout_finalization.sql` — atomic period-locked reward approval and atomic confirmed-payout/reward/period finalization, including repair of legacy confirmed-operation partial commits.
- `025_exact_payout_amount_reads.sql` — service-role-only reads returning raw token units as canonical decimal text.
- `026_harden_payout_confirmation_evidence.sql` — validates that a confirmation payload positively reports `confirmed: true`, carries no conflicting `uncertain`/`incident` claim, and names a transaction signature matching the immutable operation hash; refuses conflicting distribution-signature overwrites.

## Staged application

### 1. Preflight in a non-production environment

1. Restore a recent production-like backup into an isolated Supabase project or local Postgres environment.
2. Record row counts and role/status distribution:

```sql
SELECT COUNT(*) AS users FROM public.users;
SELECT role, status, COUNT(*) FROM public.users GROUP BY role, status ORDER BY role, status;
SELECT COUNT(*) AS rewards FROM public.user_rewards;
SELECT COUNT(*) AS activities FROM public.user_activities;
SELECT COUNT(*) AS storage_objects FROM storage.objects WHERE bucket_id = 'assets';
```

3. Check for values that the new constraints will leave unvalidated:

```sql
SELECT * FROM public.affiliate_income WHERE amount < 0;
SELECT * FROM public.reward_periods WHERE end_date < start_date OR total_income < 0;
SELECT * FROM public.user_rewards
WHERE estimated_aud_value < 0 OR bitxbit_amount < 0;
SELECT * FROM public.projects
WHERE funding_goal < 0 OR amount_allocated < 0;
SELECT * FROM public.transparency_reports WHERE total_income < 0;
```

4. Run the repository replay test from `dashboard-app`:

```bash
npm run test:migration
```

The script creates and drops an isolated local PostgreSQL database, applies migrations `010` through `026`, validates one new constraint, replays the migrations, and asserts authorization, wallet verification, payout immutability, exact reward history, exact raw-amount reads, confirmation-evidence validation, overload removal, atomic approval/finalization, and concurrent period-lock races. It requires local `psql`, `createdb`, and `dropdb`; it does not contact Supabase or production.

5. Apply migrations through the normal Supabase migration mechanism. Do not paste selected fragments unless recovering from a diagnosed partial manual application.

### 2. Backup before production

Use at least one provider-managed point-in-time/snapshot backup and one logical export where available. Include:

- `auth.users`
- all `public` schema tables and functions
- RLS policies and grants
- `storage.buckets` and `storage.objects` metadata
- separately backed-up storage object contents if the provider backup does not include object payloads

Record the backup identifier, creation timestamp, migration commit/branch, and operator.

### 3. Production rollout

1. Schedule a low-write window.
2. Confirm no older migration is being modified.
3. Apply migrations `010` through `026` once each through the normal migration runner.
4. Run the verification SQL below before enabling dependent application changes.
5. Smoke-test login, active member dashboard, suspended-member denial, active admin access, profile display-name update, wallet update through the server action, public asset reads, blocked direct client writes, wallet ownership challenge signing, and reward airdrop idempotency.

### 3a. Production pre-flight (run against production BEFORE applying)

Staging was migrated `001`→`026` in a single pass, so it does not prove the
upgrade path from production's *current* state.

Run the executable gate — read-only, and it aborts on a hard stop:

```bash
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/production-preflight.sql
```

**Do not run a hand-written duplicate query instead.** An earlier version of this
section gave inline SQL that assumed the Phase 1 schema was already present.
Against a pre-Phase-1 database it did not fail cleanly — it errored with
`42703: column "superseded_at" does not exist`. That is worse than a red result,
because a crashed check can be mistaken for a passing one. Every check in the
script guards on the object it depends on and degrades to an explicit
"not applicable yet" notice.

The script reports, and where relevant aborts on:

1. Whether `supabase_migrations.schema_migrations` exists at all.
2. Phase 1 schema landmarks: `user_authorizations`, `payout_operations`,
   `user_rewards.superseded_at` / `version`, and the `024`/`025` functions.
3. The obsolete 6-argument `create_or_claim_payout_operation` overload — must be 0.
4. **Hard stop:** active duplicate `(reward_period_id, user_id)` rewards.
5. Open `submitted` / `uncertain` / `incident` payout operations needing on-chain
   reconciliation before the upgrade.

### 3b. When the database has no migration ledger

A pre-Phase-1 database may have **no `supabase_migrations.schema_migrations` table
at all** — its schema was built by hand and never went through the runner.

**Confirmed on production (`flasgvendiiasuixeqzu`, 2026-10-19):** no ledger, no
Phase 1 objects of any kind, and no unique constraint on
`(reward_period_id, user_id)`. Production is at a **pre-migration-010** state, so
the intended range is **`010` → `026`**, and the migration-017 duplicate hard stop
is **not applicable yet**. See
`docs/security/evidence/phase-1-production-preflight-2026-10-19.md`.

In that case:

- The ledger cannot tell you the starting point. Derive it from the schema
  landmarks in the preflight output instead.
- The upgrade range is **`010` → `026`**, not `024` → `026`.
- The migration-017 hard stop is **not applicable yet**, because the uniqueness
  constraint it tightens does not exist until `014`/`017` have run. The preflight
  states this explicitly rather than passing silently — a green result here does
  not mean the duplicate condition was checked.
- Recording the range in the ledger before applying is what makes the subsequent
  run idempotent. Confirm the ledger is created and populated as part of the
  rollout, or the next operator will face the same ambiguity.

If a duplicate check *does* apply and returns rows, resolve the duplicates in a
forward migration before applying `017`. Do not delete financial rows.

## Verification SQL

### Authorization backfill and compatibility

```sql
-- Must return zero.
SELECT COUNT(*) AS missing_authorizations
FROM public.users AS u
LEFT JOIN public.user_authorizations AS a ON a.user_id = u.id
WHERE a.user_id IS NULL;

-- Must return zero immediately after migration.
SELECT COUNT(*) AS compatibility_mismatches
FROM public.users AS u
JOIN public.user_authorizations AS a ON a.user_id = u.id
WHERE (u.role, u.status) IS DISTINCT FROM (a.role, a.status);

-- Existing admins should still be active admins unless they were already suspended.
SELECT u.id, u.email, u.role, u.status,
       a.role AS protected_role, a.status AS protected_status,
       a.can_manage_users, a.can_manage_rewards,
       a.can_manage_content, a.can_manage_financials,
       a.can_manage_security
FROM public.users AS u
JOIN public.user_authorizations AS a ON a.user_id = u.id
WHERE u.role = 'admin';
```

### Function hardening

```sql
SELECT n.nspname AS schema_name,
       p.proname,
       p.prosecdef AS security_definer,
       p.proconfig,
       pg_get_userbyid(p.proowner) AS owner
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_active_user',
    'is_active_admin',
    'has_authorization_capability',
    'get_my_authorization',
    'handle_new_user',
    'write_security_audit_trigger'
  )
ORDER BY p.proname;
```

Verify `security_definer = true` where expected, owner is trusted, and `proconfig` contains the fixed search path.

### Grants

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('users', 'user_authorizations', 'user_activities', 'security_audit_log')
ORDER BY table_name, grantee, privilege_type;

SELECT grantee, privilege_type, column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'users'
ORDER BY grantee, privilege_type, column_name;
```

Confirm authenticated users have no authorization-table writes, no activity INSERT, no audit UPDATE/DELETE, and only `users.display_name` UPDATE.

### Policies

```sql
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;
```

Confirm admin write policies call `is_active_admin()`, member writes call `is_active_user()`, activity insertion is absent, and authenticated storage mutation policies are absent.

### Audit and constraints

```sql
SELECT COUNT(*) FROM public.security_audit_log;

-- Must return zero: actor attribution is an immutable value, not a deleting-user FK.
SELECT COUNT(*) AS actor_foreign_keys
FROM pg_constraint
WHERE conrelid = 'public.security_audit_log'::regclass
  AND contype = 'f'
  AND conkey = ARRAY[
    (SELECT attnum FROM pg_attribute
     WHERE attrelid = 'public.security_audit_log'::regclass
       AND attname = 'actor_id')
  ]::SMALLINT[];

SELECT conrelid::regclass AS table_name,
       conname,
       convalidated
FROM pg_constraint
WHERE conname IN (
  'affiliate_income_amount_nonnegative',
  'reward_periods_date_order',
  'reward_periods_total_income_nonnegative',
  'user_rewards_estimated_value_nonnegative',
  'user_rewards_token_amount_nonnegative',
  'projects_funding_goal_nonnegative',
  'projects_amount_allocated_nonnegative',
  'transparency_total_income_nonnegative'
)
ORDER BY conrelid::regclass::text, conname;
```

`convalidated = false` is expected initially. PostgreSQL still enforces these checks for new/changed rows.

### Payout operations

```sql
-- payout_operations exists with expected constraints and indexes.
SELECT COUNT(*) AS payout_ops_indexes
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'payout_operations'
  AND indexname IN (
    'idx_payout_operations_period_status',
    'idx_payout_operations_reward',
    'idx_payout_operations_tx'
  );

-- Direct authenticated reads/writes are blocked; service_role has access.
SELECT has_table_privilege('authenticated', 'public.payout_operations', 'SELECT') AS authenticated_select;
SELECT has_table_privilege('service_role', 'public.payout_operations', 'ALL') AS service_role_all;

-- Confirmed operations are immutable.
SELECT COUNT(*) AS confirmed_mutable_operations
FROM public.payout_operations
WHERE status = 'confirmed'
  AND updated_at > confirmed_at + INTERVAL '1 second';
```

Expected: `authenticated_select = false`, `service_role_all = true`, `confirmed_mutable_operations = 0`.

## Rate limiting and proxy trust

The rate limiter supports a pluggable store. The default `MemoryRateLimitStore` is suitable for local development or a single-instance deployment. On Netlify serverless functions, multiple instances may run concurrently; an in-memory store lets a determined distributed attacker exceed the per-IP limit by hitting different instances.

Before production load:

1. Set `TRUST_PROXY=true` (or `RATE_LIMIT_TRUST_PROXY=true`) **only** when the deployment is behind a trusted proxy that sanitizes `X-Forwarded-For`. On Netlify the runtime uses `x-nf-client-connection-ip` automatically, so no extra variable is required.
2. Configure a shared store. The codebase includes `UpstashRedisRateLimitStore` (`lib/rate-limit-redis.ts`), which is selected automatically when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. It uses an atomic Lua script (`INCR` + `PTTL`) so concurrent function instances cannot over-allocate requests. No caller changes are required; `checkRateLimit()` and `RateLimitOptions` are unchanged.

## Session-level behavior tests

Use disposable test accounts, not production identities:

1. Active member can read own profile/rewards and update only `display_name`.
2. Active member cannot update role, status, email, wallet, referral fields, or authorization rows directly.
3. Active member cannot insert `user_activities` directly.
4. Suspended/deactivated member cannot enter dashboard routes or use member write policies.
5. Active admin can use admin routes and admin RLS operations.
6. Suspended/deactivated admin cannot use admin routes or admin RLS operations.
7. Anonymous users retain intended public reads only.
8. Public asset reads work; authenticated direct storage INSERT/UPDATE/DELETE fails.
9. A newly created auth user receives both `public.users` and `public.user_authorizations` rows.
10. Protected-table changes create audit rows; clients cannot update or delete audit rows, and deleting the actor does not change historical `actor_id`, `actor_role`, `actor_status`, or capability snapshot values.
12. An administrator with `manage_users` but without `manage_security` cannot promote or demote any user. Promotion/demotion succeeds only with `manage_security` and an AAL2 session.
13. Bulk role/status/delete rejects malformed or oversized ID lists, caller self-removal, and removal of the final active security-capable administrator.
14. Clicking an active offer records at most one trusted click per user/offer within 30 seconds; a mismatched/inactive offer URL is rejected, direct authenticated INSERT remains blocked, and outbound navigation still opens if analytics fails.
15. Wallet connection alone does not mark a wallet verified; signing the SIWS challenge with the matching private key does. Changing the saved wallet address resets `wallet_verified` to false.
16. `sendTestAirdrop` is disabled unless `ENABLE_TEST_AIRDROP=true`.
17. `calculateRewards` refuses to recalculate a period that is already `approved` or `distributed`, or that has any `payout_operations` rows.
18. `correctRewards` requires a reason, rejects distributed periods and periods with confirmed payouts, deletes non-confirmed payout operations, resets the period, and recalculates with an audit record.
19. `airdropRewards` skips unverified wallets, creates exactly one `payout_operations` row per reward/period, atomically claims each `pending`/`failed` operation via `claim_payout_operation()` before submission, reconciles `submitted` operations on-chain before any retry, and never marks a reward distributed twice.
20. Confirmed `payout_operations` cannot be changed back to pending, submitted, or failed.
21. Service-role user, storage, wallet, treasury, and airdrop operations create actor-attributed application audit rows without private keys or signing material.
22. Rate-limit client identifiers cannot be spoofed via `X-Forwarded-For` unless `TRUST_PROXY=true` is set; Netlify deployments use the trusted `x-nf-client-connection-ip` header.
23. Payout audit logging is fail-closed: a payout state change fails if its audit record cannot be written.

## Recovery and forward fixes

### Transaction behavior

PostgreSQL supports transactional DDL for many operations, but recovery depends on how the migration runner wraps statements and whether external systems are involved. Do not assume a long migration can always be rolled back after the runner reports partial failure. Supabase Auth and Storage operations may also cross schema/service boundaries.

### If application fails before migration application

Fix application code or configuration and redeploy. The database is unchanged.

### If migration fails inside an intact transaction

Confirm the transaction rolled back by checking migration history and the existence of `public.user_authorizations`. Diagnose the exact failing statement, correct it in a new candidate migration in non-production, and retry through the normal runner.

### If a manual or non-transactional application partially succeeds

1. Stop application writes if authorization state may be inconsistent.
2. Capture the exact catalog state, migration logs, and row counts.
3. Do not delete user or financial rows.
4. Create a new numbered forward-fix migration that uses defensive `IF EXISTS`/`IF NOT EXISTS`, repairs missing grants/policies/functions, and re-runs the authorization backfill with `ON CONFLICT`.
5. Re-run all verification queries before restoring traffic.

### If authorization behavior is wrong after successful application

Prefer a narrow forward fix:

- Policy error: create the corrected policy under a new migration, then drop the faulty policy in the same migration.
- Grant error: issue explicit `REVOKE`/`GRANT` statements.
- Helper error: `CREATE OR REPLACE FUNCTION` with the corrected fixed search path, ownership, and grants.
- Missing authorization rows: insert from `public.users` with `ON CONFLICT (user_id) DO NOTHING`.
- Compatibility mismatch: reconcile from the protected table into `public.users` after confirming the intended authority.

### Payout state recovery

Payout operations are the highest-risk state in this release because they back
real token transfers. Diagnose before acting:

```sql
SELECT operation_id, status, transaction_hash, reward_id, reward_period_id,
       token_amount_raw, token_decimals, submission_error,
       submitted_at, confirmed_at, uncertain_at, incident_at
FROM public.payout_operations
WHERE status IN ('submitted', 'uncertain', 'incident')
ORDER BY reward_period_id, created_at;
```

- **`submitted`** — a signed transaction was persisted and broadcast. Do **not**
  re-submit. Re-run `airdropRewards` for the period: reconciliation calls
  `confirmTokenTransfer` against the stored signature and finalizes only on a
  match. If the signature is absent from the chain, the operation is moved to
  `uncertain`, not re-sent.
- **`uncertain`** — outcome is inconclusive. Reconcile on-chain against the stored
  signature. Never treat an inconclusive result as `failed` and never auto-retry.
- **`incident`** — the transaction landed but does not match the expected
  recipient, amount, source, mint, or authority. This is terminal and
  non-retryable. Investigate on-chain manually; any correction must be a new
  adjustment record, never a delete or an automatic replacement payment.
- **`confirmed` but reward still `approved`** — a legacy partial commit. Re-run
  finalization for that operation (the retry path passes a null payload and
  repairs the reward/period transition from the immutable signature).
- **`confirmed` with a conflicting `distribution_tx_hash`** — do not overwrite.
  Investigate and record a new adjustment.

Confirmed and incident rows are immutable and protected from deletion by trigger.
Teardown scripts must retain them.

### Release rollback policy

The database is forward-only. Rolling back the *application* is normal and safe;
rolling back the *schema* is not.

1. **Application rollback** — redeploy the previous dashboard build. The Phase 1
   migrations are additive and the previous application version continues to work
   against the migrated schema, with one exception: the pre-Phase-1 code path
   that approved rewards with separate writes is no longer reachable, which is the
   intended behavior.
2. **Schema rollback** — do **not** write down-migrations that drop
   `user_authorizations`, `payout_operations`, audit rows, or reward history.
   Correct defects with a new numbered forward-fix migration.
3. **Data rollback** — restore from backup only when forward repair is unsafe.
   Restoring discards everything written since the backup, including confirmed
   payout history, so treat it as a last resort and reconcile any on-chain
   transfers made in the interval separately.

### Full restore

Use full restore only when forward repair is unsafe or data integrity is uncertain. Restoring the database may not restore storage object payloads or external side effects; follow the provider's documented restore process and reconcile those systems separately.

## Later validation migration

After cleaning any legacy invalid rows, validate constraints in a separate forward migration:

```sql
ALTER TABLE public.affiliate_income VALIDATE CONSTRAINT affiliate_income_amount_nonnegative;
ALTER TABLE public.reward_periods VALIDATE CONSTRAINT reward_periods_date_order;
ALTER TABLE public.reward_periods VALIDATE CONSTRAINT reward_periods_total_income_nonnegative;
ALTER TABLE public.user_rewards VALIDATE CONSTRAINT user_rewards_estimated_value_nonnegative;
ALTER TABLE public.user_rewards VALIDATE CONSTRAINT user_rewards_token_amount_nonnegative;
ALTER TABLE public.projects VALIDATE CONSTRAINT projects_funding_goal_nonnegative;
ALTER TABLE public.projects VALIDATE CONSTRAINT projects_amount_allocated_nonnegative;
ALTER TABLE public.transparency_reports VALIDATE CONSTRAINT transparency_total_income_nonnegative;
```
