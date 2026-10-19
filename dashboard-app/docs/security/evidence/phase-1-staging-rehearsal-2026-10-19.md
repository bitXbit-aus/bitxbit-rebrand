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

## D4 — deployed-app HTTP test — SATISFIED (2026-10-19, later the same day)

**Correction:** this section originally recorded D4 as unsatisfiable because no staging-scoped
deployment existed. That was accurate at the time. A preview rebuild resolved it, and the test has
now run.

| Step | Result |
|---|---|
| Preview rebuilt | deploy `6ad6a1fddbd521239c086a6a`, 2026-10-19 23:04:29, state `ready`, commit `bdbdf003` |
| `npm run test:staging` with `STAGING_APP_URL` set | **all sections pass**, the `(skipped: STAGING_APP_URL not set)` line is gone |
| Endpoints asserted by D4 | `/api/public/offers`, `/api/public/transparency`, `/api/token-stats` — all **HTTP 200** |

### Isolation proven by use, on three independent levels

1. **Client bundle.** The login chunk is now `page-92e32d7a3dacb964.js` — a *different hash* from
   the production bundle's `page-9473d2fb1854e1df.js`, i.e. a genuinely different build environment.
   It contains `https://luqrwhgjtiyfmeawbtmp.supabase.co` (staging) and **zero** occurrences of
   `flasgvendiiasuixeqzu` (production).
2. **Runtime configuration.** `/api/token-stats` reports mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
   — **devnet** USDC. Production reports `DK6PWMyu…UH5` (mainnet).
3. **Runtime data.** `/api/public/offers` on the preview returns **"Staging Smoke Offer"**;
   production returns **"KAST"**. Different rows from different databases — the strongest available
   evidence that the deployed app reads staging, not production.

### Harness limitation, stated rather than implied

The D4 section is named *"public API health and rate-limit headers"*, but the rate-limit assertion
is an **empty branch** — the code comments it as optional and never fails on a missing header. The
test therefore verifies only that three endpoints return HTTP 200. No rate-limit header was present
on the preview responses. Treat the section name as overstating what it checks.

### R-009 residue closed

The rebuild alone did **not** clear the residue, contrary to an earlier claim here: Netlify serves
each deploy at its own immutable URL, and the stale production-wired preview remained reachable at
`https://6ad5779612fbd9e162ffbf39--bitxbit-dashboard.netlify.app` (HTTP 200, 1 production reference,
0 staging) after the rebuild.

All **seven** production-wired preview deploys were deleted:

```
6ad5779612fbd9e162ffbf39  6ad57512a51b157ce3564e22  6ad56031cf94e67c3dd805e3
6ad55bc8399a41b9cd019782  6ad55a3bfdfcee7dc15b9380  6ad5576bd488cb7540b3eac8
6ad54ac7c46d918def476ecb
```

Verified after deletion: every deploy-specific URL returns **404**, the staging preview returns
**200**, and production returns **200** and was untouched.

### Triggering a preview rebuild — what failed

Two automated attempts failed and were stopped rather than varied:

- `netlify deploy --build --context deploy-preview` → `Error: Project not found`. The CLI resolves
  sites within a team context (`LivingCodex`) while `bitxbit-dashboard` belongs to the `millsy`
  account, so the deploy path cannot resolve the project even though the API reads it by ID.
- A build hook created via `netlify api createSiteBuildHook --data '{"branch": "..."}'` returned
  **`"branch": null`** — the field was silently dropped, producing a hook that would have rebuilt
  **production**. It was deleted without ever being invoked. The guard was inspecting the response
  *before* posting to the URL; without that check this would have deployed production.

The rebuild was therefore performed from the site UI (deploy row → Retry deploy → Clear cache and
retry deploy), which rebuilds that branch in that context with current environment values.

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
