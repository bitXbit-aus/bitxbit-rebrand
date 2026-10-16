# Database Migration and Recovery Guide

This guide covers staged application of `010_phase1_security_foundation.sql`. It is operational guidance, not a claim that the migration has been applied to any live database.

## Principles

- Apply migrations in numerical order and never edit an already-applied migration.
- Take recoverable backups before changing production authorization or RLS.
- Test with representative member, suspended member, admin, anonymous, and service-role sessions.
- Prefer a new forward-fix migration over manual drift or rewriting migration `010`.
- Preserve users, identifiers, roles, statuses, wallets, referrals, rewards, records, and storage objects.

## Migration files

- `010_phase1_security_foundation.sql` — protected authorization, RLS hardening, audit log, trusted offer clicks, integrity constraints.
- `011_wallet_verification.sql` — challenge table, wallet verification status, atomic challenge consumption, verification reset trigger.

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

The script creates and drops an isolated local PostgreSQL database, applies migration `010`, validates one new constraint, applies `010` again, and asserts that policy replacement, constraint validation state, trusted click deduplication, audit immutability, actor retention, and grants still hold. It requires local `psql`, `createdb`, and `dropdb`; it does not contact Supabase or production.

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
3. Apply migration `010` once through the normal migration runner.
4. Run the verification SQL below before enabling dependent application changes.
5. Smoke-test login, active member dashboard, suspended-member denial, active admin access, profile display-name update, wallet update through the server action, public asset reads, and blocked direct client writes.

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
11. An administrator with `manage_users` but without `manage_security` cannot promote or demote any user. Promotion/demotion succeeds only with `manage_security` and an AAL2 session.
12. Bulk role/status/delete rejects malformed or oversized ID lists, caller self-removal, and removal of the final active security-capable administrator.
13. Clicking an active offer records at most one trusted click per user/offer within 30 seconds; a mismatched/inactive offer URL is rejected, direct authenticated INSERT remains blocked, and outbound navigation still opens if analytics fails.
14. Service-role user, storage, wallet, treasury, and airdrop operations create actor-attributed application audit rows without private keys or signing material.

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
