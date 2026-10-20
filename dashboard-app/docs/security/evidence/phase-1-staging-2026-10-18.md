# Phase 1 staging validation evidence

**Date:** October 18, 2026
**Branch:** `security/phase-1-hardening`
**Base:** `main`
**Environment:** non-production Supabase staging and Solana devnet
**Token substitute:** devnet USDC, 6 decimals

No credentials, private keys, service-role keys, database passwords, or signed transaction payloads are included in this evidence.

## Database deployment and catalog verification

Migration `024_atomic_reward_approval_and_payout_finalization.sql`, `025_exact_payout_amount_reads.sql`, and `026_harden_payout_confirmation_evidence.sql` were applied directly to the non-production Supabase database using the staging database credential. All were registered in `supabase_migrations.schema_migrations`.

Catalog verification after application:

```text
approve_reward_period=1
finalize_payout_confirmation=1
migration_024=1
candidate_exact=1
operation_exact=1
migration_025=1
finalize_fn=1
migration_026=1
```

Migration `025` adds service-role-only functions that return raw token units as canonical decimal text, so payout reconciliation never constructs a `bigint` through a JavaScript `number`. Migration `026` hardens `finalize_payout_confirmation()` so it validates that a confirmation payload positively reports `confirmed: true`, carries no conflicting `uncertain`/`incident` claim, and names a transaction signature matching the immutable operation hash, and refuses to overwrite a conflicting recorded distribution signature.

## Local verification

| Gate | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | Passed |
| `npm test` | Passed — 42/42 tests |
| `npm run test:migration` | Passed |
| Correction vs claim concurrent race | Passed |
| Correction vs create-or-claim concurrent race | Passed |
| Approval vs correction concurrent race | Passed |
| Standalone staging smoke-test compilation | Passed |
| Standalone Solana fault-test compilation | Passed |
| Dummy-environment production build | Passed with existing dependency warnings |

The migration replay includes regression coverage for atomic reward approval, atomic payout finalization, confirmed-operation/reward repair, distributed-reward/period repair, migration replay, obsolete overload removal, immutable final financial records, and period-lock concurrency.

## Supabase staging smoke test

The smoke test ran against the non-production Supabase project after migration `024` was applied.

```text
✓ atomic reward approval
✓ wallet verification challenge lifecycle
✓ trusted offer click deduplication
✓ payout operation atomic creation and rejection
✓ payout operation rejects stale rewards and mismatches
✓ public API health and rate-limit headers

All staging smoke tests passed.
```

`STAGING_APP_URL` was not configured, so the optional deployed-app HTTP probe inside the public API section was skipped. **This remains an open item:** the skipped probe is the only part of the smoke suite that exercises a deployed Next.js instance rather than the database directly. To close it, set `STAGING_APP_URL` to a non-production deployment and re-run.

These are developer-authored records. The deterministic portion of the suite is independently reproducible in CI (`.github/workflows/dashboard-ci.yml` runs `npm test` and `npm run test:migration` on every push and PR), but the non-production Supabase and devnet steps require credentials and are therefore not reproducible by an outside reviewer from the repository alone.

The test intentionally retained its confirmed payout operation and referenced user/reward/period history because finalised financial records are immutable. Transient fixtures were removed.

## Solana devnet fault validation

The hardcoded staging recipient was replaced with an explicit `STAGING_RECIPIENT_WALLET`. The script now validates that the recipient is a valid on-curve Solana wallet owner before any transaction preparation or broadcast. A deterministic on-curve staging-only recipient was configured locally; its private seed is not used by the test and was not added to the repository.

Network identity was checked before fixture creation, transaction preparation, or broadcast:

```text
Verified Solana devnet RPC (EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG)
✓ prepare real devnet payout submission
✓ broadcast failure preserves durable transaction identity
✓ confirmation of unknown transaction returns uncertain
✓ on-chain mismatch is reported as non-retryable incident

All Solana fault-injection tests passed.
```

The real broadcast used devnet USDC and the already verified devnet `Connection`. The mismatch case deliberately verified the landed transfer against the wrong expected amount and correctly classified it as a non-retryable incident.

## Dependency audit

`npm audit --omit=dev` reported existing transitive dependency advisories:

```text
low: 20
moderate: 70
high: 33
critical: 2
total: 125
```

The branch does not modify `package.json` or the dependency lockfile. These advisories therefore predate this change set. No forced audit remediation was applied because an uncontrolled dependency downgrade can break the Solana payout stack; remediation requires a separate controlled upgrade and full payout regression run.

## Release boundary

This evidence supports review of the Phase 1 hardening pull request. It does **not** authorize merging or production deployment. Merge requires passing GitHub CI on the exact pull-request head SHA and explicit authorization.
