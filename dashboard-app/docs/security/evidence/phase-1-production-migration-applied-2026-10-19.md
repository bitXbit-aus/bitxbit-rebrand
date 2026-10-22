# Phase 1 migration applied to production — 2026-10-19

**Target:** production Supabase `flasgvendiiasuixeqzu`
**Range applied:** `010` → `026` (17 migrations, in numerical order)
**Mechanism:** `psql -v ON_ERROR_STOP=1 -f <file>` per migration, via the session-mode pooler.
**Authorised by:** the owner. Backup and migration steps were explicitly authorised.

> Mechanism note: an earlier attempt to apply this range through the Supabase MCP
> `apply_migration` was abandoned. That tool takes the SQL as a string argument, so applying
> would have required **hand-transcribing ~117 KB of production DDL**. A mis-copied `REVOKE`
> or policy line would still apply cleanly and pass the landmark checks while leaving
> authorization weaker than intended. Direct `psql` runs the files verbatim from disk.

---

## 1. Backup — taken before any change

| | |
|---|---|
| Method | `pg_dump` via the session-mode pooler, `--schema=public --no-owner --no-privileges` |
| Host | `aws-0-ap-northeast-2.pooler.supabase.com:5432`, user `postgres.flasgvendiiasuixeqzu` |
| Plain SQL | `prod-public-20261019T232900Z.sql` — 27,025 bytes · sha256 `fef0694e408a69c49b88d822edb3d4cf84ab0be47bff49527ea52d161360c10e` |
| Custom format | `prod-public-20261019T232900Z.dump` — 37,255 bytes · sha256 `3e57e184b00ff99f3486bc98cc0489dd2e179cea242e5c1afc53150519e5d9d3` |
| Contents | 10 tables · 10 `COPY` data blocks · 4 functions · 20 policies |
| Location | `~/.hermes/cache/scratch/prod-backup/` with a manifest |

**Scope limitation:** `public` schema only. It does not include `auth`/`storage` internals, and
it is **not** a substitute for a provider point-in-time backup — none was verified, because the
Supabase MCP exposes no backup operation and the plan could not be determined from the API.
This gap is accepted by the owner, who authorised proceeding on the logical export.

## 2. Preflight — run through the real runner

`scripts/production-preflight.sql` via `psql -v ON_ERROR_STOP=1`. **`PREFLIGHT_EXIT=0` — no hard stop.**

```
ledger_present = f          → NO LEDGER: this database has never used the migration runner
landmarks (010/013/014/024/025) all f  → full 010 -> 026 range required
create_or_claim_payout_operation: 6-arg(obsolete)=0  7-arg(hardened)=0   → step-4 hard stop does not fire
users=6  reward_periods=0  user_rewards=0
step 6: NOT APPLICABLE YET (superseded_at absent)
step 7: payout_operations absent (pre-013). Nothing to reconcile.
PREFLIGHT COMPLETE — no hard stop detected
```

## 3. Application — all 17 succeeded

Applied in order, `ON_ERROR_STOP=1`, aborting at the first failure:

```
OK  010_phase1_security_foundation            OK  019_prevent_finalised_payout_deletion
OK  011_wallet_verification                   OK  020_create_or_claim_payout_operation
OK  012_secure_token_distribution             OK  021_remove_obsolete_correction_overload
OK  013_payout_hardening                      OK  022_create_or_claim_recheck_wallet_and_period
OK  014_reward_correction_history             OK  023_remove_obsolete_create_or_claim_overload
OK  015_payout_incident_state                 OK  024_atomic_reward_approval_and_payout_finalization
OK  016_reward_calculation_history_safe       OK  025_exact_payout_amount_reads
OK  017_fix_user_rewards_active_uniqueness    OK  026_harden_payout_confirmation_evidence
OK  018_coordinate_reward_correction_and_claim
APPLY_RESULT=0
```

## 4. Verification — after the change

| Check | Expected | Result |
|---|---|---|
| `user_authorizations` (010) | present | ✅ present |
| `payout_operations` (013) | present | ✅ present |
| `user_rewards.superseded_at` (014) | present | ✅ present |
| `approve_reward_period` (024) | present | ✅ present |
| `get_reward_payout_candidates_exact` (025) | present | ✅ present |
| users / projects / categories | 6 / 3 / 8 | ✅ **unchanged** |
| reward_periods / user_rewards | 0 / 0 | ✅ **unchanged** |
| `user_authorizations` backfill | one row per user | ✅ **6 rows** (1 admin, 5 members, all active) |
| authorization mismatches | 0 | ✅ **0** |
| `security_audit_log` | created, empty | ✅ created, 0 rows |
| obsolete 6-arg overload | 0 | ✅ **0** |

**No data was lost or altered.** Every row count matches the pre-migration backup.

### Live application health after the migration

| Endpoint | Status |
|---|---|
| `/` `/auth/login` `/dashboard` `/admin` | 302 · 200 · 307 · 307 |
| `/api/public/offers` `/transparency` `/projects` `/api/token-stats` | all **200** |
| Data served | real records returned (KAST offer, New Earth Healing Clinic project) |

The currently deployed build still works against the new schema — expected, because the
server-side paths use the service role, which bypasses the RLS changes, and the client-side
reads now resolve through the backfilled `user_authorizations` rows.

## 5. Migration ledger — backfilled `001`–`026` (RESOLVED same day)

The range was applied with `psql`, not the Supabase migration runner, so applying it left the
database with the Phase 1 schema and **no ledger**. The preflight flags exactly this ambiguity:
*"the next operator inherits the same ambiguity."* The ledger was therefore created and
backfilled.

**Structure copied from staging**, which has a genuine runner-created ledger — not invented:

```sql
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text NOT NULL PRIMARY KEY,
  statements text,
  name text
);
```

**26 rows inserted in one transaction:** `version` = the 3-digit prefix, `name` = the descriptive
remainder, `statements` NULL — matching staging's value shape.

**Deliberate divergence, recorded rather than copied:** staging's rows for `001`–`023` store the
**full filename stem** in `version` (`001_initial_schema`) with `name` NULL, while `024`–`027`
use `version = '024'` + a separate `name`. That inconsistency reflects different tools applied at
different times. Production is uniformly in the standard form (package-manager convention: numeric
version + name), because a fresh ledger should be internally consistent rather than inherit
someone else's drift.

**Provenance is recorded in the database itself**, via `COMMENT ON TABLE`, so the next operator
cannot mistake it for a runner-generated artefact:

> Backfilled 2026-10-19. Migrations 001-026 were applied outside the migration runner: 001-009 by
> hand when the schema was first built, 010-026 via psql with ON_ERROR_STOP. Rows here record what
> IS applied, not that the runner applied it.

**Access is not widened.** Grants remain `postgres` only — the same as staging. The
`supabase_migrations` schema is not exposed to PostgREST (which defaults to `public` alone), so
the ledger is not reachable through the API surface.

**Verified through both readers:**

- The preflight's step 2 now reports `Ledger present: 26 recorded migration(s)`, and step 4 reports
  `6-arg(obsolete)=0 7-arg(hardened)=1` — the hardened overload is now visible.
- Step 6, previously "NOT APPLICABLE", is now applicable and reports `OK: no active duplicate
  rewards`; step 7 reports `Open payout_operations (submitted/uncertain/incident): 0`.
- `PREFLIGHT COMPLETE — no hard stop detected`, `exit=0`.
- The Supabase MCP `list_migrations` returns all 26 with versions `001`–`026` and their names.

## 6. Residual risks

- **No provider point-in-time backup.** Accepted by the owner; the logical dump is the recovery basis.
- **Parity was structural.** The fixture-vs-production comparison covered table and column sets,
  not types, defaults, NOT NULL flags, indexes, RLS policies, triggers or grants.
- ~~Ledger absent~~ — **backfilled** `001`–`026` with provenance recorded in-database (section 5).
- **The window between migration and code deploy.** Migrations are applied; PR #1's code is not
  yet deployed, so production currently runs the old code against the new schema. Verified healthy
  in section 4, but the window closes only when the code is deployed.
- **Rollback is forward-only by policy** — no down-migrations. Recovery = restore the dump, or
  forward-fix. A restore would discard everything written since the backup.
