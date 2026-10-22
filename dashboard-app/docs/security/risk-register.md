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

### Control change — 2026-10-19 (owner decision)

The owner removed the required-review protection from `main`. Verified against the live
protection settings the same day:

| Control | Before | After |
|---|---|---|
| `required_pull_request_reviews` | 1 approval, stale reviews dismissed | **NONE** |
| `required_status_checks` | "Tests, migration replay, and build" (strict) | unchanged |
| `enforce_admins` | false | false |
| force-push / deletion | blocked | blocked |
| required conversation resolution | required | required |

Recorded here because of what it is: **the independent-review gate is now waived, not
satisfied.** The control that existed to place a separate qualified human in front of
financially significant changes — atomic reward approval, payout finalisation, exact token
amounts — is absent. With `enforce_admins` false the remaining check is also bypassable by an
administrator, so the effective release control set is the CI status check alone.

This is within the owner's authority: the owner holds sole power to accept risk. It is recorded
as an **accepted risk with the owner accountable**, dated, rather than silently absorbed.

**The waiver does not change any of the following, which remain open and are technical, not
approval-related:**

1. **The migration coupling.** PR #1's code calls `record_trusted_offer_click` (`010`),
   `verify_wallet_challenge` (`011`), `apply_reward_calculation` (`016`) and
   `approve_reward_period` (`024`). Production is pre-`010`. Merging to `main` auto-deploys,
   so merging without applying the range first is an outage.
2. ~~**D4's deployed-app HTTP test** has no staging-scoped deployment to run against.~~
   **RESOLVED 2026-10-19, re-verified 2026-10-22** — see §D4 status.
3. ~~**The R-009 residue** on the existing preview deploys, which still run production credentials.~~
   **RESOLVED 2026-10-19** — the seven production-wired previews were deleted, and all 34
   deploys created since were verified staging-scoped on 2026-10-22.

Removing the approval requirement therefore does not open the production window. It removes a
review control; it does not satisfy a single one of the three blockers above.

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
| Shared rate limiting | ✅ **Satisfied.** The shared atomic store is deployed and the limiter keys on the **real client** — verified live: keys carry `206.83.119.2`, a forged forwarded chain creates no new key, and enforcement returns 429 from the 31st request against a 30/60 s limit. See R-004. |
| Client identity for rate limiting | ✅ Uses Netlify's trusted `x-nf-client-connection-ip`; XFF trusted only behind an explicit `TRUST_PROXY` flag. |
| Request limits | ✅ **Satisfied 2026-10-22** — `bodySizeLimit` set explicitly; the upload boundary is enforced by a tested policy below the platform ceiling (R-006). The `1mb` JSON limit is unchanged in effect but is now explicit. |
| Host-header validation | ✅ **Satisfied** — implemented and released 2026-10-20 (PR #4, deploy `6ad70e11`); refusal path proven, control live in production. The application-layer check is defence-in-depth behind the Netlify edge, which is a property of the hosting configuration. See R-003. |

**Condition 3 — both controls are now satisfied in fact (updated 2026-10-22).** Host-header
validation is implemented and released (R-003, deploy `6ad70e11`), and shared rate limiting is
live in production (R-004 — migration `027` was applied 2026-10-19, and the limiter was verified
live keying on the real client, `206.83.119.2`, enforcing 429 from request #31). Request limits
are no longer "default only" (R-006, 2026-10-22).

The condition remains formally contingent on **R-003's closure**, which is *released* but *not
closed* because independent review is still waived. The two other controls named in this
condition no longer gate it. *(The previous text here said rate limiting was "still not live in
production"; that was stale — `027` had been applied and R-004 verified.)*

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

**Status:** **RELEASED 2026-10-20** — implemented and deployed (PR #4, deploy `6ad70e11`),
control verified in production. **NOT CLOSED:** independent review is still waived, not
satisfied. **Severity:** low–medium.
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

## R-004 — Rate limiting is per-instance in production (CONFIRMED)

**Status:** **FIXED AND VERIFIED IN PRODUCTION** — 2026-10-21.
The store was already correct and released (migration `027`, deploy `6ad71dde`). The
identifier defect found on 2026-10-20 is fixed: the limiter keys on the **real client**, not
an edge-node address, the key cannot be chosen by the caller, and enforcement blocks at the
configured limit (30/60 s → 429 from request #31). Code `00c174ba` → deploy
`6ad9387263ab3f63dccf8edd`. See
`evidence/rate-limit-client-identifier-fixed-2026-10-21.md`.
**Severity: HIGH** (raised from medium). **Owner:** Shri — interim accountable owner.
**Confirmed:** 2026-10-19 (Netlify environment audit). **Remediated:** 2026-10-19.

`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are **absent** — both from
the site and from the (empty) team variable set. `getRateLimitStore()` therefore
takes its `else` branch on every production instance and uses
`MemoryRateLimitStore`.

**This is not a latent risk. It is the running configuration.** Limits apply per
serverless instance, an attacker spreading requests across instances receives a
multiple of the intended limit, and the fallback is **silent**.

Two consequences beyond the risk itself:

- **R-005 is not worth implementing yet.** Adding limits to a store that isn't
  shared would create the appearance of protection without the substance.
- **It weakens the basis of other accepted risks.** Any reasoning in this register
  that assumed a request ceiling holds is unsound as configured.

Evidence: `docs/security/evidence/netlify-environment-audit-2026-10-19.md`.

**Remediated 2026-10-19** (PR #5). A shared store now exists: migration `027` adds
`rate_limit_counters` and a `check_rate_limit()` RPC, with one atomic
`INSERT … ON CONFLICT DO UPDATE … RETURNING`, `SECURITY DEFINER` and a pinned
`search_path`. RLS is enabled with no policies, table access is revoked from
`PUBLIC`/`anon`/`authenticated`, and only `service_role` may execute it.
`resolveRateLimitBackend()` prefers Supabase (already in the stack — no new account
or credential), then Upstash, then memory. The silent fallback now logs loudly, and
any RPC error or malformed payload degrades to a per-instance check — **never** to
"allowed".

**2026-10-21 — the degradation is now observable (NA-15 closed).** The fallback above was
silent in practice: both degradation paths reported only via `console.error`, and Netlify's
request logs retain nothing even for requests that invoked the function. A limiter that had
quietly become per-instance was therefore indistinguishable from outside from one enforcing
shared limits — this risk's own failure mode, inside its own degradation path. Degradation is
now recorded in-process and exposed on `GET /api/health/rate-limit`, which returns **503 when
degraded** and carries an `x-ratelimit-degraded` header (also on the 429 path). See
`evidence/na15-degradation-visibility-2026-10-21.md`.

**Netlify Blobs was evaluated and rejected.** Blobs is eventually consistent by
default (updates propagate within 60s, against a window measured in seconds), has no
transactions, and Netlify's own guidance says counters must not be built on a blob
key "even with `onlyIfMatch` retries". A conditional-write loop would also ride on a
known SDK defect reporting `modified: true` for non-412 failures — a silent lost
write. It would have passed a single-instance test while over-allocating under
concurrency.

**Proven, not asserted.** Concurrent calls from independent database sessions:

| Environment | Result |
|---|---|
| Local Postgres (replay) | 30 concurrent → counter **30**, allowed **10** |
| Staging Supabase | 30 concurrent → counter **30**, allowed **10**, 0 connection failures |
| Functional (`max=3`) | `true, true, true, false` |
| Privileges (staging) | anon read/exec denied, authenticated exec denied, service_role allowed |

Evidence: `docs/security/evidence/rate-limit-atomicity-2026-10-19.md`.

**Why this was not closed (superseded 2026-10-22).** Environment variables resolve at
deploy time, so the change was inert until a deployment was built. The database proof
showed the *store* is correct, not that the *wiring* was. Closure required the deployed
staging test (D4).

**D4 satisfied 2026-10-22 — the deployed wiring is now observed, not merely configured.**
On the deployed preview the health route reports `backend: supabase` (the shared store, not
the in-memory fallback), and driving `/api/public/resolve-referral` past its limit produced
the **first 429 at request #31**, with `retry-after: 22` and `x-ratelimit-degraded: false`.
See `evidence/d4-deployed-staging-verification-2026-10-22.md`.

**Tracked as NA-2.**

---

## R-005 — Server Actions are not rate limited

**Status:** **IMPLEMENTED AND TESTED 2026-10-22** — not yet verified in a deployment.
**Severity:** medium. **Owner:** Shri — interim accountable owner.

`checkRateLimit` is applied to API routes only; it appears **zero times** in
`lib/actions.ts` across **30 Server Actions**. Every action is
authorization-guarded, so this is not an access-control gap — it is an
unbounded-work gap: an authenticated user can drive costly actions (reward
calculation, airdrop preparation) without a request ceiling.

**Required action — prioritise before significant production use.** Apply
`checkRateLimit` to the costly authenticated actions. **Depends on R-004** —
rate limiting is only meaningful once the store is genuinely shared.

**Tracked as NA-3.**

**Outcome (2026-10-22).** `lib/action-rate-limit.ts` adds a per-user ceiling for the
costly actions; five are bounded — `reward.airdrop` and `reward.testAirdrop` at
**3/60 s**, `reward.calculate`, `reward.correct` and `reward.approve` at **6/60 s**.

- The subject is the **authenticated user id**, not a client address: a Server
  Action has no `NextRequest`, and substituting a header would reintroduce the
  spoofing hole R-004 closed. Every limited action is authorization-guarded.
- Refusals are **returned**, not thrown, so the message survives a production build
  (a thrown error is redacted to an opaque 500). All five call sites are already
  `FormWithToast`-wired, so no UI change was needed.
- Denials are **not** written to the audit log — a limited caller could otherwise
  use the audit trail as an amplification target.
- Keys are `action:<action>:user:<id>`, so budgets are independent per action and
  per user.

**Deliberately excluded:** `getAirdropWalletBalanceAction` and `getTokenBalanceAction`
are called on render paths whose callers expect a balance, so a refusal object would
break the page — bounding those needs its own design. **Separate observation
recorded, not fixed here:** `getTokenBalanceAction` has **no authorization guard at
all**, unlike every other action in the file; assess on its own. Bulk user mutations
are left to a follow-up.

**Verification:** 146/146 tests (13 new); `tsc` clean; migration replay + races pass;
dummy-env build compiles; **8/8 mutations detected with 0 compile errors**, including
two wiring tests that fail if a guard is dropped or stops returning the refusal.
**Not verified in a deployment** — no live request has been observed being refused.
See `evidence/r005-server-action-rate-limiting-2026-10-22.md`.

---

## R-006 — No explicit request-size limits

**Status:** **IMPLEMENTED AND TESTED 2026-10-22** — not yet verified in a deployment.
**Severity:** low. **Owner:** Shri — interim accountable owner.

No `experimental.serverActions.bodySizeLimit` is set, so Next's **1 MB default**
applies. The existing boundary is documented here rather than being changed now.

**Required action:** keep this boundary documented, and **make it explicit** in the
Next.js 15 migration rather than inheriting it silently.

**Tracked as NA-4.** Owner instruction: document and carry into the migration.

**Outcome (2026-10-22) — the boundary was implicit *and incoherent*.** Measuring it
(production build + probe action) showed the limits in play disagreed, and the
stricter one failed opaquely:

- `bodySizeLimit` **does not bound file uploads at all.** It is passed to busboy as
  `fieldSize` (non-file fields only), and the plain-form multipart path applies no
  check. **A 5 MB file was received intact** with the 1 MB default in force.
- Only the non-multipart (JSON) path enforces it — with an internal **413** that the
  browser sees as an opaque **500**.
- The declared 5 MB app limit sat **above** the platform's ~4.5 MB effective binary
  ceiling, so its legible refusal could never fire.
- The refusal was **thrown**, so it became a redacted 500 regardless.

**Fixed:** `bodySizeLimit` set explicitly (`'1mb'`) with its scope documented;
`lib/asset-policy.ts` holds one pure, unit-tested size/type policy with
`MAX_ASSET_BYTES` = **3 MB** (below the platform ceiling, with headroom);
`lib/storage.ts` uses it; `resolveImageUrl` and its four call sites now **return**
the refusal instead of throwing; the upload field applies the same rule client-side.

**Verification:** 158/158 tests (12 new); `tsc` clean; migration replay + races pass;
dummy-env build compiles; **7/7 mutations detected with 0 compile errors**. The
harness found a real validator hole (`NaN` passed as a size) — fixed. **The platform
ceiling is documented, not measured; not verified in a deployment.** See
`evidence/r006-request-size-limits-2026-10-22.md`.

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

**RESOLVED — 2026-10-19.** Production was migrated and the ledger backfilled the same day.

| Step | Evidence |
|---|---|
| Backup | `pg_dump` of the `public` schema before any change — 10 tables, 10 data blocks, 4 functions, 20 policies, plain + custom format, sha256 recorded |
| Preflight | Run through the real `psql` runner — `exit=0`, no hard stop |
| Apply | `010` → `026`, 17 migrations in order, `ON_ERROR_STOP=1` — all OK |
| Verify | All landmarks present; **every row count unchanged** (users 6, projects 3, categories 8, periods 0, rewards 0); backfill 6 authorization rows (1 admin, 5 members); mismatches **0**; obsolete 6-arg overload **0** |
| Ledger | `001`–`026` backfilled, provenance recorded in-database via `COMMENT ON TABLE` |
| Live app | All routes correct, four DB-backed public endpoints **200**, real data served |

**Residual, stated rather than closed:** no provider point-in-time backup exists — the owner
accepted proceeding on the logical dump. Parity evidence was structural (table and column sets),
not types, defaults, indexes, RLS policies, triggers or grants.

**The window remains open until the code is deployed.** Migrations are applied but PR #1 is not
yet merged, so production runs the old code against the new schema. Verified healthy, because
server-side paths use the service role, which bypasses the RLS changes.

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

## R-009 — Production credentials exposed to deploy previews and branch deploys

**Status:** OPEN — **CRITICAL** (identified 2026-10-19). **Preview exposure path CLOSED
2026-10-19** by re-scoping preview/branch-deploy to staging + devnet. **The deploy-time
verification that was outstanding under D4 was completed 2026-10-22:** all **34** preview
deploys — every one created since the re-scoping — are staging-scoped (devnet mint; staging
Supabase ref in the client bundle with a production positive control; staging data), with
**zero** production-wired and none inconclusive. See §D4 status.
**What remains open is the owner's decision on the `is_secret` flagging (NA-9/R-010), not
an unverified exposure path** — closure is recommended for the owner's sign-off, not taken
unilaterally.
**Owner:** Shri — interim accountable owner.

Every variable present in the `production` context is **also present in
`branch-deploy` and `deploy-preview` with the same value**, or is scoped to `all`:

| Variable | Contexts | Significance |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **all** | Production service-role key — bypasses RLS |
| `NEXT_PUBLIC_SUPABASE_URL` | **all** | Resolves to the **production** project |
| `AIRDROP_WALLET_PRIVATE_KEY` | production, branch-deploy, deploy-preview | **Production treasury signing key**, identical across all three |
| `BITXBIT_TOKEN_MINT` | production, branch-deploy, deploy-preview | Production mint, identical across all three |
| `NEXT_PUBLIC_APP_URL` | **all** | `https://app.bitxbit.com.au` — previews identify as production |

**Consequence:** a deploy preview or branch deploy executes **arbitrary branch
code** with the **production treasury private key** and the **production
service-role key** in its runtime, pointed at **production Supabase**. The
repository is public and previews are publicly reachable. Any branch pushed to the
repo — including work-in-progress code or a dependency's postinstall script — runs
with the ability to sign transactions from the treasury wallet and to read/write
the production database with service-role authority.

This is a live path from "push a branch" to "sign with the treasury key", and it
means **untrusted code currently runs with treasury signing capability.**

**Required action:** rotate the treasury key and the service-role key; scope
production credentials to the `production` context only; give preview and
branch-deploy contexts staging values or none. Evidence:
`docs/security/evidence/netlify-environment-audit-2026-10-19.md`.

**Tracked as NA-8.**

---

## R-010 — Secret values are not marked secret

**Status:** OPEN. **Severity:** medium-high. **Owner:** Shri — interim accountable owner.

`is_secret` is **false on every variable**, including `AIRDROP_WALLET_PRIVATE_KEY`
and `SUPABASE_SERVICE_ROLE_KEY`. Values marked secret are masked in the Netlify UI
and withheld from API reads; these are not — the audit read the treasury private
key over the API with no privilege beyond site read access, and it appears in
plaintext in the dashboard.

**Required action:** mark all credential variables `is_secret: true`. Note this is
adjacent to R-009: marking secrets is necessary but does **not** fix the
preview-context exposure, which is a scoping problem.

**Tracked as NA-9.**

---

## R-011 — No non-production Solana RPC or devnet configuration

**Status:** **ADDRESSED for preview/branch-deploy** 2026-10-19 — `SOLANA_RPC_URL` set to
devnet for those contexts. Production deliberately left on its existing mainnet default.
Remains open until verified in a running deployment.
**Owner:** Shri — interim accountable owner.

There is **no `SOLANA_RPC_URL` or `NEXT_PUBLIC_SOLANA_RPC_URL`** variable at all, so
the application resolves its RPC endpoint from defaults and nothing constrains
non-production deployments to devnet. D4 requires "Solana devnet only" for staging,
which cannot currently be asserted, let alone verified.

**Required action:** set an explicit RPC variable per context — devnet for preview
and branch-deploy, mainnet for production — so the constraint is configuration
rather than convention.

**Tracked as NA-10.**

---

## R-012 — Production treasury key retained in a local staging file

**Status:** **LOCAL FIXTURE REMEDIATED** 2026-10-19 — `.env.staging.local` now holds the funded
devnet key. **Rotation of the production key remains OPEN**: the exposure was historical and
editing a fixture does not undo it.
**Owner:** Shri — interim accountable owner.

`dashboard-app/.env.staging.local` (mode 600, git-ignored) contains an
`AIRDROP_WALLET_PRIVATE_KEY` whose SHA-256 is **identical to the production treasury key**,
confirmed by hash comparison.

Two consequences:

- The staging/devnet tests run earlier in this engagement signed with the **production
  treasury wallet**, so credential isolation was never real on the local side either.
- The production treasury key exists in a **plaintext file on the workstation**, a second
  exposure path independent of the Netlify API.

This is an independent argument for rotating the treasury key **and** for replacing the local
fixture with a devnet key.

**Remediated 2026-10-19.** The owner funded the devnet wallet, and the fixture now holds the
devnet key. Verified end to end: the stored key **derives to**
`496yh6GUc7J7q8sepdoD9mgpf2Z38U54pB5kGsAqoGyU`, which holds **1 devnet SOL** and **10 devnet
USDC**. Key-to-address derivation is the check that matters — matching a secret string proves
nothing about which wallet it controls. Exactly one line of the file changed; a backup was
taken, and the key set is otherwise identical.

Note the backup of the old file **contains the production treasury key** and is retained
locally only for rollback. It is now covered by `.gitignore` (`.env.*.bak*`) — it was
untracked-but-unignored before, which is a real hazard when committing with `git add -A`.

**Rotation status (2026-10-19):** the treasury key is rotated and verified on-chain. The Supabase
**service-role key is rotated and applied** to the Netlify production context (new-format
`sb_secret_`, 41 characters) — the anon key is untouched, so **no user was signed out**. The key
was rotated a second time after the first value was partially exposed in a transcript.

**The exposure is not yet closed.** Supabase's documentation is explicit that creating a new key
does **not** revoke the legacy one:

> *"Creating publishable and secret keys doesn't revoke your legacy keys. Both key systems work at
> the same time."*

So the legacy `service_role` key this finding concerns **still works** until it is deactivated in
**Settings → API Keys → Legacy API keys** — a reversible step. Before that, a **redeploy is
required**: Netlify resolves environment variables at build time, so production is still running
on the old key until the next build. Order matters — **redeploy → verify sign-in, admin operations
and rate limiting → then deactivate.**

If the legacy keys can only be deactivated together, the legacy **anon** key must first be migrated
to `sb_publishable_`, which touches `@supabase/ssr` (pinned at 0.1.0) and the auth middleware and
needs E2E testing rather than a toggle. Check whether the dashboard permits deactivating
`service_role` alone.

**CORRECTION — 2026-10-19. Reopened the same day it was closed.** Closing this rested on the
forward path being fixed and the credentials rotated. It did not account for **already-deployed
preview builds**, which keep the environment they were deployed with — Netlify resolves environment
variables at deploy time, so re-scoping the `deploy-preview` context does not change deploys that
already exist.

That was verified, not assumed. The reachable preview `deploy-preview-1--bitxbit-dashboard.netlify.app`
(branch `security/phase-1-hardening` @ `bdbdf003`) is wired to **production** on both sides:

- **Build time** — `/_next/static/chunks/app/auth/login/page-9473d2fb1854e1df.js` contains
  `createClient("https://flasgvendiiasuixeqzu.supabase.co", "<production anon key>")`. The chunk hash
  is identical to the production bundle's, because it was built from the same code with the same
  environment.
- **Runtime** — `/api/token-stats` on the preview returns **mainnet** token data for mint
  `DK6PWMyu…UH5`, matching production. The re-scoped preview context specifies **devnet USDC**
  (`4zMMC9s…ncDU`), so the live deploy is not using the re-scoped values.

**Seven preview deploys of `security/` branches are currently reachable**, all sharing the URL
`deploy-preview-1--bitxbit-dashboard.netlify.app`.

**RESOLVED — 2026-10-19.** Both required actions were completed and verified.

1. The branch preview was rebuilt from the site UI, picking up the re-scoped values. Isolation is
   now proven on three levels, not assumed: the client chunk hash differs from production's and
   contains only the staging project (zero production occurrences); `/api/token-stats` reports the
   devnet USDC mint; and `/api/public/offers` returns staging rows ("Staging Smoke Offer") where
   production returns "KAST".
2. **All seven production-wired preview deploys were deleted.** This was necessary because the
   rebuild alone did not close the hole — each deploy is served at its own immutable URL, and the
   stale preview stayed reachable at `https://6ad5779612fbd9e162ffbf39--bitxbit-dashboard.netlify.app`
   (HTTP 200, production reference present) after the rebuild. After deletion every deploy-specific
   URL returns **404**, the staging preview returns 200, and production returns 200 untouched.

D4's deployed-app HTTP test also ran for the first time as a result, and passed.

**Superseded status (2026-10-19, earlier the same day):** the owner deactivated the legacy
`service_role` key and retained the legacy `anon` key, so **no user was signed out** and the app was
unaffected. Verified by probing
the production anon key *after* the change: `/rest/v1/projects` and `/auth/v1/settings` both
return HTTP 200, with the new secret key also 200 and an unauthenticated request 401.

**Verification limitation, stated rather than glossed:** the legacy `service_role` key cannot be
probed independently for this record. Its value was deliberately overwritten and the key deleted,
so no copy exists to test against. Closure rests on the owner's action plus two consistent
observations — the anon key still authenticates, which means a per-key toggle was used rather than
a blanket legacy-keys switch, and Supabase's key listing reports the legacy anon key as
`disabled: false`. For independent confirmation, check that the legacy `service_role` key shows as
disabled in **Settings → API Keys → Legacy API keys**.

---

## R-013 — Local Netlify link targets the wrong site

**Status:** OPEN — **medium** (operational). Identified 2026-10-19.
**Owner:** Shri — interim accountable owner.

`dashboard-app/.netlify/state.json` links to `dazzling-vacherin-66d29b`
(`cadeb6c3-b3c2-42cb-ad0c-2a430fd74ab2`), **not** `bitxbit-dashboard`
(`9617719a-40f4-4743-8b85-770c2fe61f63` → `app.bitxbit.com.au`).

The stray site carries **no environment variables**, so there is no credential leak. The
hazard is operational: any `netlify env:*` command run without an explicit `--site` writes to
the wrong project. Every remediation command passed `--site` explicitly for this reason.

**Tracked as NA-12.**

---

## R-014 — Legacy Supabase API keys are being retired; production still depends on one

**Status:** OPEN — **HIGH** (availability). Identified 2026-10-22 while attempting the
deployed R-005/R-006 verification.
**Owner:** Shri — interim accountable owner.

### What was found

Supabase is retiring legacy `anon` / `service_role` JWT keys in favour of publishable and
secret keys. On this account the retirement **has already happened once**, in staging, and
nothing detected it for three days.

| Project | Legacy anon key | Consequence |
|---|---|---|
| `bitXbit-Staging` (`luqrwhgjtiyfmeawbtmp`) | **`disabled: true`** — disabled `2026-10-19T06:18:33Z` | **Authentication was broken on every preview deploy** |
| Production (`flasgvendiiasuixeqzu`) | still enabled | Works today; **would fail identically if disabled** |

**How it presented:** `/admin/*` and `/dashboard/*` returned `307 → /auth/login` for every
request, including authenticated ones. `supabase.auth.getUser()` in the middleware fails when
the anon key is rejected, so `user` is null and the route guard redirects. The app otherwise
looked entirely healthy — pages served, and every public endpoint returned 200.

**Why nothing caught it.** D4's deployed test asserts three *public* endpoints, and those use
the **service-role** key server-side, so they pass regardless of the anon key. Nothing in the
D4 harness exercises an authenticated path. This is a **blind spot in the D4 harness**, now
recorded — 34/34 previews were correctly "staging-scoped" while none of them could log anyone in.

### Remediation

**Staging — APPLIED 2026-10-22.** `NEXT_PUBLIC_SUPABASE_ANON_KEY` was re-pointed to the
staging project's live publishable key (`sb_publishable_CbgASUIR3MTwfSIohir2Kg_CYEGGi6o`) for
the `deploy-preview` and `branch-deploy` contexts **only**. The `production` context was not
written to: verified by sha256 before and after (`52bad0d3306368c4`, unchanged). Environment
variables resolve at deploy time, so this takes effect on the next preview build.

**Production — NOT applied. Requires a separate owner decision.** Production still runs a
legacy anon key. Migrating means replacing `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the `production`
context with the production project's publishable key, then redeploying. The value is
client-visible, so the change is low-risk in itself, but it is a production release and should
be done deliberately rather than opportunistically.

### Why this is recorded as a risk, not an incident

The retirement is not theoretical: it has already occurred in this account and went undetected
for three days. Production depends on the same key type, and the failure mode is a total
authentication outage for every user with no degraded state in between.

---

## D4 status

**D4 is SATISFIED — verified in deployments on 2026-10-19, re-verified 2026-10-22.**

**Correction (2026-10-22):** this section previously read *"satisfiable in configuration,
but NOT yet proven in a deployment"* and marked every row *"(unverified in a deploy)"*.
That was **stale** — the test had already run on 2026-10-19 against preview `6ad6a1fd`
(commit `bdbdf003`), as recorded in `evidence/phase-1-staging-rehearsal-2026-10-19.md`
§"D4 — deployed-app HTTP test — SATISFIED". The table below is now aligned with the
evidence. Same defect class as the R-009/R-013 summary contradictions.

| D4 requirement | Status |
|---|---|
| Staging uses the staging Supabase project | ✅ **verified 2026-10-22** — the preview client bundle contains `luqrwhgjtiyfmeawbtmp` and **zero** occurrences of `flasgvendiiasuixeqzu`; the production bundle (positive control) contains the reverse, proving the scan can detect a leak |
| Staging uses Solana devnet | ✅ **verified 2026-10-22** — all **34** preview deploys report devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`; production reports mainnet `DK6PWMyu…UH5` |
| No production service-role key reachable | ✅ **verified by use** — **zero** preview deploys leak a production reference; the seven production-wired previews were deleted 2026-10-19 |
| No production treasury wallet reachable | ✅ re-scoped to a funded devnet key (NA-11) |

**2026-10-22 re-verification.** All **34** preview deployments — from `security/phase-1-hardening`
(2026-10-19, the original D4 deploy) through `security/r006-request-size-limits` (2026-10-22)
— are staging-scoped: **34 devnet, 0 production-wired, 0 inconclusive**. Immutable per-deploy
URLs were sampled at both ends and were also staging-scoped. This mattered because 33 of
those deploys were created *after* the 2026-10-19 run and were covered by nothing.

Isolation was proven on three independent levels — client bundle (with a positive control),
runtime config (devnet mint), and runtime data. On data: the preview returns
`{"offers":[]}`, which **matches** staging's directly-queried empty `affiliate_offers` table,
where production returns `KAST` — a positive match, not an absence of evidence.

`npm run test:staging` against the preview passes every section.

**Harness defect fixed 2026-10-22.** The section named *"public API health and rate-limit
headers"* contained an **empty branch** — `if (!res.headers.get("x-ratelimit-limit")) { /* comment only */ }`
— which could never fail, and inspected three endpoints that are not rate limited, so the
header was never present. The section name promised a control the code did not check. The
assertion now targets `/api/health/rate-limit` (200, `x-ratelimit-degraded: false` in header
**and** body, not cached) and is **mutation-verified 3/3**.

**Bonus, recorded separately from D4's own claim:** driving `/api/public/resolve-referral`
past its limit **on the preview** produced the **first 429 at request #31**, with
`retry-after: 22` and `x-ratelimit-degraded: false` — R-004/NA-14 enforcement observed in a
deployment rather than locally.

**D4 proves staging isolation only.** It does **not** verify the R-005 (Server Action rate
limiting) or R-006 (request-size) controls — those are behind authentication and remain
*implemented and tested, not verified in a deployment*. See
`evidence/d4-deployed-staging-verification-2026-10-22.md`.

---

## Required next actions

| ID | Action | Risk | Status |
|---|---|---|---|
| **NA-1** | Add and test host/origin validation, including legitimate Netlify preview domains | R-003 | ✅ **RELEASED 2026-10-20** — PR #4 merged (deploy `6ad70e11`); harness mutation-verified (5/5 mutations detected); refusal path proven by a local integration run at the deployed commit. Not closed: independent review still waived. See `evidence/phase-1-host-origin-validation-released-2026-10-20.md` |
| **NA-2** | Shared rate-limit store; prove limits shared; remove silent fallback | R-004 | ✅ **DEPLOYED 2026-10-20** — migration `027` applied to production (ledger row recorded) and PR #5 merged (deploy `6ad71dde`). Atomicity proven by a 30-session concurrency test; the harness is mutation-verified (4/4 mutations detected). **Not closed** — post-deploy verification found the limiter keying on an infrastructure address; see NA-13. |
| **NA-3** | Prioritise rate limiting for costly Server Actions before significant production use | R-005 | ✅ **DONE 2026-10-22** — five costly actions bounded per user (`lib/action-rate-limit.ts`); refusals returned, not thrown; 146/146 tests, **8/8 mutations detected**. **Not verified in a deployment.** See `evidence/r005-server-action-rate-limiting-2026-10-22.md`. |
| **NA-4** | Keep the request-size boundary documented; make it explicit in the Next.js 15 migration | R-006 | ✅ **DONE 2026-10-22** — boundary made explicit in `next.config.mjs` and in a tested policy module; upload refusals now legible. 158/158 tests, **7/7 mutations detected**. **Not verified in a deployment.** See `evidence/r006-request-size-limits-2026-10-22.md`. |
| **NA-5** | Production backup, full schema-parity checks, rehearsal against a production-like database — before any production merge | R-008 | ✅ **DONE** — pg_dump backup (hashed), column-level fixture parity, staging rehearsal incl. D4 deployed-app test, then `010`–`026` applied to production with verification |
| **NA-6** | Resolve PR #2's CI trigger **without unnecessarily expanding automation credentials**; run CI on its exact merge candidate | Release process | **OPEN — needs an owner decision, see below** |
| **NA-7** | Preserve the fresh GitHub approval on PR #1; obtain new approval whenever a change invalidates it | Release process | ✅ Current approval is on head `bdbdf003`; re-approval required after any further push |
| **NA-8** | Re-scope production credentials out of preview contexts; **rotate** treasury + service-role keys | **R-009 (critical)** | **DONE 2026-10-19.** Re-scoping 20/20. Treasury rotated, verified on-chain, then proven end-to-end by a real production airdrop. Service key rotated, verified **by use** (200 vs production / 401 vs staging), proven by the same airdrop. Legacy `service_role` key deactivated; legacy `anon` retained so nobody was signed out. |
| **NA-9** | Mark credential variables `is_secret: true` | R-010 | **WITHHELD DELIBERATELY.** The flag is irreversible, drops the `post_processing` scope, and has a reported failure mode masking values in functions on branch deploys — D4's own context. Apply once a deployment can be observed. **That precondition is now MET (D4 satisfied 2026-10-22)** — a deployment can be observed, so this is actionable and awaiting owner authorisation, not blocked. |
| **NA-10** | Explicit per-context Solana RPC (devnet for preview/branch-deploy) | R-011 | ✅ **DONE** — `SOLANA_RPC_URL` → devnet for preview/branch-deploy; production left on its existing mainnet default |
| **NA-11** | Replace the production key in `.env.staging.local` with a funded devnet key | R-012 | ✅ **DONE** — fixture holds the funded devnet key; key derives to the funded address |
| **NA-12** | Re-link the local Netlify CLI to `bitxbit-dashboard` | R-013 | ✅ **DONE 2026-10-20** — `dashboard-app/.netlify/state.json` now points at `9617719a-…` (`bitxbit-dashboard`); it previously held `cadeb6c3-…` (`dazzling-vacherin-66d29b`). The file is gitignored, so this is a workstation fix with no repository change. |
| **NA-13** | Resolve the client address at the edge and forward it explicitly, so the rate limiter keys on the **client**, not an edge-node address | **R-004** | ✅ **DONE 2026-10-21.** Edge-forwarding was falsified — the header does not survive to a serverless function — so resolution moved to the **origin**: the client is the hop immediately left of Netlify's anchor, located from the right so a forged chain cannot displace it. Verified live. Deploy `6ad93872`. |
| **NA-14** | `/api/public/resolve-referral` does not enforce its rate limit | new | ✅ **FIXED AND VERIFIED 2026-10-21.** **Fix verified by outcome; mechanism NOT established.** The result was genuinely replayed — the counter never advanced, an expired window still reported `resetAt` **82.5 s in the past**, and only **2** upstream `check_rate_limit` requests reached Supabase across ~10 app requests in the failing window — but *which layer* replayed it was never pinned. This row originally recorded "Next.js's patched `fetch`"; **NA-16 (2026-10-22) measured that this does not hold as a general mechanism** (the same runtime does not cache a Supabase client request, GET or POST). Treat the mechanism as open; the fix stands on outcome. Observed in production — the store path returned byte-identical results within a request *and* across requests, while a raw `fetch` to the same RPC with `cache: "no-store"` incremented and tripped the limit. **Fix:** `createServiceClient()` forces `cache: "no-store"` (PR #21, deploy `15d84dca`). **Verified by outcome:** the store path now increments and trips, and the route returns **429 from request #29** against a 30/60 s limit. See `evidence/na14-resolve-referral-rate-limit-2026-10-21.md`. |
| **NA-15** | A degraded rate-limit store is undetectable in production | **R-004** | ✅ **FIXED AND VERIFIED 2026-10-21.** The fallback paths called `console.error`, but Netlify's request logs return `logs: []` even for requests with `has_function_invocation: true`, so a degraded store could not report its own degradation. **Fix:** a degradation registry (`lib/rate-limit-health.ts`, typed reasons + running count + timestamp) exposed on **`GET /api/health/rate-limit`** — **503 when degraded**, `cache-control: no-store`, `x-ratelimit-degraded` header, no credentials and no raw error text — plus the same header on the 429 path. **Verified:** the degraded branch was **executed against the real route file** (503, `backend: memory`, `lastReason: no-shared-store`) since production is healthy and cannot show it; live production reports `200 / degraded: false / backend: supabase` and is not cached (distinct `checkedAt` across calls); driving real traffic produced **no false positive**. 125/125 tests, **8/8 mutations detected**. **Limitation recorded:** the registry is per-process, so a probe observes one instance — adequate because the dominant failure modes are global, but not a substitute for watching counter rows advance. See `evidence/na15-degradation-visibility-2026-10-21.md`. |
| **NA-16** | `lib/supabase/server.ts` may share NA-14's fetch-caching flaw | **NA-14** | ✅ **MEASURED 2026-10-22 — NOT AFFECTED. No fix needed.** Measured in production with a temporary instrument (PR #24/#27) that read through the **real** server client while a raw `fetch` with `cache: "force-cache"` acted as a **positive control**; upstream requests were counted in Supabase's own edge logs, where the SSR client identifies itself as `supabase-ssr/0.1.0`. Over 5 app calls: `GET /rest/v1/users?select=id&limit=1` → **10 upstream (1:1, not cached)**; `POST /rest/v1/rpc/is_admin` → **10 (1:1, not cached)** — covering the mutating RPCs `lib/actions.ts` drives through this client (reward approval, payout finalization); control → **1 (cached)**, so the method demonstrably detects caching and the negative result is meaningful. Instrument removed. **Side finding:** this falsifies the general mechanism recorded for NA-14 — see that row. See `evidence/na16-server-client-fetch-caching-2026-10-22.md`. |

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
| R-001 | Next.js 14.2.35 residual advisories | Accepted, **conditional** — Condition 3 now satisfied in fact (host validation released; rate limiting live and verified; request limits explicit). Formally contingent only on **R-003's closure** (independent review waived). Interim bump **released 2026-10-20** (PR #8, deploy `6ad715a9`) | Shri (interim) | **2026-11-18 (expires)** |
| R-002 | `bigint-buffer`, no fix | Accepted, conditional | Shri (interim) | 2026-11-18 |
| R-003 | No host-header validation | **RELEASED 2026-10-20** (PR #4, deploy `6ad70e11`) — control verified; **not closed**, independent review still waived | Shri (interim) | NA-1 |
| R-004 | Rate limiting per-instance in production | ✅ **FIXED AND VERIFIED** — shared atomic store (migration `027`) keyed on the **real client** (verified live: keys carry `206.83.119.2`), not spoofable (a forged forwarded chain produced no new key), enforcing at 30/60 s → 429 from request #31. Deploy `6ad93872` | Shri (interim) | NA-13 done; NA-14 done |
| R-005 | Server Actions not rate limited | **IMPLEMENTED AND TESTED 2026-10-22** — five costly actions bounded per authenticated user; **not verified in a deployment** | Shri (interim) | NA-3 done |
| R-006 | No explicit request-size limits | **IMPLEMENTED AND TESTED 2026-10-22** — `bodySizeLimit` explicit; upload boundary enforced by a tested policy below the platform ceiling; **not verified in a deployment** | Shri (interim) | NA-4 done |
| R-007 | Next.js 15 migration | Planned (D1-D3 resolved) | Shri (interim) | Migration |
| R-008 | Production pre-010, no ledger | **RESOLVED 2026-10-19** — `010`–`026` applied and verified; ledger backfilled | Shri (interim) | NA-5 done |
| **R-009** | **Production credentials in preview/branch-deploy contexts** | **CLOSED 2026-10-19** — forward path closed, preview rebuilt staging-scoped, **all 7 production-wired deploys deleted and verified 404** | Shri (interim) | **NA-8** ✅ |
| R-010 | Secrets not marked secret | **OPEN** — deliberately withheld (see NA-9) | Shri (interim) | NA-9 |
| R-011 | No devnet constraint for non-production | **ADDRESSED** for preview/branch-deploy — unverified in a deploy | Shri (interim) | NA-10 |
| **R-012** | Production treasury key in a local staging file | **RESOLVED** — fixture swapped to devnet key; production key rotated anyway | Shri (interim) | closed |
| R-013 | Local Netlify link targets the wrong site | **OPEN** — operational | Shri (interim) | NA-12 |
| **R-014** | **Legacy Supabase API keys being retired; production depends on one** | **OPEN — HIGH (availability).** Staging's legacy anon key was disabled 2026-10-19, breaking auth on all previews (fixed 2026-10-22); **production still runs a legacy anon key** | Shri (interim) | New |

**Nothing in this register is closed by the ownership assignment.**
