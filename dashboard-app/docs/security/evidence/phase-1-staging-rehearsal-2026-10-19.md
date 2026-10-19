# Phase 1 staging rehearsal — 2026-10-19

Rehearsal of PR #1 (`security/phase-1-hardening`) before any production change, per Decision D4.
Run against the **staging** Supabase project and **devnet**. No production resource touched.

## What was rehearsed

| Item | Value |
|---|---|
| Commit under test | `bdbdf003` (PR #1 head) |
| Working copy | clean `git worktree` at that commit, not the dev branch |
| Node / npm | v22.22.3 / 10.9.8 |
| Install mode | `npm ci --legacy-peer-deps` — matches `NPM_FLAGS` in `dashboard-app/netlify.toml` |
| Packages installed | 1706 |
| Next.js resolved | `14.1.0` (PR #2's 14.2.35 bump is not in this range — correct for this stage) |
| Staging Supabase | `luqrwhgjtiyfmeawbtmp` |
| Airdrop / token | devnet wallet `496yh6…GyU`, devnet USDC mint `4zMMC9s…ncDU`, decimals 6 |

## Results

### 1. Migration state on staging — already complete

The staging migration ledger holds the **full chain `001`–`027`**, including the `010`–`026` range
PR #1 depends on and `027` from PR #5. No migration needed to be applied for this rehearsal; the
staging database is already ahead of the range under test.

### 2. Unit tests — 42/42 pass

Run in a **clean environment** with the staging variables explicitly unset, so ambient credentials
could not change the result:

```
# tests 42   # pass 42   # fail 0   # skipped 0
```

### 3. Migration replay — pass, including three concurrency races

`scripts/test-phase1-migration-replay.sh` against a throwaway database:

```
migration replay verification passed (first apply + validated constraint + second apply)
concurrent correction-vs-claim race test passed (blocked 1546ms, claim returned NULL, payout cancelled)
concurrent create_or_claim vs correction race test passed (blocked 1541ms, creation failed, no operation inserted)
concurrent approval-vs-correction race test passed (blocked 1549ms, replacement rewards approved atomically)
```

The races are the meaningful part: each shows a real block of ~1.5 s, which is what distinguishes
genuine lock contention from a test that passed because nothing was concurrent.

### 4. Staging smoke tests — all pass

Against staging Supabase and devnet:

```
✓ atomic reward approval
✓ wallet verification challenge lifecycle
✓ trusted offer click deduplication
✓ payout operation atomic creation and rejection
✓ payout operation rejects stale rewards and mismatches
✓ public API health and rate-limit headers
All staging smoke tests passed.
```

## What did NOT run — and why

**D4's mandatory deployed-app HTTP test is still unsatisfied.** The suite reports:

```
  (skipped: STAGING_APP_URL not set)
```

This is not an oversight that a variable would fix. It requires a **deployed preview that is
verifiably staging-scoped**, and no such deployment exists:

- The existing preview (`deploy-preview-1--bitxbit-dashboard.netlify.app`, 7 deploys, one URL) was
  built **before** the credential re-scoping. Its login chunk contains
  `createClient("https://flasgvendiiasuixeqzu.supabase.co", …)` — the **production** project — and
  `/api/token-stats` on it returns **mainnet** data, while the re-scoped `deploy-preview` context
  specifies devnet. Its chunk hash is identical to the production bundle's.
- Building a fresh staging-scoped preview via `netlify deploy --build --context deploy-preview`
  failed twice with `Error: Project not found`. Diagnosis: the CLI session resolves sites within a
  team context (`LivingCodex`), while `bitxbit-dashboard` belongs to the `millsy` account, so the
  deploy path cannot resolve the project even though the API can read it by ID. Stopped rather than
  repeating the command with variations.

Therefore D4 remains **open**, and so does the R-009 residue for those seven preview deploys: until
they are deleted and a staging-scoped preview is built, a reachable Netlify preview is running
production credentials.

## Release-gate finding — independent review is NOT satisfied

The Netlify CLI identifies the operating account as:

```
Name:   Matt Mills
Email:  millsy@protonmail.com
GitHub: bitXBit-aus
```

`bitXBit-aus` is the account that authored the PRs and whose token drives this automation. The
approving reviewer on PR #1 is `bitXBit-matt` — a different GitHub handle, but the naming and the
single-owner context make it very likely the same person. **Treat PR #1's approval as not
independent until a separate human is confirmed.**

Per the governance section of `risk-register.md`, the AI agent has no authority to accept risk or
approve a release; the independent review must come from a separate qualified human.

## Residual risks for this rehearsal

- **Structural, not behavioural, migration evidence.** The staging database being at `001`–`027`
  proves the chain applies to *staging*. It does not prove it applies to production, whose starting
  state is `pre-010` and which was built by hand with no ledger — see the production preflight
  evidence for that separate check.
- **No production backup taken**, because no production change was made.
- **Devnet, not mainnet.** Token transfers exercised devnet USDC at 6 decimals; production uses 9.
- **`next@14.1.0` here.** The interim bump to `14.2.35` (PR #2) has not been rehearsed in this run
  and still carries its own 30-day risk exception.
