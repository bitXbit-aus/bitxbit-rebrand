# Runbook — Credential Rotation

**Scope:** the two credentials identified as exposed in
`netlify-environment-audit-2026-10-19.md` and `netlify-remediation-2026-10-19.md`.
**Status:** NOT executed. Owner action. Partly irreversible.
**Verified:** 2026-10-19 — figures below were read from mainnet and from the repository.

> Re-scoping preview/branch-deploy contexts closed the *forward* exposure path. Rotation
> addresses the fact that the values were **already readable**: over the Netlify API with only
> site read access, in a plaintext local file, and via preview deployments that executed branch
> code with production credentials.

---

## 0. What is actually at stake

### Treasury wallet — measured, not assumed

| | |
|---|---|
| Address | `E5qLqZMRcgKE61Tg4TssjYw5R291gHvmfkVLhWQ8PffQ` |
| BITXBIT holdings | **29.999 tokens** (9 decimals) in ATA `D2FaTvbGKAzHy1gLy2NXfnm1kYaxwHLfsBB4GJduJ5MK` |
| SOL holdings | 0.024811357 SOL (fees and rent only) |
| Token price | ~$3.46 (Raydium, ~$5.0k liquidity) |
| **Value at risk** | **≈ $104** |

Derived the address from the key rather than trusting a note — the key in the local backup
file still derives to the address above, confirming it is the production wallet.

**No repository file references the address** (checked across `.ts`/`.tsx`/`.sql`/`.js`/`.json`/`.md`).
Nothing in the codebase is hardcoded to the old wallet, so rotation is a configuration change,
not a code change.

### Supabase service-role key — blast radius depends on which mechanism you use

The project has **both** key formats. Production currently stores the **legacy** JWT
service-role key; the staging fixture already carries a 41-character `sb_…` secret.

Installed `@supabase/supabase-js` is **2.117.1**, which supports the newer API key format. That
means you can rotate **without invalidating user sessions** (see §B).

### Consumers — enumerated

| Consumer | Credential | Action needed |
|---|---|---|
| Netlify `bitxbit-dashboard`, **production** context | production service-role key | update |
| Netlify `bitxbit-dashboard`, preview + branch-deploy | **staging** key (already re-scoped) | none, unless staging key also rotates |
| `dashboard-app/.env.staging.local` | `STAGING_SUPABASE_SERVICE_ROLE_KEY` (separate key) | only if staging rotates |
| `.github/workflows/dashboard-ci.yml` | literal `dummy` | **nothing to rotate** |
| `bitxbit-marketing`, `dazzling-vacherin-66d29b` | **no env vars at all** | none |
| Mobile app backend | **does not exist** — the product is web-only | none |

Good news: **CI carries no real secret** — it builds against dummy values, so there is no CI
credential to rotate and no window where CI breaks.

---

## A. Treasury / airdrop wallet

**Blast radius:** this wallet signs production airdrops. A mistake stops airdrops or strands
the balance. **Rehearse on devnet first** — that path is now unblocked, the devnet wallet
`496yh6GUc7J7q8sepdoD9mgpf2Z38U54pB5kGsAqoGyU` holds 1 devnet SOL and 10 devnet USDC.

**Cost:** roughly 15 minutes and a few thousand lamports in fees. Against ~$104 of exposure
and a key that has been readable in plaintext, that is cheap.

### Preconditions

- [ ] Confirm the address and balances above are still current.
- [ ] Confirm **you** are the only holder of the current key (the local backup at
      `dashboard-app/.env.staging.local.bak-*` also contains it — that file should be deleted
      once rotation completes).
- [ ] Pick a maintenance window; no airdrop mid-flight.
- [ ] Pause any scheduled airdrop job.

### Procedure

1. **Generate the new keypair offline** — not in a shell history, not in a file synced to a
   cloud. Record only the public key in shared notes.
2. **Fund the new wallet** with SOL for fees (a few thousand lamports is ample).
3. **Create the destination token account** for the BITXBIT mint, then **transfer a test
   amount first** (e.g. 0.001 tokens) and confirm it lands.
4. **Transfer the remaining ~29.998 BITXBIT**, then sweep residual SOL.
   Note: creating the destination ATA costs ~0.00204 SOL rent, paid by the **old** wallet,
   which has 0.0248 SOL — sufficient.
5. **Verify:** new wallet holds the full balance; old wallet holds zero tokens.
6. **Update the production context only:**
   ```bash
   SITE=9617719a-40f4-4743-8b85-770c2fe61f63
   netlify env:set AIRDROP_WALLET_PRIVATE_KEY "<new-key>" \
     --context production --site $SITE
   ```
   Do **not** touch preview/branch-deploy — those correctly hold the devnet key.
7. **Deploy**, because environment variables resolve at deploy time.
8. **Smoke-test a real airdrop** end to end.
9. **Re-enable** the scheduled job.
10. **Delete the local backup file** and the old key material — only after step 8 passes and
    the old wallet is confirmed empty.

### Rollback

Re-set the production variable to the old key and redeploy. Possible only while the old keypair
still exists — which is why step 10 is last.

### Completion record — 2026-10-19

Executed by the owner. **Verified independently from chain data**, not from a report of what was
done — the transfers below were read from mainnet transactions, and the old wallet's balances were
queried directly.

| Check | Evidence |
|---|---|
| Token balance moved | tx `P2VcVGPk…`: **29.999 BITXBIT** `E5qLq…ffQ` → `J3KDs55n…1NJu` |
| Old wallet emptied of tokens | BITXBIT `0` |
| Residual SOL swept | tx `3iPn4No2…`: −0.023304319 → +0.023292959 to the new wallet |
| Old wallet fully drained | SOL `0.0` |
| New wallet holds the balance | **29.999 BITXBIT** + 0.023292959 SOL, ATA `2vfQuHA7…iBvW` |
| Env points at the new key | masked suffix `…3NuP` matches the key the owner holds |

**New treasury address: `J3KDs55nHsUr47dLi1nqNsTPvGq6VJiemXAKYEh91NJU`.**

**Two caveats, stated rather than glossed:**

1. **The key match is a 4-character suffix check, not a derivation.** The value cannot be read back —
   it is flagged secret, and Netlify does not return secret values through the UI, CLI or API in any
   context. The suffix rules out *a different key* being stored, which is the failure that would
   silently break airdrops; it does not prove the remainder is byte-identical. The definitive test is
   a real airdrop after a deploy (§D).
2. **`AIRDROP_WALLET_PRIVATE_KEY` is now flagged secret.** That protects the value — it is no longer
   readable over the API, which was one of the original exposure paths. But the flag is
   **irreversible**, and secret variables cannot carry the `post_processing` scope. More importantly,
   secret values must still reach the runtime for signing to work; a documented failure mode has
   secrets masked inside functions on branch deploys. **This needs verification on a deployment, not
   an assumption.** Added to the D4 probe.

**Not yet retired:** the old keypair. It controls a now-empty wallet, so the risk is minimal, but the
local backup containing it (`dashboard-app/.env.staging.local.bak-*`) still exists and should be
deleted once the airdrop test passes.

---

## B. Supabase service-role key

**Two mechanisms. Choose deliberately — they differ enormously.**

### Option 1 (preferred): rotate the newer-format secret key

Supabase's newer API keys (`sb_secret_…` / `sb_publishable_…`) are independent of the JWT
secret. Rotating the secret key:

- does **not** invalidate the anon key,
- does **not** invalidate issued user JWTs,
- therefore **does not sign anyone out**.

Requirements: the project must have the new key format enabled (it does — a
`sb_publishable_…` key is present), and the client must support it
(`@supabase/supabase-js` 2.117.1 here — it does).

**This also improves posture**: it moves production off a credential tied to the JWT secret.

### Option 2: rotate the legacy JWT secret

Only if Option 1 is unavailable. This invalidates the anon key, the service-role key **and
every issued user JWT** — all users are signed out. Far broader, and avoidable here.

### Procedure

1. **Finish §0's consumer table.** The consumer list is now complete: there is no mobile
   app, the product is web-only, and CI carries only a dummy. The only place holding a real
   production service-role key is the Netlify production context.

   **The safe path is verified, not assumed.** `@supabase/supabase-js` 2.117.1 recognises
   new-format keys — its built bundle contains
   `isNewApiKey = (key) => key.startsWith("sb_publishable_") || key.startsWith("sb_secret_")`
   and sends such keys **only** in the `apikey` header, never as a Bearer token. The staging
   project already runs on an `sb_secret_` key and its smoke and fault tests pass, so the
   format is proven in this codebase. Nothing decodes or validates the service key as a JWT.
   `@supabase/ssr` (0.1.0) consumes only the anon key, which stays a legacy JWT, so auth
   middleware is unaffected either way.
2. **Create/rotate in the Supabase dashboard.** Note the exact time; anything before it is
   suspect.
3. **Immediately update every consumer.** A gap of minutes is an outage.
   ```bash
   netlify env:set SUPABASE_SERVICE_ROLE_KEY "<new-key>" --context production --site $SITE
   ```
   Also update `NEXT_PUBLIC_SUPABASE_ANON_KEY` **only** if you chose Option 2.
4. **Deploy** production.
5. **Verify:** an authenticated read against production; confirm no `401` / `invalid JWT` in
   function logs; confirm rate limiting still works (`check_rate_limit` needs the service key).
6. **If you chose Option 2**, expect sign-out traffic and communicate it first.

### Rollback

**None.** The old key is invalid the instant rotation completes. The mitigation is preparation —
which is why step 1 is not optional.

---

## C. Order and verification

1. **Treasury first.** Narrow blast radius, ~$104, reversible while the old keypair survives.
2. **Supabase second**, in a maintenance window, using Option 1 if available.
3. **Rehearse both on devnet/staging before touching production.**

**R-012 is already closed** — `.env.staging.local` now holds the funded devnet key, verified by
deriving its address.

**Verification after — all must hold:**

- [ ] A test airdrop succeeds from the new treasury address.
- [ ] The old treasury address holds zero tokens.
- [ ] Production authenticates against Supabase; no auth errors in logs.
- [ ] Rate limiting still functions (it depends on the service-role key).
- [ ] `netlify env:list --json --site $SITE` shows production and preview values still
      **distinct** — rotation must not undo the re-scoping.
- [ ] The local backup file containing the old key is deleted.

## D. Afterwards

- [ ] Mark rotated credentials `is_secret: true`. The flag is **irreversible** and drops the
      `post_processing` scope, so do it when a deployment can be observed to verify
      (`netlify-remediation-2026-10-19.md` §3b).
- [ ] Record the rotation date in the risk register and close NA-8.
- [ ] Decide whether preview/branch-deploy should keep staging credentials at all, or hold none.
