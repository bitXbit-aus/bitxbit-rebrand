# Register corrections — 2026-10-24

Follow-on to the 2026-10-23 sweep, after the R-007 implementation session. Three entries were
corrected or tightened; one of them corrects **this agent's own** premature statement.

---

## 1. R-011 — "no devnet constraint for non-production": status corrected

**Was:** *"ADDRESSED for preview/branch-deploy — unverified in a deploy."*

**Now:** **VERIFIED IN CONFIGURATION 2026-10-24**, with one recorded residual.

Measured per context through the Netlify API — i.e. the value Netlify injects into those deploys.
`SOLANA_RPC_URL` is server-only (it is not a `NEXT_PUBLIC_*` value), so it does not appear in the
client bundle; the platform config is the correct and only source for it.

| Context | `SOLANA_RPC_URL` | Explicit? |
|---|---|---|
| `branch-deploy` | `https://api.devnet.solana.com` | ✅ |
| `deploy-preview` | `https://api.devnet.solana.com` | ✅ |
| `production` | *(no value)* | ❌ — falls back to the code default `https://api.mainnet-beta.solana.com` (`app/api/token-stats/route.ts:7`, `lib/payout.ts:17`, `lib/solana.ts:60`) |

R-011's stated required action was to make the constraint *configuration rather than convention*.
For non-production that is now true and measured. **Residual:** production has no explicit value —
the recorded deliberate choice (mainnet) is realised as a *code default*, not configuration.
Setting one is a one-line Netlify change but **requires a production deploy**, so it is left to the
owner rather than done here.

### The runtime confirmation was attempted and did NOT succeed — recorded deliberately

The claim "verified in a running deployment" (the old entry's own bar) is **not** met, and the
attempt is recorded so a later reader does not assume it was.

`app/api/token-stats/route.ts` is the only **public** path that exercises the RPC, via
`fetchHolderCountViaRpc()` — a fallback that runs exactly when Birdeye is absent, i.e. on previews,
where `BIRDEYE_API_KEY` is deliberately unset (R-009).

| Target | `mint` | `holders` | `errors` |
|---|---|---|---|
| preview `deploy-preview-49` | `4zMMC9…ncDU` (devnet) | `null` | `["BIRDEYE_API_KEY not configured","RPC holder count failed"]` |
| production `app.bitxbit.com.au` | `DK6PWM…UH5` (mainnet) | `428` | `[]` |

The preview's RPC call **failed**, and production **never reaches the fallback** because Birdeye
answers. Public Solana endpoints reject `getProgramAccounts`, so the preview's failure is
**consistent with either cluster and discriminates nothing**. This measurement therefore proves
nothing about which endpoint the deployed preview used — the per-context config read in §1 is the
evidence, and the endpoint was never observed at runtime.

**Side observation (not a risk).** That fallback is effectively **dead on public endpoints**, so
`holders` is `null` whenever Birdeye is unconfigured. The route reports the error, so it is legible
rather than misleading — which **corroborates** R-009's note that removing the preview key
*"improves legibility rather than removing working functionality"*.

### Correction of this agent's own statement

Before measuring, this agent told the operator that **"this session satisfied R-011"**. That was
**wrong**. It rested on the preview reporting the **devnet mint** — which is `BITXBIT_TOKEN_MINT`, a
*different variable*, already recorded under D4 — and on a devnet genesis check run **locally**, not
against the deployment. Neither observes `SOLANA_RPC_URL` in a deploy. The claim is withdrawn and
replaced by the measurement above. Same defect class as the stale prose this sweep exists to catch:
a conclusion recorded ahead of its evidence.

---

## 2. R-010 / NA-9 — closure scope made explicit

R-010 is CLOSED and its summary row pointed at **NA-9**, which is OPEN — reading as though a closed
risk still had outstanding work.

Both are true and are not in conflict: **R-010 closed the two high-value secrets**;
**NA-9 is the `is_secret` flag across the remaining credential set**, withheld deliberately and
**not blocked** — its stated precondition (an observable deployment) has been met since 2026-10-22,
so it awaits **owner authorisation**. The summary row now says so explicitly instead of leaving a
bare `NA-9`.

---

## 3. R-002 — review date confirmed, and disambiguated from R-007

The 2026-11-18 review stands. Added: **R-002 is not cleared by R-007.** The migration removes the 25
`next` advisories; `bigint-buffer` remains in the tree and in the wallet-adapter stack either way,
so the two must not be closed together.

---

## What was NOT changed

- **R-001** — still expires **2026-11-18 (25 days from this entry)** and is still purely a decision.
  Its closure path is unchanged: release R-007 (advisories 25 → 0) **and** obtain the independent
  review that also unblocks R-003.
- **R-003 / the independent-review waiver** — untouched; it is a human judgement, not a correction.
- No production configuration was changed by this entry.
