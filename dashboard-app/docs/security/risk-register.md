# Security Risk Register — bitXBit Dashboard

**Created:** October 19, 2026
**Governance decision recorded:** October 19, 2026 (see below)
**Review cadence:** on every advisory-DB refresh, at each entry's review date, and
whenever an entry's conditions change.

An entry here is an **accepted, time-limited exposure** — not a dismissal. Each
carries a review date, and the exception lapses if not explicitly reassessed.

---

## Governance and authority

**Accountable risk owner — R-001 through R-008: Shri (project founder and owner),
interim.** Recorded on the owner's instruction, October 19, 2026. Ownership will be
progressively delegated to suitable technical, deployment, and database owners as
the business develops.

**Division of authority (binding):**

| Role | Authority |
|---|---|
| **Shri — founder/owner, interim accountable owner** | Sole authority to accept risk, approve production releases, authorise merges and production migrations. |
| **AI development agent** | Technical implementation, testing, documentation, and reporting. **No authority to accept risks or approve production releases on the owner's behalf.** |
| **Independent technical review** | Must be performed by a **separate qualified human reviewer** where independent review is required. Self-review by the implementing agent does not satisfy this. |

**Two consequences that govern how this register must be read:**

1. **Assigning an owner does not accept or close anything.** The statuses,
   deadlines, and conditions below are unchanged by this ownership decision. An
   entry marked OPEN remains OPEN; an entry marked ACCEPTED-CONDITIONAL remains
   conditional and expires on its stated date.
2. **No production deployment, database migration, or acceptance of new material
   risk is authorised without the owner's explicit approval** — including changes
   that appear low-risk.

**Standing constraint:** the agent does not merge to `main`, apply production
migrations, or deploy, without explicit release authorisation.

## Owner decisions on record

| ID | Decision | Recorded |
|---|---|---|
| **D1** | Target **Next.js 15.5.28**, re-checking current advisories before deployment. **Do not move to Next.js 16** as part of this migration. | Approved |
| **D2** | Include **React 19** and the coupled **Supabase SSR + supabase-js** upgrades. Authentication, session persistence, middleware authorisation, and Solana financial operations must pass end-to-end regression tests. | Approved |
| **D3** | Continue planning and isolated development, but **release in order: Phase 1 → interim Next.js security upgrade → full Next.js 15 migration.** Changes must be separately reviewable and independently approved. | Approved with sequencing |
| **D4** | A **deployed Netlify staging HTTP test is mandatory**, on a deployment configured exclusively for staging Supabase and Solana devnet, verifying that **no production credentials or resources are involved.** | Approved |
| — | Decisions A (conditional temporary acceptance, R-001) and B (bigint-buffer, R-002) | Approved 2026-10-19 |

---

## R-001 — Residual Next.js 14.2.35 vulnerabilities

**Decision A — conditional temporary risk acceptance.**
**Status:** ACCEPTED — conditional. **Expires:** **2026-11-18 (30 days).**
**Owner:** Shri — interim accountable owner. **Not accepted or closed by this
ownership assignment.**

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
| 8 | XSS in App Router using CSP nonces | mod | **No** | CSP does not use nonces |
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
under this deployment's configuration.

### Condition 3 — host-header validation, request limits, shared rate limiting, server-side access controls

Verified. Full evidence: `docs/security/evidence/phase-1-controls-verification-2026-10-19.md`.

| Control | Verified state |
|---|---|
| Server-side access controls | ✅ **Strong.** `requireActiveUser` / `requireActiveAdmin` / `requireCapability`; 30 Server Actions guarded; admin mutations audited to `security_audit_log`. Authorization does **not** rely on middleware. |
| Shared rate limiting | ⚠️ **Conditional — NOT satisfied.** Shared only when Upstash credentials are present; otherwise a **silent per-instance in-memory fallback**. See R-004. |
| Client identity for rate limiting | ✅ Uses Netlify's trusted `x-nf-client-connection-ip`; XFF trusted only behind an explicit `TRUST_PROXY` flag. |
| Request limits | ⚠️ **Default only** — Next's 1 MB default. See R-006. |
| Host-header validation | ❌ **Absent.** See R-003. |

**Two of the four controls named in Condition 3 are unsatisfied**, so this condition
is **not met** and R-001's exception is contingent on closing R-003 and R-004.

### Condition 4 — recorded in the risk register with an accountable owner

✅ This entry. Owner assigned: Shri, interim.

### Condition 5 — expires within 30 days unless explicitly reassessed

**Expires 2026-11-18.** Reassess on or before that date, or close as remediated
when the Next.js 15 migration lands. **Do not renew by default.**

---

## R-002 — `bigint-buffer` overflow, no upstream fix

**Decision B — conditionally accepted.**
**Status:** ACCEPTED — conditional. **Review:** 2026-11-18 (with R-001).
**Owner:** Shri — interim accountable owner.

**Advisory:** GHSA-3gc7-fjrx-p6mg — buffer overflow in `toBigIntLE()`.
**Version:** `bigint-buffer@1.1.5` — the **latest published release**. There is **no
patched version**; `npm audit` reports no fix path.

**Reachability — constrained:** reachable only when decoding a token account's
`amount` field from chain data, via `@solana/spl-token`. Untrusted-data paths are
constrained because:

- the treasury mint is **operator-controlled**, not user-supplied;
- payout amounts are computed server-side and, from migration 025 onward, carried
  as exact decimal strings with `parseRawTokenAmount()` rejecting non-canonical
  input (numbers, leading zeros, negatives, decimals);
- users cannot select the mint or the account layout being decoded.

**Monitoring:** transitive dependency of `@solana/spl-token`. Track for a patched
`bigint-buffer`, a `spl-token` major that drops it, or a maintained replacement.
Re-check on every advisory refresh.

---

## R-003 — No host-header validation

**Status:** OPEN — **not accepted, not closed.** **Severity:** low–medium.
**Owner:** Shri — interim accountable owner.
**Discovered:** 2026-10-19 control verification.

The application does not validate the `Host` or `X-Forwarded-Host` header. On
Netlify the edge normally normalises these, limiting practical impact, but there is
no application-layer defence if the edge is misconfigured or the app is moved.

**Required action — close by adding and testing host/origin validation:**

- Allowed hosts: `app.bitxbit.com.au` (production), the staging site's host, and
  `localhost` origins for development.
- **Legitimate Netlify preview domains must be included** — deploy previews use
  per-deploy hostnames (`<deploy-id>--<site>.netlify.app`), so the allowlist must
  cover them deliberately rather than being defeated by them.
- Add `serverActions.allowedOrigins` for Server Action origin enforcement.
- Ship with tests covering allowed hosts, rejected hosts, and preview domains.

**Tracked as NA-1.**

---

## R-004 — Rate-limit store silently falls back to per-instance memory

**Status:** OPEN — **not accepted, not closed.** **Severity:** medium.
**Owner:** Shri — interim accountable owner.

`getRateLimitStore()` uses Upstash Redis **only if** `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` are both present; otherwise it silently uses an
in-memory store. On serverless, in-memory limits apply per instance, so an attacker
spreading requests across instances gets a multiple of the intended limit — and the
fallback is invisible in logs.

**Required action — close by proving the limit is shared on both environments and
removing the silent production fallback:**

1. Confirm both Upstash variables are configured on the **staging** and
   **production** Netlify sites.
2. **Prove** limits are shared: exceed a limit across two concurrent instances and
   observe a single shared counter (a single-instance test does not prove this).
3. Remove the silent fallback in production — fail closed or log loudly rather than
   degrading quietly.

**Tracked as NA-2.** This is a **prerequisite** for R-005 and for any accepted risk
that relies on rate limiting.

---

## R-005 — Server Actions are not rate limited

**Status:** OPEN — **not accepted, not closed.** **Severity:** medium.
**Owner:** Shri — interim accountable owner.

`checkRateLimit` is applied to API routes only; it appears **zero times** in
`lib/actions.ts` across **30 Server Actions**. Every action is
authorization-guarded, so this is not an access-control gap — it is an
unbounded-work gap: an authenticated user can drive costly actions (reward
calculation, airdrop preparation) without a request ceiling.

**Required action — prioritise before significant production use.** Apply
`checkRateLimit` to the costly authenticated actions. **Depends on R-004** —
rate limiting is only meaningful once the store is genuinely shared.

**Tracked as NA-3.**

---

## R-006 — No explicit request-size limits

**Status:** OPEN — **not accepted, not closed.** **Severity:** low.
**Owner:** Shri — interim accountable owner.

No `experimental.serverActions.bodySizeLimit` is set, so Next's **1 MB default**
applies. The existing boundary is documented here rather than being changed now.

**Required action:** keep this boundary documented, and **make it explicit** in the
Next.js 15 migration rather than inheriting it silently.

**Tracked as NA-4.** Owner instruction: document and carry into the migration.

---

## R-007 — Next.js 15 migration outstanding

**Status:** PLANNED — Decision C approved 2026-10-19; D1/D2/D3 resolved.
**Owner:** Shri — interim accountable owner. Implementation ownership to be
delegated.

`next@15.5.26` is the **minimum version clearing all 34 `next` advisories**;
`15.5.28` is the approved target (D1). Plan:
`docs/security/nextjs-15-migration-plan.md`. Successor to R-001: when the migration
lands and is independently approved, **R-001 is closed as remediated, not renewed.**

---

## R-008 — Production is pre-migration-010 with no migration ledger

**Status:** OPEN — **blocking production release.** **Severity:** high (release risk).
**Owner:** Shri — interim accountable owner.

Production (`flasgvendiiasuixeqzu`) has no `supabase_migrations` ledger and none of
the Phase 1 objects, so the upgrade range is **`010` → `026`**, not `024` → `026`.
Evidence: `docs/security/evidence/phase-1-production-preflight-2026-10-19.md`.

**Consequence for ordering:** `middleware.ts` calls the `get_my_authorization` RPC,
created by **migration 010**. Production does not have it. The dashboard
**cannot authorise sessions correctly against production until the Phase 1
migrations are applied** — the migration is a functional prerequisite, not merely a
hardening step.

**Required before any production merge (owner instruction):**

1. Complete the **production migration backup**.
2. Complete **full schema-parity checks** — currently structural only (table and
   column names/sets); types, defaults, NOT NULL flags, indexes, RLS policies,
   triggers, and grants are **not yet compared**.
3. Complete a **rehearsal against a production-like database**.

**Tracked as NA-5.**

---

## Required next actions

| ID | Action | Risk | Status |
|---|---|---|---|
| **NA-1** | Add and test host/origin validation, including legitimate Netlify preview domains | R-003 | **OPEN — to implement** |
| **NA-2** | Confirm Upstash configured in staging **and** production; prove limits are shared; remove silent production fallback | R-004 | **OPEN — needs Netlify env access** |
| **NA-3** | Prioritise rate limiting for costly Server Actions before significant production use | R-005 | **OPEN — depends on NA-2** |
| **NA-4** | Keep the request-size boundary documented; make it explicit in the Next.js 15 migration | R-006 | **OPEN — doc done, migration step pending** |
| **NA-5** | Production backup, full schema-parity checks, rehearsal against a production-like database — before any production merge | R-008 | **OPEN** |
| **NA-6** | Resolve PR #2's CI trigger **without unnecessarily expanding automation credentials**; run CI on its exact merge candidate | Release process | **OPEN — needs an owner decision, see below** |
| **NA-7** | Preserve the fresh GitHub approval on PR #1; obtain new approval whenever a change invalidates it | Release process | ✅ Current approval is on head `bdbdf003`; re-approval required after any further push |

### NA-6 detail

The workflow triggers only on `main` and `security/phase-1-hardening`, so PR #2 and
PR #3 get **no CI**. The fix is a two-line change to `.github/workflows/`, but the
automation token **lacks `workflow` scope** and the push is rejected.

Options, in order of preference:

1. **The owner applies the two-line diff via the GitHub web UI.** No credential
   expansion at all; ~30 seconds.
2. A **fine-grained PAT scoped to this single repository** with only
   `Workflows: write`, used once and revoked.
3. Broadening the existing token's scopes — **not recommended**; this is the
   "unnecessary expansion" the instruction excludes.

```diff
 on:
   push:
     branches:
       - main
-      - security/phase-1-hardening
+      - "security/**"
   pull_request:
     branches:
       - main
+      - "security/**"
```

---

## Summary

| ID | Risk | Status | Owner | Review |
|---|---|---|---|---|
| R-001 | Next.js 14.2.35 residual advisories | Accepted, **conditional** (Condition 3 unmet) | Shri (interim) | **2026-11-18 (expires)** |
| R-002 | `bigint-buffer`, no fix | Accepted, conditional | Shri (interim) | 2026-11-18 |
| R-003 | No host-header validation | **OPEN** | Shri (interim) | NA-1 |
| R-004 | Rate-limit store falls back to memory | **OPEN** | Shri (interim) | NA-2 |
| R-005 | Server Actions not rate limited | **OPEN** | Shri (interim) | NA-3 |
| R-006 | No explicit request-size limits | **OPEN** | Shri (interim) | NA-4 |
| R-007 | Next.js 15 migration | Planned (D1-D3 resolved) | Shri (interim) | Migration |
| R-008 | Production pre-010, no ledger | **OPEN** — blocking release | Shri (interim) | NA-5 |

**Nothing in this register is closed by the ownership assignment.**
