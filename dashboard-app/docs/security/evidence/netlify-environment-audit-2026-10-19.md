# Netlify Environment Audit — bitxbit-dashboard

**Date:** October 19, 2026
**Target:** Netlify site `bitxbit-dashboard` (`9617719a-40f4-4743-8b85-770c2fe61f63`) → `app.bitxbit.com.au`
**Method:** read-only retrieval of the site's environment configuration via the Netlify API, plus the team-level variable set.
**Purpose:** resolve NA-2 (confirm shared rate-limit store) and establish whether D4 (staging isolation) is currently satisfiable.

> **Handling note.** The retrieval returned variable *values*, including credentials. **No secret value is reproduced in this document.** Findings are stated by variable name, context, and scope. The exposure of those values during the audit is itself part of the finding — see R-010.

---

## 1. Verdict

| Question | Answer |
|---|---|
| Is Upstash configured? | **NO** — neither site-level nor team-level |
| Are rate limits actually shared in production? | **NO** — the in-memory fallback is what runs |
| Is D4 (staging isolation) satisfiable as configured? | **NO** — previews and branch deploys share production's credentials |
| Are secret values marked secret? | **NO** — `is_secret` is false on every variable, including the treasury key |

---

## 2. R-004 CONFIRMED — rate limiting is per-instance in production

`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` **are not present** at site level and the team variable set is **empty**.

`getRateLimitStore()` therefore takes its `else` branch on every production instance and uses `MemoryRateLimitStore`. Consequences:

- Limits apply **per serverless instance**, not globally.
- An attacker spreading requests across instances receives a multiple of the intended limit.
- The fallback is **silent** — no warning is logged, so this was invisible until now.

This upgrades R-004 from "unconfirmed / conditional" to **confirmed and active in production**. R-005 (rate limiting for costly Server Actions) is **not worth implementing until this is fixed** — adding limits to a store that isn't shared would create the appearance of protection without the substance.

**It also weakens the basis of other accepted risks.** Any reasoning that assumed a request ceiling holds is unsound as configured.

## 3. CRITICAL — deploy previews and branch deploys carry production credentials

Every variable present in the `production` context is **also present in `branch-deploy` and `deploy-preview` with the same value**, or is scoped to `all`:

| Variable | Contexts | Significance |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **all** | Production Supabase service-role key — bypasses RLS |
| `NEXT_PUBLIC_SUPABASE_URL` | **all** | Resolves to the **production** project |
| `AIRDROP_WALLET_PRIVATE_KEY` | production, branch-deploy, deploy-preview | **Production treasury signing key**, identical across all three |
| `BITXBIT_TOKEN_MINT` | production, branch-deploy, deploy-preview | Production mint, identical across all three |
| `NEXT_PUBLIC_APP_URL` | **all** | `https://app.bitxbit.com.au` — previews identify as production |
| `BIRDEYE_API_KEY`, `BITXBIT_TOKEN_DECIMALS` | production, branch-deploy, deploy-preview | Shared |

**Consequence:** a deploy preview or branch deploy executes **arbitrary branch code** with the **production treasury private key** and the **production service-role key** in its runtime environment, pointed at **production Supabase**.

The repository is **public**, and deploy previews are publicly reachable. Any branch pushed to the repo — including a work-in-progress branch, or a malicious dependency's postinstall script — runs with the ability to sign transactions from the treasury wallet and to read/write the production database with service-role authority.

This is not a hardening nicety. It is a live path from "push a branch" to "sign with the treasury key".

**Tracked as R-009.**

## 4. No non-production Solana RPC or devnet configuration

There is **no `SOLANA_RPC_URL` or `NEXT_PUBLIC_SOLANA_RPC_URL` variable at all**. The application therefore resolves its RPC endpoint from defaults. Nothing constrains non-production deployments to devnet.

**Tracked as R-011.** D4 requires "Solana devnet only" for staging; as configured this cannot be asserted, let alone verified.

## 5. Secret values are not marked secret

`is_secret` is **false on every variable**, including `AIRDROP_WALLET_PRIVATE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.

The auditread these values over the API without any special privilege beyond site read access. Values marked `is_secret` are masked in the Netlify UI and withheld from API reads; these are not, so the treasury private key is readable by anyone with site access and appears in plaintext in the dashboard.

**Tracked as R-010.**

## 6. D4 status: not satisfiable as configured

D4 requires a staging deployment on **staging Supabase and Solana devnet**, with **no production credentials or resources involved**. Against this configuration:

| D4 requirement | Status |
|---|---|
| Staging uses the staging Supabase project | ❌ previews/branch deploys use the production project |
| Staging uses Solana devnet | ❌ no RPC variable exists to constrain it |
| No production service-role key reachable | ❌ shared via `all` scope |
| No production treasury wallet reachable | ❌ shared with preview and branch-deploy contexts |

**D4 cannot be satisfied without a configuration change**, and this must be resolved before any deployed staging evidence can be admitted — including the evidence PR #4 needs for R-003 closure.

## 7. Recommended remediation (owner authorisation required)

None of these is a code change the agent can make safely; all have blast radius.

1. **Rotate the airdrop wallet private key.** It has been stored non-secret and exposed to preview code paths. Rotation is an operational treasury action and needs the owner's decision — but treat the current key as exposed.
2. **Rotate the Supabase service-role key** for the same reason.
3. **Mark all credential variables `is_secret: true`.**
4. **Scope production credentials to the `production` context only.** Preview and branch-deploy contexts should carry staging values, or none.
5. **Create a dedicated staging Netlify site** (or a properly scoped preview context) wired to staging Supabase and devnet — the prerequisite for D4.
6. **Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`** to satisfy R-004, then prove sharing across instances.
7. **Remove the silent in-memory fallback** in production so an unshared store fails loudly rather than quietly.

## 8. Reproduce

```text
Site env vars : Netlify project bitxbit-dashboard → manage-env-vars (getAllEnvVars)
Team env vars : get-team-env-vars → empty
```

Read-only. No variable was created, modified, or deleted.
