# Membership schema (030) applied to staging — 2026-11-23

**Scope:** applying `030_membership_schema.sql` (the One Good Turn membership schema) to the
**staging** Supabase project. Staging only — **production is untouched.**

## The artifact applied

| | |
|---|---|
| File | `supabase/migrations/030_membership_schema.sql` |
| sha256 | `c5af493ad099c6295f460a969559342d9f8d3ceb75b0fa805ac4c7a47d5bf666` |
| Source commit | `5319f5a` (PR #100, branch `feat/membership-schema`) |
| Method | `psql` from disk with `ON_ERROR_STOP=1` — not the MCP migration runner, which takes SQL as a string argument and would mean hand-transcribing the DDL |

## Identity: which database was about to change

Read from the database, not inferred from a filename. The applier refuses outright if the
connection string contains the production ref, and refuses if it does not contain the staging
ref.

**Before:**

```
ledger head: 030 absent — 029 wallet_step_up, 028 wallet_signin, 027, 026, 025
members present: 20
membership_plans tables found: 0
promotional_draws tables found: 0
```

Held the migrations it was expected to hold and lacked the one being applied.

## Backup taken first

`~/backups/staging-luqrwhgjtiyfmeawbtmp/staging-pre-030-20261123T201748Z.sql`
(dir 0700, file 0600, sha256 in `MANIFEST.txt`)

- sha256 `8c83db0fdb50aa3b2e7178aabafacda25313ee89d69232d98ce21143b0627599`, 1,425,164 bytes, empty stderr
- **Verified USABLE, not merely written** — counted against the live database:
  18 `CREATE TABLE`, 18 `COPY`, 34 `CREATE FUNCTION`, 20 `CREATE POLICY`
- `public.users` COPY block holds **20** rows, and live `public.users` is **20** → the dump is
  live data, not a truncated file
- These counts are higher than the previously recorded baseline (≈15/15/28/20) because 028 added
  a table and 029 added two tables and five functions. Growth is migration history; a count
  *lower* than the last known shape would be the alarm.
- **Scope limitation:** `--schema=public --no-owner --no-privileges` does not cover `auth` /
  `storage` internals, and is not a substitute for the provider's point-in-time backup.

## Apply

`psql "$STAGING_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/030_membership_schema.sql` → exit 0.

Ledger row inserted afterwards, so `supabase_migrations.schema_migrations` stays truthful about
what is applied:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('030', NULL, 'membership_schema') ON CONFLICT (version) DO NOTHING;
```

Reads back as `030 membership_schema | 029 wallet_step_up | 028 wallet_signin`.

## Read-back from the live database

Counts, deliberately — a post-apply `has_table_privilege(...)` boolean is masked in a transcript,
so a correct `false` and a leaked value look identical. Counts cannot be masked.

| Check | Expected | Measured |
|---|---|---|
| The four tables exist | 4 | **4** |
| RLS enabled | 4 | **4** |
| Client-role grants (`anon` + `authenticated`) | 0 | **0** |
| Tables granted to `service_role` | 4 | **4** |
| Plans seeded | 2 | **2** |
| `promotional_draws` (deferred, must not exist) | 0 | **0** |
| Append-only trigger on redemptions | 1 | **1** |
| Key partial/unique indexes | 2 | **2** |

Seeded catalogue as applied:

```
community | 0c    | requires_payment=false | active=true
rewards   | 500c  | requires_payment=true  | active=true
```

The paid plan is present and priced, and unjoinable by the price/flag CHECK — the launch
constraint holding in the live database rather than in prose.

## Live probe, inside a transaction that was rolled back

The one-active-subscription invariant, tested against real staging data rather than a fixture —
and with its positive control, because a refusal only proves something if the same call succeeds
when it should:

```
NOTICE:  probe: the first subscription inserted fine
NOTICE:  probe: a second active subscription was correctly refused
```

Rolled back. Verified **nothing was left behind**: 0 subscriptions, 0 redemptions, 0 offers.

## What this does not establish

- **Production is not migrated.** It remains at `029`; production has not been touched.
- The tables are still **dormant**: no application code reads them, so this apply changes no
  behaviour visible to any member.
- The schema is proven by the local replay harness (mutation-tested) and by the reads above.
  The **service layer** — server-side entitlement checks, rate limiting, audit logging,
  redemption-code issuance, privacy policy — is not built, and remains the work standing between
  this schema and real members.
