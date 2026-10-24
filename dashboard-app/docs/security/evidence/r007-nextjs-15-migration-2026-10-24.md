# R-007 — Next.js 15.5.28 migration: implementation and staged regression (2026-10-24)

**Status:** IMPLEMENTED — automated gate green, staged regression (D4) green on a Next 15 preview.
**NOT complete:** the **authenticated** half of the authorisation matrix and **independent review
(M8)** are outstanding. See §5 — do not read this as release-ready.

Implements `docs/security/nextjs-15-migration-plan.md` (D1–D4).

---

## 1. What changed

| Area | Change |
|---|---|
| Deps (M1) | `next` 14.2.35 → **15.5.28** (D1 target) · `react`/`react-dom` 18 → **19.1.10** · `@types/react(-dom)` 19 · `@supabase/ssr` 0.1.0 → **0.12.7** · `@supabase/supabase-js` ^2.39 → ^2.114 (resolved **2.117.1**) · `eslint-config-next` 15.5.28 |
| Async request APIs (M3) | `await cookies()`; **`createClient()` is now `async`** and **24 call sites await it**. `app/admin/users/page.tsx` types `searchParams` as a Promise and awaits it. `lib/rate-limit.ts` drops the removed `NextRequest.ip`. |
| Supabase cookie adapter (M4) | `get`/`set`/`remove` → **`getAll`/`setAll`** in `lib/supabase/server.ts` and `middleware.ts` |
| Config | `outputFileTracingExcludes` **moved from `experimental` to top level** (see §2) |

**Two things the types alone would not have caught**, both found by measuring rather than compiling:

1. **`app/admin/users/page.tsx`** declares its *own* `PageProps` interface, so `tsc` reported **no
   error** while `searchParams.search` would have been `undefined` at runtime in Next 15. Found by
   grepping for `searchParams` rather than trusting a green `tsc`.
2. **`outputFileTracingExcludes`** (below) — a build-time warning plus a silent behavioural loss.

## 2. A silent control loss found by the build

Next 15 **moved `outputFileTracingExcludes` from `experimental` to the top level**. Left as it was,
the build reported:

```
⚠ Unrecognized key(s) in object: 'outputFileTracingExcludes' at "experimental"
```

That is not cosmetic. That exclusion is **R-002's structural backstop** — it keeps
`bigint-buffer`'s vulnerable **native addon** out of the traced server bundle so the safe pure-JS
fallback is what runs. Unrecognized means **silently ignored**, i.e. the addon would have been
traced back in. Moved to top level; verified:

| Check | Result |
|---|---|
| `Unrecognized key(s)` warnings in a fresh build | **0** |
| `.node` files in `.next` | **0** |
| `bigint-buffer` directories in `.next` | **0** |
| native addon present in `node_modules` (so the exclusion is meaningful) | **yes** |

## 3. Automated gate — all green

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm test` | **167/167** (29 suites) |
| `npm run test:migration` | replay + **4 race tests** pass |
| **`npm ci`** (the exact CI install, no `--legacy-peer-deps`) | **exit 0** — after the fix in §3a; this is what caught the defect |
| production build (dummy env) | **exit 0**, no unrecognized-config warnings |
| `npm audit` | **`next` advisories 25 → 0** |

`npm audit` remaining criticals are `protobufjs` and `tar` in the **wallet-adapter tree** — recorded
under R-002 and explicitly out of scope for this migration (plan §8).

## 3a. `npm ci` caught a real defect that the local run missed

§3's gate was first run with **`npm install`**, which *tolerates* a conflicting peer (it only warns:
`ERESOLVE overriding peer dependency`). **CI runs `npm ci`, which is strict — and it failed:**

```
npm error Could not resolve dependency:
npm error peer react@"^16.5.1 || ^17.0.0 || ^18.0.0" from lucide-react@0.344.0
```

`lucide-react@0.344.0` simply cannot be installed alongside React 19. **`0.400.0` is the first
release whose `react` peer includes `^19.0.0`**; a programmatic sweep of the installed tree
confirmed it is the **only** direct dependency whose react/react-dom peer excludes 19. Bumped, and
re-verified with the strict install: **`npm ci` exit 0** · tsc 0 · 167/167 · build exit 0 · `next`
still absent from the audit.

**This is a forced deviation from plan §8** ("No dependency upgrades outside the Next/React/Supabase
set"). React 19 is mandatory for the App Router (D2), so a peer-incompatible UI package cannot stay.
Recorded rather than hidden — the plan did not anticipate it.

**A note on the local gate, stated because it was briefly untrue.** One local `npm test` run showed
**165/167**. Both failures were **environment-dependent**, not migration defects:
`BITXBIT_TOKEN_DECIMALS=6` (and the other staging variables) had leaked into the shell from the
staging suite, so "uses 9 decimals by default" and one payout-preparation test failed. With a clean
environment the suite is **167/167**. CI runs clean. The staging variables are now unset.

**M5 (caching intent) needed no change:** both third-party `fetch` sites in
`app/api/token-stats/route.ts` already carry explicit `next: { revalidate: … }`, and the response
sets `Cache-Control`. The other two `fetch` sites are **client-side** and unaffected by Next's
server fetch-cache default.

**`lint` script:** `next lint` is deprecated but **is not part of the gate** and the repo has **no
ESLint config at all**, so `next lint` (and a direct `eslint` invocation) would do nothing. Left
unchanged rather than inventing a config; noted for the Next 16 migration.

## 4. Staged regression — M7 / D4

Deploy preview **`deploy-preview-49`** (`6adc3880`), built from this commit:
`https://deploy-preview-49--bitxbit-dashboard.netlify.app`

**D4 staging isolation — verified, not assumed:**

| Requirement | Evidence |
|---|---|
| Staging Supabase only | 15 chunks scanned: **1** contains the staging ref `luqrwhgjtiyfmeawbtmp`, **0** contain the production ref `flasgvendiiasuixeqzu` |
| Solana devnet only | `/api/token-stats` reports mint **`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`** (devnet USDC); the fault suite independently verifies genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Runtime data | `/api/public/offers` → `{"offers":[]}` — matches staging's empty table, where production returns `KAST` |
| Shared store reachable | `/api/health/rate-limit` → 200 `shared:true, backend:supabase` |

**`npm run test:staging` — all passed** (invoked with `STAGING_APP_URL` set to the preview above;
the in-repo script reads `STAGING_APP_URL` — source-verified, *not* the external `D4_APP_URL`
wrapper the evidence notes warn about):

- atomic reward approval · wallet verification challenge lifecycle · trusted offer click deduplication
- payout operation atomic creation and rejection · payout operation rejects stale rewards and mismatches
- **public API health and rate-limit headers** (the D4 section ran; rate-limit store healthy, `backend: supabase`)

**`npm run test:solana-fault` — all passed:** prepare real devnet payout submission · broadcast
failure preserves durable transaction identity · confirmation of unknown transaction returns
uncertain · on-chain mismatch reported as non-retryable incident.

**§5.3 authorisation matrix — the rows observable without a session:**

| Case | Expected | Observed on the preview |
|---|---|---|
| Unauthenticated → `/dashboard` | 307 → `/auth/login` | **307 → /auth/login** ✅ |
| Unauthenticated → `/admin` | 307 → `/auth/login` | **307 → /auth/login** ✅ |
| Unauthenticated → `/dashboard/wallet` | 307 → `/auth/login` | **307 → /auth/login** ✅ |
| Unauthenticated → `/admin/users` | 307 → `/auth/login` | **307 → /auth/login** ✅ |

Middleware security headers intact (`x-frame-options: DENY`, `x-content-type-options: nosniff`,
`referrer-policy`, CSP) and `/api/health/rate-limit` served with `cache-control: no-store` and
`x-ratelimit-degraded: false`.

## 5. NOT verified — release blockers

**1. The authenticated session path — the plan's highest-risk item.** The `setAll` cookie branch
in the adapter is **not exercised** by any of the above: nothing above signs a user in. The plan
warns (§3.3) that a subtly wrong adapter here causes **silent session loss rather than an error**,
which no build and no unauthenticated probe can detect. It needs a **real sign-in on the preview**
followed by a session-refresh and a protected-route load.

**2. The remaining authorisation-matrix rows**, which all require a session: active member →
`/dashboard` allowed; suspended member → redirect with `error=account_inactive`; active member →
`/admin` → `/dashboard`; active admin → `/admin` allowed; authenticated → `/auth/login` → `/dashboard`;
capability denial on privileged actions.

**3. Independent human review (M8).** The register's division of authority is explicit: self-review
by the implementing agent does not satisfy independent review. This migration cannot be approved by
the agent that wrote it.

**Also recorded:** no production deployment; **no schema change** (plan §6 — if that ever changes it
stops being a single-PR migration); `images.unoptimized: true` unchanged, so R-001's Condition 1
control still holds.
