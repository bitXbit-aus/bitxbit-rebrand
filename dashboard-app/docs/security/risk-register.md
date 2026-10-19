# Security Risk Register — bitXbit Dashboard

**Owner of this register:** Shri (project owner) — individual risk owners to be
confirmed or delegated; see the `Owner` column per entry.
**Created:** October 19, 2026
**Review cadence:** on every advisory-DB refresh and at each entry's review date.
**Authorisation:** Decisions A and B, dated October 19, 2026.

An entry here is an **accepted, time-limited exposure** — not a dismissal. Each
carries a review date, and the exception lapses if not explicitly reassessed.

---

## R-001 — Residual Next.js 14.2.35 vulnerabilities

**Decision A — conditional temporary risk acceptance.**
**Status:** ACCEPTED — conditional. **Expires:** **2026-11-18 (30 days).**
**Owner:** Shri (project owner) — confirm or delegate.

### Condition 1 — deployment remains Netlify/Linux with the image-optimisation path disabled

| Check | Evidence | Result |
|---|---|---|
| Host platform | `netlify.toml` → `@netlify/plugin-nextjs`; site `bitxbit-dashboard` → `app.bitxbit.com.au` | Netlify, Linux runtime |
| Image optimisation disabled | `next.config.mjs` → `images: { unoptimized: true }` | ✅ disabled |
| `next/image` usage | none in the app | ✅ path unreachable |

This neutralises the two remaining **criticals**:

- GHSA-p293-qw3h-jr36 — RCE on **Windows-hosted** servers → N/A (Linux)
- GHSA-2xp9-vwfh-vxw4 — RCE in the **Image Optimization API** (AVIF) → N/A
  (optimizer disabled)

**If either condition changes** — self-hosting, a platform move, or re-enabling
image optimisation — this exception is void and both criticals apply immediately.

### Condition 2 — applicable Server Action / RSC / SSRF / middleware advisories assessed individually

All 23 advisories still matching `next@14.2.35`, ruled one by one:

| # | Advisory | Sev | Applies? | Reasoning |
|---|---|---|---|---|
| 1 | DoS via Image Optimizer `remotePatterns` | mod | **No** | Optimizer disabled |
| 2 | HTTP request deserialization DoS (insecure RSC) | high | **Yes** | RSC in use |
| 3 | HTTP request smuggling in rewrites | mod | **No** | No `rewrites` configured |
| 4 | Unbounded `next/image` disk cache growth | mod | **No** | Optimizer disabled |
| 5 | DoS with Server Components | high | **Yes** | App Router / RSC |
| 6 | DoS with Server Components (second advisory) | high | **Yes** | App Router / RSC |
| 7 | Middleware/Proxy redirects cache-poisoned | low | **Partial** | Middleware sets redirects; Netlify edge caching governs exposure |
| 8 | XSS in App Router using CSP nonces | mod | **No** | CSP does not use nonces (see CSP in `middleware.ts`) |
| 9 | Cache poisoning via RSC cache-busting collisions | low | **Partial** | Requires shared cache susceptibility |
| 10 | XSS in `beforeInteractive` scripts | mod | **No** | No `beforeInteractive` script usage |
| 11 | DoS in Image Optimization API | mod | **No** | Optimizer disabled |
| 12 | SSRF via WebSocket upgrades | high | **Yes** | Long-running Next runtime; no custom server |
| 13 | Cache poisoning in RSC responses | mod | **Partial** | As #9 |
| 14 | Middleware/Proxy bypass, **Pages Router i18n** | high | **No** | App Router only; no `pages/`, no `i18n` |
| 15 | DoS in App Router using **Server Actions** | high | **Yes** | 30 exported Server Actions in `lib/actions.ts` |
| 16 | SSRF in **Server Actions** on custom servers | high | **No** | No custom server |
| 17 | Cache confusion of response bodies | mod | **Partial** | As #9 |
| 18 | Cache confusion (invalid UTF-8 bodies) | mod | **Partial** | As #9 |
| 19 | Unbounded Server Action payload in Edge runtime | mod | **No** | Actions run on Node runtime, not Edge |
| 20 | SSRF in rewrites via attacker-controlled hostname | high | **No** | No `rewrites` configured |
| 21 | Unauthenticated disclosure of internal Server Function endpoints | mod | **Yes** | Server Actions are enumerable |
| 22 | RCE on Windows-hosted servers | **crit** | **No** | Linux |
| 23 | RCE in Image Optimization API (AVIF) | **crit** | **No** | Optimizer disabled |

**Applicable and accepted:** #2, #5, #6, #12, #15, #21, plus partial exposure on
#7/#9/#13/#17/#18.

**Character of the accepted set:** denial-of-service and information-disclosure
against availability and, for #21, metadata about internal endpoints. **No
authentication bypass, no credential disclosure, no arbitrary code execution**
under this deployment's configuration. This is the basis on which the exception is
granted, and it is materially narrower than the raw severity counts suggest.

**Note on #21:** internal Server Function endpoints (action IDs) are discoverable.
They are guarded server-side by `requireActiveUser` / `requireCapability` (see
R-005), so disclosure does not grant access — but it does lower the cost of
probing.

### Condition 3 — host-header validation, request limits, shared rate limiting, server-side access controls

Verified. Full evidence: `docs/security/evidence/phase-1-controls-verification-2026-10-19.md`.

| Control | Verified state |
|---|---|
| Server-side access controls | ✅ **Strong.** `lib/authz.ts` exposes `requireActiveUser`, `requireActiveAdmin`, `requireCapability`; `requireCapability` is called 32×, guards 30 Server Actions. Admin mutations are audited to `security_audit_log` (migration 010). Authorization does **not** rely on middleware. |
| Shared rate limiting | ⚠️ **Conditional.** Upstash Redis store (atomic Lua sliding window) is used *only when* `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set. Otherwise it falls back to a **per-instance in-memory store**, which does not share limits across serverless instances. See R-004. |
| Client identity for rate limiting | ✅ Uses Netlify's trusted `x-nf-client-connection-ip`; `X-Forwarded-For` trusted only behind an explicit `TRUST_PROXY` flag. |
| Request limits | ⚠️ **Default only.** No `serverActions.bodySizeLimit` configured → Next's 1 MB default. See R-006. |
| Host-header validation | ❌ **Absent.** No `Host` / `X-Forwarded-Host` validation anywhere. See R-003. |

### Condition 4 — recorded in the risk register with an accountable owner

This entry. **Owner must be confirmed** — it is currently assigned to the project
owner by default and needs an explicit accountable individual.

### Condition 5 — expires within 30 days unless explicitly reassessed

**Expires 2026-11-18.** On or before that date: reassess, or escalate to the
Next.js 15 migration (Decision C, R-007). If the migration has landed, close this
entry as remediated rather than renewing it.

---

## R-002 — `bigint-buffer` overflow, no upstream fix

**Decision B — conditionally accepted.**
**Status:** ACCEPTED — conditional. **Review:** 2026-11-18 (with R-001).
**Owner:** to be confirmed.

**Advisory:** GHSA-3gc7-fjrx-p6mg — buffer overflow in `toBigIntLE()`.
**Version:** `bigint-buffer@1.1.5`, which is the **latest published release**. There
is **no patched version** available; `npm audit` reports no fix path.

**Reachability — constrained:** reachable only when decoding a token account's
`amount` field from chain data, via `@solana/spl-token`. Untrusted-data paths are
constrained because:

- the treasury mint is **operator-controlled**, not user-supplied;
- payout amounts are computed server-side and, from migration 025 onward, carried
  as exact decimal strings with `parseRawTokenAmount()` rejecting non-canonical
  input (numbers, leading zeros, negatives, decimals);
- users cannot select the mint or the account layout being decoded.

**Monitoring:** this is a transitive dependency of `@solana/spl-token`. Track for
a patched `bigint-buffer` release, a `spl-token` major that drops it, or a
maintained replacement. Re-check on every advisory refresh. A full remediation
path also exists via migration 025's exact-read RPCs, which bypass JS-side
`BigInt` conversion for payout amounts entirely.

---

## R-003 — No host-header validation

**Status:** OPEN. **Severity:** low–medium. **Owner:** to be confirmed.
**Discovered:** 2026-10-19 control verification.

The application does not validate the `Host` or `X-Forwarded-Host` header. On
Netlify the edge normally normalises these, which limits practical impact, but
absent validation there is no application-layer defence if the edge is
misconfigured or the app is moved.

**Mitigation:** add explicit allowed-host checking in middleware
(`app.bitxbit.com.au` and localhost origins), plus `allowedOrigins` for Server
Actions in `next.config`. **Fold into the Next.js 15 migration (R-007)** rather
than a standalone change.

---

## R-004 — Rate-limit store silently falls back to per-instance memory

**Status:** OPEN. **Severity:** medium. **Owner:** to be confirmed.

`getRateLimitStore()` uses Upstash Redis **only if** `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` are both present; otherwise it silently uses an
in-memory store. On serverless, in-memory limits apply per instance, so an
attacker spreading requests across instances gets a multiple of the intended
limit — and the fallback is invisible in logs.

**Mitigation:** fail closed (or log loudly) when Redis credentials are absent in
production; confirm both variables are set on the Netlify production and staging
sites. **Verify before enabling any rate-limit-dependent mitigation** — several
accepted risks above assume rate limiting is real.

---

## R-005 — Server Actions are not rate limited

**Status:** OPEN. **Severity:** medium. **Owner:** to be confirmed.

`checkRateLimit` is applied to API routes (`token-stats`, `resolve-referral`,
`public/*`, `wallet/rewards`) but **not to any of the 30 Server Actions** in
`lib/actions.ts`. Every action is authorization-guarded, so this is not an access
control gap — it is an unbounded-work gap: an authenticated user can drive costly
actions (reward calculation, airdrop preparation) without a request ceiling.

**Mitigation:** apply `checkRateLimit` to the expensive authenticated actions.
Pairs with R-004 — rate limiting is only meaningful once the store is shared.

---

## R-006 — No explicit request-size limits

**Status:** OPEN. **Severity:** low. **Owner:** to be confirmed.

No `experimental.serverActions.bodySizeLimit` is set, so Next's 1 MB default
applies. Accepted for now; set an explicit, documented limit during the Next.js 15
migration so the bound is intentional rather than inherited.

---

## R-007 — Next.js 15 migration outstanding

**Status:** PLANNED — Decision C approved 2026-10-19.
**Owner:** Shri (project owner) — implementation owner to be confirmed.

`next@15.5.26` is the **minimum version clearing all 34 `next` advisories**;
`15.5.27`/`15.5.28` clear them with margin. Plan:
`docs/security/nextjs-15-migration-plan.md`. Successor to R-001: when the
migration lands, R-001 is **closed as remediated**, not renewed.

---

## R-008 — Production is pre-migration-010 with no migration ledger

**Status:** OPEN — blocking production release. **Severity:** high (release risk).
**Owner:** to be confirmed.

Production (`flasgvendiiasuixeqzu`) has no `supabase_migrations` ledger and none of
the Phase 1 objects, so the upgrade range is **`010` → `026`**, not `024` → `026`.
Evidence: `docs/security/evidence/phase-1-production-preflight-2026-10-19.md`.

**Consequence for ordering:** `middleware.ts` calls the `get_my_authorization` RPC,
which is created by **migration 010**. Production does not have it. The dashboard
therefore **cannot authorise sessions correctly against production until the Phase
1 migrations are applied** — the migration is a functional prerequisite, not
merely a hardening step.

Also unresolved: no backup checkpoint recorded; schema parity verified
structurally (names/sets) but not for types, indexes, RLS policies, or grants.

---

## Summary

| ID | Risk | Status | Review |
|---|---|---|---|
| R-001 | Next.js 14.2.35 residual advisories | Accepted, conditional | **2026-11-18 (expires)** |
| R-002 | `bigint-buffer`, no fix | Accepted, conditional | 2026-11-18 |
| R-003 | No host-header validation | Open | with Next 15 |
| R-004 | Rate-limit store falls back to memory | Open | before release |
| R-005 | Server Actions not rate limited | Open | with Next 15 |
| R-006 | No explicit request-size limits | Open | with Next 15 |
| R-007 | Next.js 15 migration | Planned | Decision C |
| R-008 | Production pre-010, no ledger | Open | blocking release |
