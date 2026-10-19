# Netlify Remediation — bitxbit-dashboard

**Date:** October 19, 2026
**Target:** Netlify site `bitxbit-dashboard` (`9617719a-40f4-4743-8b85-770c2fe61f63`) → `app.bitxbit.com.au`
**Basis:** findings in `netlify-environment-audit-2026-10-19.md`
**Method:** Netlify CLI, values sourced from files so no secret passed through an agent tool call.

> **Handling note.** No secret value appears in this document, and none was passed as an
> inline tool argument. Verification was performed by hashing values locally and comparing,
> not by printing them.

---

## 1. Applied — R-009 exposure path closed

Seven variables were re-scoped for the two non-production contexts
(`deploy-preview`, `branch-deploy`). **The `production` context was not written to.**

| Variable | preview / branch-deploy now resolves to |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | staging project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | staging service-role key |
| `AIRDROP_WALLET_PRIVATE_KEY` | **newly generated devnet keypair** |
| `BITXBIT_TOKEN_MINT` | devnet USDC mint |
| `BITXBIT_TOKEN_DECIMALS` | `6` (devnet) |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` (**newly added**) |

Generating a fresh devnet wallet was necessary because the existing staging fixture reused
the production treasury key — see §4. New devnet wallet public key:
`496yh6GUc7J7q8sepdoD9mgpf2Z38U54pB5kGsAqoGyU`. It is **unfunded**.

## 2. Verification — 20/20 assertions pass

Read back per-context via the CLI and compared by hash.

**Production context is unchanged — this is the load-bearing claim:**

| Assertion | Result |
|---|---|
| Production Supabase URL unchanged | ✅ |
| Production `BITXBIT_TOKEN_DECIMALS` still `9` | ✅ |
| Production token mint unchanged | ✅ |
| Production treasury key unchanged | ✅ |
| Production `NEXT_PUBLIC_APP_URL` unchanged | ✅ |
| Production has **no** `SOLANA_RPC_URL` (default preserved) | ✅ |

**Isolation achieved:**

| Assertion | Result |
|---|---|
| deploy-preview + branch-deploy Supabase URL → staging | ✅ |
| deploy-preview + branch-deploy service-role → staging SRK | ✅ |
| deploy-preview + branch-deploy airdrop → new devnet key | ✅ |
| deploy-preview + branch-deploy mint → devnet USDC | ✅ |
| deploy-preview + branch-deploy decimals → `6` | ✅ |
| deploy-preview + branch-deploy RPC → devnet | ✅ |
| preview service-role **differs** from production | ✅ |
| preview anon key **differs** from production | ✅ |

**Write semantics were validated before the batch.** A single probe changed
`BITXBIT_TOKEN_DECIMALS` for `deploy-preview` only; read-back confirmed `branch-deploy` and
`production` both stayed `9`. Only then were the remaining writes issued.

**Applies at next deploy.** Netlify resolves environment variables at deploy time, so these
changes take effect on the next build of each context. Nothing was deployed. **The
configuration is not yet proven in a running deployment** — that is D4's job.

## 3. Not applied — and why

### 3a. Credential rotation (NA-8 residual) — cannot be done by the agent

- **Treasury key:** rotation requires generating a keypair *and moving funds from the old
  wallet*, signed with the old key. That is an irreversible treasury transaction. It is the
  owner's action.
- **Supabase service-role key:** the Supabase API exposes no key-rotation operation; it is a
  dashboard action, and rotating the JWT secret invalidates the anon key and all sessions,
  requiring coordinated updates of every consumer.

Runbook: `docs/security/runbooks/credential-rotation.md`.
Re-scoping has closed the *preview* exposure path; rotation remains prudent because the
values were readable — from the API and from a local plaintext file (§4).

### 3b. Marking secrets `is_secret: true` (NA-9) — deliberately withheld

The Netlify Secrets Controller docs state:

- **"After an environment variable is flagged as a secret, you cannot remove the flag."**
  Irreversible.
- Secrets **cannot carry the `post_processing` scope** — the current variables have
  `[builds, functions, post_processing, runtime]`, so marking them would silently drop a
  scope.
- A documented failure mode has secret values **masked inside functions on branch deploys** —
  which is precisely the context D4 depends on.

Given irreversibility, a silent scope change, and a failure mode landing on the staging
context we are about to rely on — and no way to verify without deploying — this was **not
applied**. Recommended sequence, once a deployment can be observed:

```bash
SITE=9617719a-40f4-4743-8b85-770c2fe61f63
netlify env:set SUPABASE_SERVICE_ROLE_KEY  --secret --site $SITE
netlify env:set AIRDROP_WALLET_PRIVATE_KEY --secret --site $SITE
netlify env:set BIRDEYE_API_KEY            --secret --site $SITE
```

Do **not** mark `NEXT_PUBLIC_*` variables secret: they are compiled into the client bundle by
design, so the flag would be theatre while risking the build.

### 3c. Upstash (NA-2) — blocked on credentials the agent does not hold

Provisioning requires an Upstash account. Once `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` are supplied they can be set per context, and sharing must then be
**proven across two concurrent instances** rather than assumed.

## 4. New findings from this work

### R-012 — the production treasury key is in a local staging file

`dashboard-app/.env.staging.local` (mode 600, git-ignored) contains an
`AIRDROP_WALLET_PRIVATE_KEY` whose SHA-256 **is identical to the production treasury key**.
Confirmed by hash comparison.

Consequences:

- The staging/devnet tests run earlier in this engagement signed with the **production
  treasury wallet**, so credential isolation was never real on the local side either.
- The production treasury key exists in a plaintext file on the workstation, in addition to
  its previous exposure through the Netlify API.
- This is an independent argument both for **rotating the key** and for replacing the local
  fixture with a devnet key.

**Not changed by the agent** — swapping the fixture would break staging payout tests until a
devnet wallet is funded, which is an owner decision. The new devnet wallet generated for
previews is available for this purpose once funded.

### R-013 — local Netlify link targets the wrong site

`dashboard-app/.netlify/state.json` links to `dazzling-vacherin-66d29b`
(`cadeb6c3-b3c2-42cb-ad0c-2a430fd74ab2`), **not** `bitxbit-dashboard`. The stray site carries
**no environment variables**, so there is no credential leak there — but any `netlify env:*`
command run from this directory without an explicit `--site` writes to the wrong project.
Every command in this remediation passed `--site` explicitly for that reason.

## 5. Effect on the open risks

| Risk | Before | After |
|---|---|---|
| R-009 production credentials in previews | OPEN — critical | **Exposure path closed** (pending deploy-time verification under D4) |
| R-004 per-instance rate limiting | CONFIRMED ACTIVE | Unchanged — still needs Upstash |
| R-010 secrets not marked secret | OPEN | Unchanged — deliberately withheld, §3b |
| R-011 no devnet constraint | OPEN | **Addressed for preview/branch-deploy** |
| D4 staging isolation | Unsatisfiable | **Now satisfiable** in configuration; needs deployed verification |
| R-012 / R-013 | — | New, open |

## 6. Reproduce

```bash
netlify env:list --context production     --json --site 9617719a-40f4-4743-8b85-770c2fe61f63
netlify env:list --context deploy-preview --json --site 9617719a-40f4-4743-8b85-770c2fe61f63
netlify env:list --context branch-deploy  --json --site 9617719a-40f4-4743-8b85-770c2fe61f63
```
