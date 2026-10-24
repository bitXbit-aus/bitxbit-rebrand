# Register sweep — every open claim measured against reality (2026-10-23)

Prompted by four stale-prose findings this engagement (R-009/R-013 summaries, R-010's `a2t2`
misattribution, NA-6's CI diagnosis). Method: **measure each claim, then write** — repo state,
`npm audit`, live production HTTP, the Netlify API, GitHub API, and the Supabase MCP against the
production project. No claim below is taken from the register's own prose.

Legend: ✅ holds · ⚠️ stale/incorrect · 🔴 confirmed open issue

---

## 1. Result table

| # | Claim (register) | Measured 2026-10-23 | Verdict |
|---|---|---|---|
| 1 | **R-001 C1** — Netlify/Linux, `images.unoptimized: true`, no `next/image` | `next.config.mjs` `images.unoptimized: true`; **0** `next/image` imports; site on Netlify | ✅ holds |
| 2 | **R-001 C2** — "All **23** advisories", **2** criticals neutralised | **25** advisories via `next`, **3 criticals**. New: **GHSA-2464-fhr4-w9xw** (SVG image-optimizer RCE, `<=15.5.27`) | ⚠️ **stale** — set grew; all criticals still neutralised by C1 |
| 3 | **R-001 C3** — "**30** Server Actions guarded" | **29 of 30** guarded; `getTokenBalanceAction` unguarded | ⚠️ **off by one** |
| 4 | **R-001 C3** — host validation satisfied | `lib/host-validation.ts` present, enforced in `middleware.ts` | ✅ holds |
| 5 | **R-001 C3** — shared rate limiting live | `/api/health/rate-limit` → 200 `shared:true, backend:supabase` | ✅ holds |
| 6 | **R-001 C3** — request limits explicit | `bodySizeLimit: '1mb'`; `MAX_ASSET_BYTES = 3 MB` | ✅ holds |
| 7 | **R-001 C5** — expires 2026-11-18 | future | ✅ |
| 8 | **R-002** — 4 guard tests, single caller, `Buffer.from` wrap, tracing exclusion | all 4 guards present in `lib/dependency-exposure.test.ts`; exclusion configured | ✅ holds |
| 9 | **R-003** — implemented + released, not closed | module present, enforced in middleware, deployed. **From outside**: spoofed `Host` → Netlify edge **404** (not the app's 400); spoofed `X-Forwarded-Host` → **200** | ✅ holds (precision note §3) |
| 10 | **R-004** — shared atomic store, `027`, `SECURITY DEFINER` | production ledger has `027`; `rate_limit_counters` exists; `check_rate_limit` `SECURITY DEFINER`, **1** overload | ✅ holds |
| 11 | **R-005** — five costly actions bounded | `ACTION_RATE_LIMITS` has exactly 5 | ✅ holds |
| 12 | **R-005** — "Every action is authorization-guarded" | **false** — 1 of 30 unguarded | ⚠️ **contradiction** |
| 13 | **R-006** — explicit limit + tested policy | `bodySizeLimit` explicit; `lib/asset-policy.ts` 3 MB | ✅ holds |
| 14 | **R-007** — migration plan exists | `docs/security/nextjs-15-migration-plan.md` present | ✅ holds |
| 15 | **R-008** — "no ledger … **OPEN, blocking production release**" | production ledger **`001`–`027`**; 6 Phase 1 landmark functions + `rate_limit_counters` present; **PR #1 merged 2026-10-20** | ⚠️ **stale** — resolved |
| 16 | **R-011 / NA-10** — devnet for preview/branch-deploy, prod mainnet | `SOLANA_RPC_URL` = devnet in both preview contexts; **absent** for production (mainnet default). Mints match | ✅ holds |
| 17 | **R-012** — staging fixture holds funded devnet key | derives to `496yh6GUc7J7q8sepdoD9mgpf2Z38U54pB5kGsAqoGyU` | ✅ holds |
| 18 | **R-013** — "**OPEN** — local link targets wrong site" | `.netlify/state.json` = `9617719a-…` (correct) | ⚠️ **stale** — closed via NA-12 |
| 19 | **R-014** — publishable key in bundle, legacy JWT absent | login bundle: `sb_publishable_` in **2/15** chunks; legacy JWT header in **0/15** | ✅ holds |
| 20 | **NA-6** — CI trigger unresolved | all 41 PRs carry the required check | ✅ closed (separate PR #42) |
| 21 | **NA-7** — preserve PR #1's approval | PR #1 **merged** 2026-10-20 | ⚠️ **moot** |
| 22 | **NA-9** — secrets flagged | `SUPABASE_SERVICE_ROLE_KEY` `is_secret: true` | ✅ holds |
| 23 | **`getTokenBalanceAction`** — no auth guard | **confirmed**: 1 of 30 unguarded, in a `"use server"` module | 🔴 **open** |
| 24 | Gate: `tsc` + tests | `tsc --noEmit` exit 0; **162/162** tests pass (36 suites, 0 fail) | ✅ holds |

**Not re-measured (no instrument used):** R-005/R-006 "verified in a deployment" — those controls
are behind authentication and were verified on a deployed preview in a prior session; nothing here
contradicts them. R-002's "`.next` contains 0 `.node` files" — the guard test asserts the tracing
exclusion; the post-build file scan was not repeated.

---

## 2. R-001 Condition 2 — the advisory set has grown (the material finding)

`npm audit` against `next@14.2.35`, measured 2026-10-23: **25 advisories**, **3 criticals**
(the register records 23 and 2). All 25 GHSAs:

**Critical (3):**
- `GHSA-2464-fhr4-w9xw` — RCE in the **Image Optimization API (SVG)** — `>=10.0.0 <=15.5.27` — **NEW**
- `GHSA-2xp9-vwfh-vxw4` — RCE in the Image Optimization API (AVIF) — `>=10.0.0 <15.5.24`
- `GHSA-p293-qw3h-jr36` — RCE on Windows-hosted servers — `>=13.4.0 <15.5.24`

**High (9):** `GHSA-h25m-26qc-wcjf`, `GHSA-q4gf-8mx6-v5v3`, `GHSA-8h8q-6873-q5fj` (RSC DoS);
`GHSA-c4j6-fc7j-m34r` (SSRF via WebSocket upgrades); `GHSA-36qx-fr4f-26g5` (Pages Router i18n bypass);
`GHSA-m99w-x7hq-7vfj`, `GHSA-p3m5-59mp-jv5r` (Server Actions DoS — **two** now, one recorded);
`GHSA-89xv-2m56-2m9x`, `GHSA-p9j2-gv94-2wf4` (SSRF in Server Actions / rewrites).

**Moderate (11):** `GHSA-3x4c-7xq6-9pq8`, `GHSA-4633-3j49-mh5q`, `GHSA-4c39-4ccg-62r3`,
`GHSA-68g3-v927-f742`, `GHSA-955p-x3mx-jcvp`, `GHSA-9g9p-9gw9-jx7f`, `GHSA-ffhc-5mcf-pf4q`,
`GHSA-ggv3-7p47-pfv8`, `GHSA-gx5p-jg67-6x7h`, `GHSA-h64f-5h5j-jqjh`, `GHSA-wfc6-r584-vfw7`.
**Low (2):** `GHSA-3g8h-86w9-wvmq`, `GHSA-vfv6-92ff-j949`.

**Consequences, stated precisely:**
1. The new critical is an **Image Optimization API** RCE — the same class as the AVIF one already
   accepted — and is neutralised by the **same Condition 1 control** (`images.unoptimized: true`,
   Linux host). So the *acceptance* is not broken; the *record* was incomplete.
2. It affects `<=15.5.27`, so **15.5.26 no longer clears every advisory** — the minimum is now
   **15.5.28**, which is exactly the approved D1 target. R-007's "15.5.26 is the minimum" is
   superseded (D1's target is unaffected).
3. `npm audit`'s only suggested fix is `next@16.4.3` (semver-major) — which **D1 forbids**. The
   correct fix path remains the approved 15.5.28.
4. The register's cadence says "review on every advisory-DB refresh" — this is that refresh.
   A full row-by-row re-ruling is due at the **2026-11-18** review; the added high/moderate
   entries fall in categories already ruled (image-optimizer → N/A; RSC/Server-Action DoS → accepted).

---

## 3. R-003 — what is actually observable from outside

- Normal request → **200**.
- `Host: evil.example` → **HTTP 404**, body `Not Found - Request ID: …` — that is **Netlify's edge**,
  not the application's `400 Bad Request: unrecognised host.` The edge routes by Host, so the
  spoofed request never reaches the app.
- `X-Forwarded-Host: evil.example` (valid Host) → **200**. `validateRequestHost` checks **both**
  `host` and `x-forwarded-host` (code confirmed), so a 200 means the edge **normalises/overwrites**
  `x-forwarded-host` before the function sees it.

**So the app-layer refusal is not exercisable from outside on this deployment** — which is exactly
the register's framing ("the edge governs; the application check is defence-in-depth"). The
app-layer control is proven by unit tests (`lib/host-validation.test.ts`, part of the 162) and by
the local integration run already recorded under NA-1. Recorded here so "refusal path proven" is
not read as "observed in production" — the production refusal is the edge's 404.

---

## 4. 🔴 The one confirmed open issue — `getTokenBalanceAction`

`lib/actions.ts` is a `"use server"` module, so **every export is a publicly callable Server
Action endpoint**. Measured: **30 exports, 29 guarded, 1 not**.

```ts
export async function getTokenBalanceAction(walletAddress: string) {
  return getTokenBalance(walletAddress);
}
```

No `requireActiveUser` / `requireCapability`. An **unauthenticated** caller can invoke it and cause
an on-chain RPC read for an arbitrary address.

**Impact:** not confidentiality — SPL token balances are public chain state. It is an
**unauthenticated work/amplification vector** (drive RPC calls) and it contradicts the register's
own access-control claim. It is *not* a trivial fix: the register already notes these actions are
"called on render paths whose callers expect a balance, so a refusal object would break the page" —
guarding it needs its own design (a returned refusal the callers tolerate, or removal from the
client surface). **Assess on its own; not changed by this sweep.**
