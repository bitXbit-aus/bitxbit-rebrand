# R-007 — independent review record (2026-10-24)

**What this is:** an adversarial review of PR #49 by two independent reviewers with **no memory of
implementing the change** — one static (attack the diff), one dynamic (re-run the gate and try to
falsify the claims). Findings were **not** accepted on the reviewers' word: each substantive one was
re-measured here, and two did not survive that.

**What this is NOT:** the human independent review the register requires (M8). Fresh-context agents
are independent of the *implementer*, but they are not human sign-off and share the same model family.
**M8 remains outstanding.**

**Also measured:** this agent cannot approve PR #49 — the automation credential *is* the PR author
(`bitXBit-aus`, id 226046989) and GitHub returns `422 "Review Can not approve your own pull request"`.
Separately, `main`'s protection currently sets `required_pull_request_reviews: None` with no rulesets,
so there is **no GitHub-enforced review gate**; the review is a process requirement, not a control the
platform enforces.

---

## Findings, with disposition

| # | Finding (as reported) | Reported | Disposition |
|---|---|---|---|
| 1 | Middleware **redirect branches discard the refreshed session cookie**, because each returns a fresh `NextResponse.redirect` that never receives `setAll`'s writes | high | **CONFIRMED** — consequence **overstated** |
| 2 | `setAll` reassigns `response`, so a second call in one request drops the first batch | medium | **NOTED** — inherited from the canonical `@supabase/ssr` pattern; no evidence of a second call in middleware |
| 3 | `next-env.d.ts` references a gitignored generated file, breaking `tsc --noEmit` on a clean checkout | medium | **FALSIFIED** |
| 4 | Removing `NextRequest.ip` collapses unresolved clients into one shared `anonymous` rate-limit bucket | medium | **CONFIRMED as a behaviour change**, bounded — see below |
| 5 | The R-002 exclusion evidence is non-falsifying | low | **CONFIRMED, and stronger than reported** |
| 6 | The register and the first evidence doc contradict each other | low | **CONFIRMED** — our error, fixed |
| 7 | The new gate is not wired into CI, so it is not really a "gate" | low | **CONFIRMED** — wording fixed |
| 8 | "`npm audit`: `next` advisories 25 → 0" is not true verbatim | — | **CONFIRMED** — wording fixed |

## 1 — Redirect branches drop the refreshed cookie (CONFIRMED)

`setAll` writes refreshed cookies onto `response`; all four redirect branches return
`NextResponse.redirect(...)`, a new object that never receives them.

Measured on `deploy-preview-49` with an expired-access cookie:

| Branch | Result |
|---|---|
| **200 branch** (active member) | `200` — **`Set-Cookie` present** |
| **Redirect branch** (suspended member) | `307 → /auth/login?error=account_inactive` — **`Set-Cookie: NONE`** |

**Pre-existing, not a regression.** `origin/main` is structurally identical — the old `set`/`remove`
also wrote onto `response`, and the same four bare redirects are there — so the migration preserved
behaviour exactly as intended. It is **not** something this PR broke.

**Consequence is narrower than reported.** The review predicted silent logout via refresh-token
rotation. Replaying the same cookie **16 s later** still authenticated and refreshed again, so **no
immediate logout reproduced**. Real effect: on a redirect path the browser is never given the refreshed
session, so it holds an expired access token and re-refreshes every request, surviving while the
refresh token remains valid. Whether a stricter rotation setting could end the session is **not
measured**.

**Disposition: recorded, not fixed.** The fix (carry `response.cookies` onto the redirect response) is
small but changes middleware behaviour beyond this migration's scope, and this PR is already awaiting
review — recommended as its own change.

## 3 — tsc on a clean checkout (FALSIFIED)

The review claimed `/// <reference path="./.next/types/routes.d.ts" />` in `next-env.d.ts` breaks the
documented `npx tsc --noEmit` gate when `.next` is absent (TS6053), and that CI could not catch it.
Measured: with `.next` **moved aside**, `npx tsc --noEmit` **exits 0**. The claim does not hold.

## 4 — Rate-limit fallback (CONFIRMED, bounded)

With `NextRequest.ip` gone, any client that `resolveClientIp` cannot resolve shares the single key
`anonymous`. On **Netlify** this is unchanged (`request.ip` was never populated there), which is what
the code comment and evidence say — but the review is right that on a non-Netlify runtime, or when the
Netlify anchor header is missing/malformed, that is one global counter, so a single caller could
exhaust the allowance for everyone. **Recorded**; the app is Netlify-only, so the blast radius is
bounded, and the docs now state the condition rather than asserting "no behavioural change".

## 5 — R-002 exclusion is inert (CONFIRMED, stronger than reported)

The review argued `0 .node files in .next` cannot distinguish "exclusion working" from "exclusion
unnecessary". It is worse than that: **removing the exclusion entirely and rebuilding also yields 0**
`.nft.json` traces mentioning `bigint-buffer` and 0 `.node` files — identical to the build with it.

| Check | With exclusion | Exclusion removed |
|---|---|---|
| `.nft.json` traces mentioning `bigint-buffer` | **0** | **0** |
| `.node` files in `.next` | 0 | 0 |
| addon present in `node_modules` (control) | yes | yes |

So the exclusion is **inert today**, and R-002's real protection is that no traced server path reaches
the addon — not the exclusion. Keeping it correctly placed remains right (it is the belt to that
braces, and would matter if an import path changed), but it must not be recorded as the thing
currently preventing exposure. Both documents corrected.

## 6, 7, 8 — our own errors, corrected

- **Contradiction (6):** the first evidence doc still listed the authenticated path as an unverified
  release blocker after the second doc verified it. Reconciled; the doc now records what was verified
  and the gap above.
- **"Gate" wording (7):** the script is a **manual** gate — it needs a staging service-role credential
  and a live preview, so it cannot run in CI. Described as such now.
- **Audit wording (8):** "`next` advisories 25 → 0" is imprecise. `npm audit` **still lists a `next`
  node** (moderate) because `next` depends on a vulnerable `postcss`; **zero advisories target `next`
  itself**. Corrected in the evidence and the register.

## What the review did not find

No unawaited server-side `createClient()` (all 24 call sites await it); no synchronous `params`/
`searchParams` reads beyond the one already fixed; no `"use server"` export missing its guard; no
debug code, sensitive logging, weakened validation, stray dependency or unexpected config default; the
`lib/supabase/server.ts` adapter is correct and accumulates writes on the mutable cookie store; and the
mechanical gate re-ran clean (see below).

## Independent re-verification of the gate

Six of seven claims held under independent re-run: `npm ci` exit 0 · `tsc` 0 errors · **167/167** on a
verified-clean environment · migration replay + 4 race tests · build exit 0 with no `Unrecognized key`
warnings and 0 `.node` files · **authorisation matrix 12/12, exit 0, teardown clean**. The seventh
("zero `next` advisories") is the wording correction in §8 above.
