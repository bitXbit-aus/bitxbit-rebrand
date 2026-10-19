# Runbook — Credential Rotation

**Scope:** the two credentials identified as exposed in
`netlify-environment-audit-2026-10-19.md` and `netlify-remediation-2026-10-19.md`.
**Status:** NOT executed. Requires the owner. Irreversible in parts.
**Why now:** both values were readable over the Netlify API with only site read access, and
the treasury key was additionally present in a plaintext local file (R-012).

> Re-scoping preview/branch-deploy contexts has closed the *forward* exposure path. Rotation
> addresses the fact that the values were already readable — including by any process on the
> workstation, and by anything with site read access before the re-scoping.

---

## A. Solana treasury / airdrop wallet

**Blast radius:** this wallet signs production airdrops. A mistake here loses funds or stops
airdrops. **Do this with a funded dry-run on devnet first.**

### Preconditions

- [ ] Confirm the current treasury address and balances (SOL for fees, plus the BITXBIT token).
- [ ] Confirm every consumer of the treasury address (allowlists, dashboards, the mobile
      backend, any hardcoded reference) — a new address breaks each one.
- [ ] Confirm a maintenance window; no airdrop should be mid-flight.
- [ ] **Pause any scheduled airdrop job.**

### Procedure

1. **Generate the new keypair** — on an offline/secure machine, not in a shell history.
   Record only the public key in shared notes.
2. **Fund the new wallet** with enough SOL for transaction fees.
3. **Transfer balances old → new**: the token balance first, then residual SOL.
   Send a **small test transfer first** and confirm it lands before moving the remainder.
4. **Verify the new wallet** holds the full balance and the old wallet is empty.
5. **Update `AIRDROP_WALLET_PRIVATE_KEY`** — production context, and only production:
   ```bash
   SITE=9617719a-40f4-4743-8b85-770c2fe61f63
   netlify env:set AIRDROP_WALLET_PRIVATE_KEY "<new-key>" --context production --site $SITE
   ```
6. **Deploy** so the new value is picked up (env vars resolve at deploy time).
7. **Smoke-test a real airdrop** end to end before re-enabling the scheduled job.
8. **Re-enable** the scheduled job.
9. **Do not destroy the old keypair** until step 7 passes and the old wallet is confirmed
   empty. Then retire it deliberately.

### Rollback

Re-set the production variable to the old key and redeploy. Possible only while the old
keypair still exists — which is why step 9 is last.

---

## B. Supabase service-role key

**Blast radius:** broader than the treasury key. Depending on which mechanism is used, anon
keys and **all active user sessions** may be invalidated.

Supabase has two mechanisms, and they differ materially — **confirm which applies to this
project in the Supabase dashboard before starting**:

- **Legacy JWT-secret rotation** — invalidates the anon key, the service-role key, *and* every
  issued user JWT. All users are signed out. Broadest blast radius.
- **API key rotation (newer format, names prefixed `sb_`)** — rotates the secret key
  independently. Prefer this where the project supports it. Note the staging fixture
  already carries a 41-character secret, consistent with the newer format.

### Procedure

1. **Enumerate every consumer of the key first.** At minimum:
   - [ ] Netlify `bitxbit-dashboard` — **every** context (production, deploy-preview,
         branch-deploy, dev)
   - [ ] `dashboard-app/.env.staging.local` and any developer `.env.local`
   - [ ] CI secrets for the hardening branch
   - [ ] Any other Netlify site (check `bitxbit-marketing` and the stray
         `dazzling-vacherin-66d29b`)
   - [ ] The mobile app backend, if it shares the project
2. **Rotate in the Supabase dashboard.** Note the timestamp — everything before it is suspect.
3. **Immediately update every consumer** from step 1. A gap of minutes is a production outage.
4. **Deploy** production and the staging contexts.
5. **Verify:** an authenticated read against staging, then production; confirm no
   `401`/`invalid JWT` in function logs.
6. **If user JWTs were invalidated**, expect a wave of sign-outs and communicate it.

### Rollback

There is none — the old key is invalid the moment rotation completes. The mitigation is
preparation, not reversal. This is the single most important reason to complete step 1 fully
before touching the dashboard.

---

## C. Ordering and verification

1. Rotate the **treasury key first** — narrow blast radius, and it is the credential with a
   confirmed second exposure path (a local plaintext file).
2. Fix **R-012** — replace `AIRDROP_WALLET_PRIVATE_KEY` in `dashboard-app/.env.staging.local`
   with a devnet key. The devnet wallet generated during remediation
   (`496yh6GUc7J7q8sepdoD9mgpf2Z38U54pB5kGsAqoGyU`) is available for this, but is **unfunded** —
   staging payout tests will fail until it holds devnet SOL and devnet USDC.
3. Rotate the **Supabase key last**, in a maintenance window.

**Verification after** — all three must hold:

- [ ] A test airdrop succeeds from the new treasury address.
- [ ] Staging and production both authenticate against Supabase.
- [ ] `netlify env:list --json --site $SITE` shows production and preview values still
      distinct, and no old credential remains in any context.

## D. After rotation

- [ ] Mark the rotated credentials `is_secret: true` — see the caveats in
      `netlify-remediation-2026-10-19.md` §3b; it is irreversible, so do it once a deployment
      can be observed.
- [ ] Record the rotation date in the risk register and clear R-012.
