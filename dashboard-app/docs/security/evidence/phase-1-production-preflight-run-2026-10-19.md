# Production preflight — RE-RUN before applying, with backup status

> **Companion document.** The authoritative preflight assessment is
> `phase-1-production-preflight-2026-10-19.md`, which lives on the `security/phase-1-hardening`
> branch. This file records the **re-run performed immediately before applying**, plus the
> column-level schema-parity diff and the backup status.
>
> The two overlap on the starting-state result. **Consolidate into one document once both branches
> merge** — the hardening branch could not be edited here without moving PR #1's head, which would
> reset its CI run and dismiss its approval.

Read-only. No production change was made in producing this evidence.

## 1. Preflight — no hard stop

`scripts/production-preflight.sql` uses `psql` meta-commands (`\echo`) and `RAISE NOTICE`, so it
cannot be piped through the MCP SQL interface verbatim. Its checks were re-expressed as plain
read-only `SELECT`s returning the same facts, and run against production.

| Check | Result | Meaning |
|---|---|---|
| Migration ledger present | **false** | Hand-built schema; the ledger cannot supply the starting state |
| `public` tables | **10** | Matches the pre-Phase-1 shape |
| `user_authorizations` (migration 010) | absent | pre-010 |
| `payout_operations` (migration 013) | absent | pre-013 |
| `user_rewards.superseded_at` (014) | absent | pre-014 |
| `user_rewards.version` (014) | absent | pre-014 |
| `approve_reward_period` (024) | absent | pre-024 |
| `get_reward_payout_candidates_exact` (025) | absent | pre-025 |
| obsolete 6-arg `create_or_claim_payout_operation` | **0** | the hard stop at preflight step 4 does **not** fire |
| 7-arg hardened overload | 0 | — |
| public functions | 4 | — |

**Required range: the full `010` → `026`.** Not the recent tail — the preflight's own guard
reports exactly this when `superseded_at` is absent.

**The duplicate-active-rewards hard stop (preflight step 6) is not applicable**: it is guarded on
`user_rewards.superseded_at`, which does not exist, and `user_rewards` holds **0 rows**.

## 2. Data at risk

| Table | Rows |
|---|---|
| `users` | 6 |
| `categories` | 8 |
| `projects` | 3 |
| `affiliate_offers` | 1 |
| `allocation_models` | 1 |
| `user_activities`, `affiliate_income`, `reward_periods`, `user_rewards`, `transparency_reports` | 0 |
| **Total** | **19** |

**0 reward periods and 0 user rewards.** No financial rows exist, so there is no financial state
to preserve or reconcile. That is a materially different risk profile from a production database
carrying live reward history.

## 3. Upgrade-path proof — schema parity against the replay fixture

The strongest available evidence without applying anything: the repo's replay test loads
`supabase/tests/phase1_security_fixture.sql` and applies `010` → `026` in order, twice (first
apply, then an idempotency re-apply). It passes.

That only proves production's path **if the fixture models production's pre-range state.** Verified
rather than assumed:

- **Table set.** The fixture creates exactly the same ten `public` tables production has.
- **Post-010 landmarks.** The fixture contains **zero** occurrences of `user_authorizations`,
  `payout_operations`, `superseded_at`, `version` or `approve_reward_period` — so it is genuinely
  pre-010, not a dump of a partly-migrated database.
- **Column-level diff.** Fixture schema vs production schema, dumped identically from
  `information_schema.columns` grouped by table: **identical for all ten tables.** The single
  difference is the column *order* of `users`
  (`…,referral_code,referred_by,created_at,…` vs `…,created_at,last_login,email_verified,referral_code,referred_by`).
  Same column set, different ordinal positions. Per the migration-preflight guidance, column order
  carries no semantic weight and must not be reported as drift. **No missing or extra columns.**

**Conclusion:** the fixture models production's starting state, so the passing replay test *is* the
upgrade-path proof for this range.

## 4. Backup

| Requirement | Status |
|---|---|
| Logical export | **Done** — all ten tables via PostgREST with the production service-role key, 19 rows, per-table SHA-256 and a manifest, written to `~/.hermes/cache/scratch/prod-backup/` |
| Provider-managed snapshot / PITR | **Not verified.** The Supabase MCP exposes no backup operation and the Supabase CLI is not installed, so this could not be confirmed or triggered programmatically. Must be confirmed in the dashboard before applying. |

The logical export is **data only**. Schema and functions are recoverable from repo migrations
`001`–`009`, but the export is not a substitute for a provider point-in-time backup, and is not
presented as one.

## 5. Residual risks

- Parity is **structural** — it compares object names and column sets, not types, defaults, NOT NULL
  flags, indexes, RLS policies, triggers or grants.
- The preflight was run as read-only `SELECT`s rather than through the script's `psql` driver, so the
  script's exit-code semantics (non-zero on hard stop) were not exercised; the underlying
  conditions were evaluated directly and all returned non-blocking.
- Migrations will be applied through the Supabase MCP `apply_migration`, which wraps each file as a
  named migration. This differs from piping the files through `psql -v ON_ERROR_STOP=1`, and will
  create a migration ledger on a database that has never had one.
