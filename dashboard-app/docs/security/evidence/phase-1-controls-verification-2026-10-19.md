# Phase 1 — Security Control Verification

**Date:** October 19, 2026
**Purpose:** satisfy Condition 3 of Decision A — verify host-header validation,
request limits, shared rate limiting, and server-side access controls.
**Method:** static inspection of the deployed code paths and configuration at
commit `bdbdf00` (branch `security/phase-1-hardening`).
**Evidence level:** repository-inspectable. Every claim below is re-derivable from
the cited file and line.

---

## 1. Server-side access controls — ✅ VERIFIED (strong)

Authorization does **not** depend on middleware. It is enforced in `lib/authz.ts`
and called from the Server Actions themselves, so a middleware bypass would not
confer privilege.

**Guard functions defined** (`lib/authz.ts`):

```text
requireActiveUser      (lib/authz.ts:149)
requireActiveAdmin     (lib/authz.ts:155)
requireCapability      (lib/authz.ts:167)
```

**Usage across `app/` and `lib/`:**

| Guard | Call sites |
|---|---|
| `requireCapability` | 32 |
| `requireActiveUser` | 13 |
| `requireActiveAdmin` | 3 |

`lib/actions.ts` contains **30 exported Server Actions**; `requireCapability` alone
appears 28 times within it.

**Capability model.** `user_authorizations` carries discrete capability columns —
`can_manage_users`, `can_manage_rewards`, `can_manage_content`,
`can_manage_financials`, `can_manage_security` (migration 010). Guards check a
specific capability rather than a coarse "is admin" flag.

**Auditability.** Admin mutations run through `auditedAdminMutation()`
(`lib/actions.ts:96`), which writes success **and** failure records to
`security_audit_log` via `writeSecurityAudit()`. The table is created in migration
010 and extended in 012/013.

**Two Server Actions are intentionally unguarded:**

| Action | Why acceptable |
|---|---|
| `trackOfferClick` (`lib/actions.ts:939`) | Public referral-click tracking, by design. Validates `offerId` as UUID and parses `referralUrl` before use. |
| `getTokenBalanceAction` (`lib/actions.ts:1042`) | Reads a public on-chain token balance; no privileged data. |

**Assessment:** this is the strongest control in the set, and it is the reason the
residual Next.js advisories are acceptable — they do not include an auth bypass,
and authorization is enforced below the layer an auth bypass would target.

## 2. Shared rate limiting — ⚠️ CONDITIONAL

**Implementation.** `lib/rate-limit.ts` selects a store at first use:

```ts
if (url && token) { /* UpstashRedisRateLimitStore */ }
else              { /* MemoryRateLimitStore */ }
```

- **Shared when configured:** `UpstashRedisRateLimitStore` (`lib/rate-limit-redis.ts`)
  runs an **atomic Lua sliding-window counter** via `redis.eval`, so limits are
  shared across serverless instances. `@upstash/redis` is a direct dependency.
- **Not shared when not configured:** falls back to `MemoryRateLimitStore`, which
  is **per-process**. On serverless this means per-instance limits, so request
  spreading across instances multiplies the effective allowance.
- **The fallback is silent** — no warning is logged. This is R-004.

**Where limits are applied** (API routes only):

```text
app/api/token-stats/route.ts            TOKEN_STATS_RATE_LIMIT
app/api/public/resolve-referral/route.ts RESOLVE_RATE_LIMIT
app/api/public/_shared.ts                PUBLIC_RATE_LIMIT
app/api/wallet/rewards/route.ts          WALLET_REWARDS_RATE_LIMIT
```

**Server Actions are not rate limited** — `checkRateLimit` appears **0 times** in
`lib/actions.ts` (30 actions). This is R-005.

**Client identity** (`getClientIdentifier`, `lib/rate-limit.ts:44`) is
well designed:

1. Prefers `x-nf-client-connection-ip` — Netlify's trusted, edge-set header.
2. Trusts `X-Forwarded-For` **only** when `TRUST_PROXY=true` or
   `RATE_LIMIT_TRUST_PROXY=true` is explicitly set, with the comment that without
   this guard "a client can bypass per-IP rate limiting by sending an arbitrary
   forwarded header".
3. Falls back to `request.ip` → `"anonymous"`.

**Assessment:** the *mechanism* is correct and genuinely shared when Upstash
credentials are present. **This has not been confirmed for the deployed
environment** — I cannot read the Netlify environment variables. Until
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are confirmed set on the
production site, rate limiting must be treated as per-instance, and any accepted
risk that relies on it should not.

## 3. Host-header validation — ❌ ABSENT

A repository-wide search for `Host` / `X-Forwarded-Host` validation returned **no
matches**. `middleware.ts` applies security headers but does not inspect the
inbound host. No `allowedOrigins` is configured for Server Actions.

**Assessment:** not confirmed as a control. Recorded as **R-003**. Netlify's edge
normally normalises the host, so practical exposure is limited, but there is no
application-layer defence. To be added during the Next.js 15 migration.

## 4. Request limits — ⚠️ DEFAULTS ONLY

`next.config.mjs` in full:

```js
const nextConfig = {
  reactStrictMode: true,
  images: { domains: ['localhost'], unoptimized: true },
};
```

No `experimental.serverActions.bodySizeLimit`, no `maxDuration`, no
`serverExternalPackages`. Next's **1 MB default** applies to Server Action bodies.
Recorded as **R-006**; make the bound explicit during migration.

## 5. Image optimisation — ✅ DISABLED

`images.unoptimized: true` (`next.config.mjs`), and `next/image` is not used
anywhere in the application. This is the configuration that neutralises both
remaining `next` criticals (AVIF RCE, and the DoS/XSS image-optimiser advisories).
**Any change to this setting voids R-001.**

## 6. Deployment platform — ✅ Netlify / Linux

`netlify.toml` installs `@netlify/plugin-nextjs` (resolved 5.16.2); the site
`bitxbit-dashboard` serves `https://app.bitxbit.com.au` with `main` as its branch.
This makes the Windows-hosted RCE advisory inapplicable.

---

## Findings summary

| Control | Verified | Notes |
|---|---|---|
| Server-side access controls | ✅ | Capability guards, 30 actions, audited; independent of middleware |
| Shared rate limiting | ⚠️ | Shared **only** with Upstash credentials; silent per-instance fallback (R-004) |
| Rate limiting on Server Actions | ❌ | Not applied (R-005) |
| Client identity for rate limiting | ✅ | Netlify header preferred; XFF behind explicit flag |
| Host-header validation | ❌ | Absent (R-003) |
| Request-size limits | ⚠️ | 1 MB Next default only (R-006) |
| Image optimisation disabled | ✅ | `unoptimized: true`; `next/image` unused |
| Netlify / Linux | ✅ | Adapter present; Windows RCE N/A |

**Two of the four controls Decision A names are verified unconditionally
(server-side access controls; platform/config). Two are conditional or absent
(rate limiting depends on unverified environment variables; host-header validation
is not implemented).** These are recorded rather than smoothed over.
