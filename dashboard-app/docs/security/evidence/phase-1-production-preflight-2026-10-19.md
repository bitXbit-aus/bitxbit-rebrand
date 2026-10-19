# Phase 1 — Production Migration Preflight

**Date:** October 19, 2026
**Target:** production Supabase project `flasgvendiiasuixeqzu` (`https://flasgvendiiasuixeqzu.supabase.co`)
**Method:** read-only. Every statement was a `SELECT` against `information_schema` / `pg_catalog`, or a `DO` block containing only reads. No schema or data was modified. No migration was applied. No deploy occurred.

Tooling: `scripts/production-preflight.sql` (the same checks, runnable via `psql`).

---

## 1. Result summary

| Check | Result | Meaning |
|---|---|---|
| `supabase_migrations.schema_migrations` present | **NO** | Production has never used the migration runner; its schema was applied by hand |
| `user_authorizations` (migration 010) | absent | pre-010 |
| `payout_operations` (migration 013) | absent | pre-013 |
| `user_rewards.superseded_at` / `version` (014) | absent | pre-014 |
| `approve_reward_period`, `finalize_payout_confirmation` (024) | absent | pre-024 |
| `get_reward_payout_candidates_exact` (025) | absent | pre-025 |
| Obsolete 6-arg `create_or_claim_payout_operation` | **0** (function does not exist) | nothing to drop yet |
| Unique constraint on `(reward_period_id, user_id)` | **does not exist** | the constraint 017 tightens is not present |
| Duplicate-reward hard stop (migration 017) | **NOT APPLICABLE YET** | no `superseded_at`, so the condition cannot be evaluated |
| Open `submitted`/`uncertain`/`incident` payouts | none (no `payout_operations` table) | nothing to reconcile on-chain |

**Verdict: no hard stop detected. Production is at a pre-migration-010 state.**

## 2. Data volume

```text
users             6
projects          3
reward_periods    0
user_rewards      0
user_activities   0
```

No reward or payout history exists, so there is no financial record to preserve
across the upgrade and no reconciliation work outstanding.

## 3. Consequence for the upgrade range

Production requires **`010` → `026`**, not `024` → `026`. Applying only the recent
migrations would fail, because the tables, columns, and constraints they build on
do not exist.

## 4. Schema parity — does `010` → `026` actually apply to this schema?

This is the question a preflight must answer but the landmark checks above cannot.
Production's schema was hand-built, so it may have drifted from the state the
migration chain assumes. Verified directly:

**Production's table set** (10 tables):

```text
affiliate_income, affiliate_offers, allocation_models, categories, projects,
reward_periods, transparency_reports, user_activities, user_rewards, users
```

**Fixture used by `test-phase1-migration-replay.sh`** (`supabase/tests/phase1_security_fixture.sql`),
which models the pre-010 state that migrations `010`-`026` are replayed on top of:

```text
affiliate_income, affiliate_offers, allocation_models, categories, projects,
reward_periods, transparency_reports, user_activities, user_rewards, users
```

**Identical — same tables, same columns.** The only difference found is the
ordinal position of `users.referral_code` / `users.referred_by` (production lists
them after `email_verified`; the fixture lists them before `created_at`). Column
order carries no semantic weight.

Also confirmed: migrations `001`-`009` create exactly these ten tables and nothing
else, so production's hand-built schema is consistent with them having been
applied manually.

**Therefore the existing migration replay test — which applies `010` → `026` on
top of this fixture and passes — is a valid model of the production upgrade path.**
That is the strongest available evidence short of applying the migrations, which
was not authorised.

## 5. Residual risk

- **Schema parity is structural, not byte-for-byte.** Table and column *names and
  set* were compared, not types, defaults, NOT NULL flags, indexes, RLS policies,
  triggers, or grants. Production's `user_rewards` constraint set was inspected
  separately and shows only the primary key, two foreign keys, and a status
  check. A full parity diff of every object class is still outstanding.
- **No backup checkpoint has been recorded** for this project before the upgrade.
- **The migration ledger does not exist** on production. Unless it is created and
  populated during rollout, the next operator faces the same ambiguity, and
  re-running a migration will not be idempotent by ledger.
- Production is **Netlify-linked to `main`** (`bitxbit-dashboard` →
  `app.bitxbit.com.au`), so a merge to `main` can trigger a production deploy
  independently of this migration work.

## 6. Reproduce

```bash
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/production-preflight.sql
```

Read-only; exits non-zero only on a hard stop.
