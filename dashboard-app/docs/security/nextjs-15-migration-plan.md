# Next.js 15 Migration Plan

**Date:** October 19, 2026
**Authorisation:** Decision C — approved by the project owner, October 19, 2026.
**Status:** PLAN — for review. No implementation has begun. Nothing will be
deployed to production without separate approval.
**Branch:** to be created as `security/nextjs-15-migration` (separate branch and
pull request, per Decision C).

---

## 1. Objective

Remediate the residual Next.js advisories accepted under R-001 by moving to a
fully patched Next.js release, and close related findings (R-003 host-header
validation, R-005 Server Action rate limiting, R-006 request limits) while the
codebase is open.

**Target: `next@15.5.28`.**

## 2. Dependency-audit verification (target selection)

Verified against current advisory data (`npm audit --omit=dev`, October 19, 2026),
computing each advisory's range against candidate versions with `semver`:

| Candidate | `next` advisories remaining | critical | high | moderate | low |
|---|---|---|---|---|---|
| 14.1.0 (installed) | **34** | 3 | 12 | 15 | 4 |
| 14.2.35 (interim PR) | 21 | 2 | 7 | 10 | 2 |
| 15.5.26 | **0** | 0 | 0 | 0 | 0 |
| 15.5.27 | 0 | 0 | 0 | 0 | 0 |
| **15.5.28 (target)** | **0** | 0 | 0 | 0 | 0 |
| 16.4.2 (latest) | 0 | 0 | 0 | 0 | 0 |

**The minimum fully-clearing version is `15.5.26`**, not 15.5.27. `15.5.28` is the
latest 15.5.x (also published under the `backport` dist-tag) and is the requested
target — it clears all 34 `next` advisories with two patch releases of margin.

`latest` overall is 16.4.2. **This plan targets 15.5.x deliberately**: it is the
minimum jump that removes the advisories, and 16.x would stack a second major
migration on top. See open decision **D1**.

**Expected end state:** with `next@15.5.27+`, `next` drops out of the audit
entirely. The remaining production advisories are the wallet-adapter tree and
`bigint-buffer` (R-002) — neither of which Next.js 15 addresses.

## 3. Compatibility assessment

### 3.1 Next.js ↔ React — **React 19 is REQUIRED**

`next@15.5.28` declares `react: "^18.2.0 || ^19.0.0"`. **This is misleading for
this app.** React 18 remains permissible only for the **Pages Router**; the
**App Router requires React 19**. This dashboard is App Router only, so:

> **React 19 is mandatory for this migration**, not optional.

That expands scope well beyond a version bump: `react`, `react-dom`,
`@types/react`, `@types/react-dom` all move to 19.x, current `^18.2.0` / `^18`.

| React 19 change | Impact here |
|---|---|
| `useFormState` → `useActionState` | None found — no `useFormState` usages |
| `ReactDOM.render` removed | None found |
| String refs removed | None found |
| New JSX transform / type changes | 4 client components to re-check |
| `react-server` condition enforced in middleware | Verify middleware has no client-only React imports |

Installed React is 18.3.1 — already the recommended pre-19 version, which reduces
deprecation noise.

### 3.2 Async request APIs — the largest source of breakage

In Next.js 15, `cookies()`, `headers()`, `draftMode()`, `params`, and
`searchParams` are **Promises**. Concrete impact found by inspection:

| File | Current code | Required change |
|---|---|---|
| `lib/supabase/server.ts:5` | `const cookieStore = cookies()` | `const cookieStore = await cookies()`; **`createClient()` becomes `async`** — every caller must `await` it |
| `app/admin/users/page.tsx:14-20` | `searchParams.search`, `.role`, `.status`, `.page` used synchronously | Await `searchParams`; `PageProps.searchParams` becomes `Promise<...>` |
| `middleware.ts` | Uses `request.cookies` (NextRequest — unaffected) | Verify after `@supabase/ssr` upgrade (see 3.3) |

`app/auth/callback/route.ts` and `app/auth/signup/page.tsx` were checked and are
**not** affected — they read `new URL(request.url).searchParams` and
`window.location.search` respectively, which are unrelated APIs.

### 3.3 Supabase authentication — **requires coordinated upgrades**

This is a hard coupling, not a routine bump:

- Installed: **`@supabase/ssr@0.1.0`**, which uses the `get` / `set` / `remove`
  cookie-handler interface.
- Current: **`@supabase/ssr@0.12.7`**, which uses the `getAll` / `setAll`
  interface, and declares `@supabase/supabase-js: "^2.114.0"` as a peer.
- Installed `@supabase/supabase-js` is **`^2.39.0`** — below that peer floor.

**Therefore the migration must move all three together:**

```text
@supabase/ssr        0.1.0   -> 0.12.7
@supabase/supabase-js ^2.39.0 -> ^2.114.0
```

and rewrite the cookie adapters in **both** `lib/supabase/server.ts` and
`middleware.ts` to `getAll` / `setAll`. Session refresh behaviour must be
re-verified end to end — this is the highest-risk area of the migration, because
a subtly wrong cookie adapter causes silent session loss rather than an error.

### 3.4 Middleware authorisation

`middleware.ts` performs real route gating: authentication redirect, active-status
check, and an admin-role guard, using the `get_my_authorization` RPC and
`applySecurityHeaders()`.

- Middleware logic itself uses `NextRequest.cookies`, so the async-API change does
  not apply to it directly.
- The `@supabase/ssr` cookie-adapter change **does** apply (3.3).
- **Regression-test the full authorisation matrix** (section 5.3). This is the
  control the entire deployment depends on, and a silent regression here would not
  be caught by a build.
- Defence in depth is preserved: privileged Server Actions enforce
  `requireActiveUser` / `requireCapability` independently of middleware, so a
  middleware regression is not a privilege escalation — but it is still treated as
  a release blocker.

### 3.5 Server Actions

30 exported actions in `lib/actions.ts`. Server Action IDs become **unguessable**
and unused exports are dead-code-eliminated in Next 15, which *reduces* R-001 #21
(internal endpoint disclosure).

Risk: dead-code elimination can break an action referenced only via a
runtime-computed name. Verified usage is via direct import/`form action`, so this
is expected to be safe — **confirm by exercising every action in staging**.

### 3.6 Solana payouts and wallet verification

No Next.js API dependency, but the highest-consequence path in the system, so it
gets explicit regression coverage:

- `airdropRewards()` / `sendTestAirdrop()` — atomic RPCs, exact decimal-string
  amounts, evidence validation (migrations 024-026)
- `confirmTokenTransfer()` reconciliation and BIGINT handling (migration 025)
- Wallet ownership challenge signing and verification
- **Requirement:** the Solana devnet fault-injection suite must pass unchanged,
  and payout amounts must round-trip exactly above `Number.MAX_SAFE_INTEGER`

Any change in payout behaviour blocks the migration. React 19 does not touch
these paths, but they are re-verified because the incentive to move fast on a
major upgrade is exactly when financial logic regresses.

### 3.7 Build, caching, and configuration

| Change | Action |
|---|---|
| `fetch()` no longer cached by default | Audit 4 call sites: `app/api/token-stats/route.ts` (×2, caching third-party BirdEye/DexScreener responses), `app/dashboard/wallet/page.tsx`, `app/auth/signup/page.tsx`. Add explicit `cache`/`revalidate` where the old default was relied on |
| GET Route Handlers uncached by default | Review all `app/api/**/route.ts`; most are dynamic already, but confirm — several serve public data that previously benefited from caching |
| `experimental.serverComponentsExternalPackages` renamed | Set top-level `serverExternalPackages` if needed |
| `next lint` deprecated | Replace with direct ESLint invocation |
| Node.js ≥ 18.18 | CI runs Node 20, Netlify runs Node 22 — both fine |
| `images.unoptimized: true` | **Must remain.** Do not change; R-001 depends on it |

### 3.8 Netlify adapter

`@netlify/plugin-nextjs` resolves to **5.16.2** (project declares `^5.16.0`); no
`next` peer constraint is declared. The adapter is the runtime for this app, so
Next 15 support is a **verification gate, not an assumption**: build and deploy to
the staging site and confirm middleware, Server Actions, ISR/caching, and image
handling all behave before this is considered proven. If 5.16.x proves
incompatible, upgrade the adapter within the same branch (it is a runtime
dependency and must move with Next).

## 4. Milestones

Each milestone ends with a green gate; do not proceed on a red one.

| # | Milestone | Deliverable | Exit criteria |
|---|---|---|---|
| **M0** | Baseline capture | Green run of the current suite on the migration branch's base; recorded audit counts | `tsc`, 42/42 unit, migration replay, dummy build all pass on the base commit |
| **M1** | Dependency lift | `next@15.5.28`, `react`/`react-dom` 19, `@types/react(-dom)` 19, `@supabase/ssr@0.12.7`, `@supabase/supabase-js@^2.114.0` | `npm install` clean; `npm ci` passes; audit shows `next` **absent** |
| **M2** | Mechanical migration | Codemod (`npx @next/codemod@canary upgrade latest`) applied and **reviewed line by line** — never merged unreviewed | Codemod diff understood; no unexplained edits |
| **M3** | Async request APIs | `await cookies()`; async `createClient()` and all call sites; awaited `searchParams` in `app/admin/users/page.tsx`; types updated | `tsc --noEmit` passes with no `UnsafeUnwrapped*` escape hatches |
| **M4** | Supabase cookie adapter | `getAll`/`setAll` rewrite in `lib/supabase/server.ts` and `middleware.ts` | Login, session refresh, logout, and protected-route access verified in staging |
| **M5** | Caching intent | Explicit `cache`/`revalidate` on the 4 `fetch` sites and each Route Handler | Each decision documented; no accidental uncached public endpoint |
| **M6** | Findings closed | Host-header validation (R-003); Server Action rate limiting (R-005) and explicit request-size limits (R-006) — **both already implemented 2026-10-22, verify rather than re-implement** | Implemented **and** covered by tests |
| **M7** | Staging regression | Full suite (section 5) on staging + Solana devnet | All gates green; evidence attached |
| **M8** | Review & handoff | PR with attached evidence; independent human approval; production preflight re-run | Approved; R-001 closed as remediated |

## 5. Testing requirements

### 5.1 Automated gates (every milestone)

- `npx tsc -p tsconfig.json --noEmit`
- `npm test` — 42 unit tests, must stay ≥42 (add coverage for M6)
- `npm run test:migration` — replay + 3 concurrency races
- `npm ci` (the exact CI install, no `--legacy-peer-deps`)
- Dummy-environment `npm run build`
- `npm audit --omit=dev` — `next` must be **absent**

### 5.2 Staging regression — deployed HTTP test is MANDATORY (D4)

- `npm run test:staging` against the non-production Supabase project
- `npm run test:solana-fault` against devnet (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`), 6-decimal USDC
- **Deployed Netlify staging HTTP test — mandatory, not optional.** The probe is
  currently skipped because `STAGING_APP_URL` is unset. It must be configured and
  the probe must pass: **a green local build is not evidence that the Netlify
  runtime behaves**, and the adapter is the highest-uncertainty component in this
  migration.

**Staging isolation — verify explicitly, do not assume (D4):**

| Requirement | Verification |
|---|---|
| Staging Supabase only | The staging deployment's `NEXT_PUBLIC_SUPABASE_URL` resolves to the staging project ref, **not** production |
| Solana devnet only | Genesis hash is `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; the fault suite already refuses any other network |
| **No production credentials or resources** | Confirm no production service-role key, mint, treasury wallet, or RPC endpoint is reachable from the staging deployment |
| No production writes | Confirm the staging deployment cannot reach the production database even if misconfigured |

A staging deployment that shares any production credential does **not** satisfy D4
and its results are not admissible as evidence.

### 5.3 Authorisation matrix (mandatory, manual + automated)

| Case | Expected |
|---|---|
| Unauthenticated → `/dashboard` | redirect to `/auth/login` |
| Unauthenticated → `/admin` | redirect to `/auth/login` |
| Active member → `/dashboard` | allowed |
| Suspended member → `/dashboard` | redirect with `error=account_inactive` |
| Active member → `/admin` | redirect to `/dashboard` |
| Active admin → `/admin` | allowed |
| Authenticated + active → `/auth/login` | redirect to `/dashboard` |
| Capability guard on privileged actions | denied without capability |

A middleware regression will not fail a build. This matrix is the only thing that
catches it.

### 5.4 Financial-path regression (mandatory)

- Reward computation and atomic approval (`approve_reward_period`)
- Payout finalisation and evidence rejection branches (`finalize_payout_confirmation`)
- Retry reconciliation with a raw amount above `Number.MAX_SAFE_INTEGER`
- Solana devnet fault injection: broadcast outage, unconfirmed transfer, mismatch
- Confirm confirmed/incident rows remain immutable

## 6. Risk and rollback

- **Application rollback is supported**: redeploy the previous build. Migrations
  024-026 are additive and forward-compatible.
- **Schema rollback is not**: correct defects with forward-fix migrations.
- **The migration changes no database schema.** If that changes, it stops being a
  single-PR migration and must be split.
- Highest-risk areas, in order: **Supabase cookie adapter** (silent session loss),
  **Netlify runtime behaviour** (undetectable locally), **caching defaults**
  (silent behaviour change), **payout paths** (financial consequence).

## 7. Owner decisions — recorded

Resolved by the project owner, October 19, 2026. See the risk register for the
full decision record and the division of authority.

| ID | Decision | Resolution |
|---|---|---|
| **D1** | Target 15.5.x or 16.x? | **APPROVED — target `15.5.28`.** Do **not** move to Next.js 16 as part of this migration. **Re-check current advisories again immediately before deployment**, since advisory data changes. |
| **D2** | React 19 scope expansion | **APPROVED.** React 19 plus the coupled `@supabase/ssr` and `@supabase/supabase-js` upgrades are in scope. **Authentication, session persistence, middleware authorisation, and Solana financial operations must pass end-to-end regression tests** — not build-only checks. |
| **D3** | Sequencing | **APPROVED with sequencing.** Planning and isolated development may proceed, but release order is binding: **Phase 1 → interim Next.js security upgrade → full Next.js 15 migration.** Each change stays separately reviewable and independently approved. |
| **D4** | Staging HTTP test | **APPROVED — mandatory.** A deployed Netlify staging HTTP test is required, on a deployment configured **exclusively** for staging Supabase and Solana devnet, with verification that **no production credentials or resources are involved.** |

**D1 gate addition:** because advisory data drifts (observed moving within a single
working session), the audit must be **re-run against the exact deployment candidate**
and `next` re-confirmed absent before release — not carried over from this plan.

**D3 gate addition:** this PR must **not** be merged ahead of the Phase 1 and interim
bump releases. Draft and branch creation are fine; merge order is not negotiable.

## 8. Explicitly out of scope

- **Next.js 16** — explicitly excluded by D1
- No dependency upgrades outside the Next/React/Supabase set (wallet adapters and
  `bigint-buffer` remain as recorded in R-002)
- No schema changes
- No production deployment
- No change to `images.unoptimized`
