# R-014 (production half) — retired legacy anon key, preventative replacement (2026-10-22)

**Severity:** HIGH (availability). **Status:** production re-pointed to the publishable key and
deployed. **Verified in a deployment** for the client bundle and the auth endpoint; **not yet
verified end-to-end with a real authenticated session** (§6).

Continues `r014-legacy-anon-key-staging-auth-2026-10-22.md`, which fixed the
`deploy-preview` and `branch-deploy` contexts and left production exposed.

---

## 1. The exposure

Production was still serving a **legacy anon JWT** (208 chars, `eyJhbGciOiJI…`) as
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Supabase had already disabled the legacy keys on the
**staging** project at `2026-10-19T06:18:33Z`, which broke staging auth silently for three
days — the failure presents as an authorisation redirect, indistinguishable from an
anonymous request.

Production's legacy key was still `disabled: false` at the time of this work, so **nothing
was broken**. This was a preventative change: the same key class had already been disabled
once on this account, and the failure mode is a total login outage with no error surface.

## 2. Pre-flight — every check before touching production

| Check | Result |
|---|---|
| Identity: does the fetched legacy key match production's live value? | **yes** — sha256 `52bad0d3306368c4`, len 208, identical to the Netlify production value |
| Supabase reports the production legacy key as disabled? | **no** — `disabled: false` (still working, hence preventative) |
| Production publishable key available? | **yes** — `sb_publishable_…`, 46 chars |
| Legacy key on production `/auth/v1/settings` | **HTTP 200** (baseline) |
| **Publishable key** on production `/auth/v1/settings` | **HTTP 200** ✓ |
| Password-grant discriminator, legacy key | `400 invalid_credentials` / "Invalid login credentials" |
| Password-grant discriminator, **publishable key** | `400 invalid_credentials` / **identical** ✓ |
| Does any app code parse the anon key as a JWT or read its `ref`? | **no** — only passed to `createClient` at `lib/supabase/client.ts:6`, `lib/supabase/server.ts:8`, `middleware.ts:80` |
| Precedent for the new key format on this exact code | **staging previews already authenticate with a publishable key** (R-014's staging fix) |

The password-grant discriminator is the useful one: an **invalid** key returns
`401 Invalid API key`, whereas a **valid** key with a nonexistent user returns
`400 invalid_credentials`. Both keys returning the identical `invalid_credentials` response
proves the publishable key is accepted for the exact operation the login form performs.
No credentials were involved — the email is `nonexistent@example.invalid` and the password
is a deliberately invalid literal.

## 3. Change applied

```
netlify env:set NEXT_PUBLIC_SUPABASE_ANON_KEY "$(cat <file>)" \
  --context production --site 9617719a-40f4-4743-8b85-770c2fe61f63 --force
```

Written **via the CLI from a file**, so the value never entered an agent tool call.
Deliberately **not** flagged `--secret`: `NEXT_PUBLIC_*` variables are compiled into the
client bundle by design, and Netlify's Secrets Controller flags are irreversible.

Per-context scoping verified by hash — **the other contexts were untouched**:

| Context | Before | After |
|---|---|---|
| `production` | len 208 · `52bad0d3306368c4` | len 46 · **`c26787289bfc0ab3`** |
| `deploy-preview` | len 46 · `05709071c2150bb6` | len 46 · `05709071c2150bb6` *(unchanged)* |
| `branch-deploy` | len 46 · `05709071c2150bb6` | len 46 · `05709071c2150bb6` *(unchanged)* |

Env vars resolve at **deploy time**, so a production rebuild was required —
`createSiteBuild` on the same commit (`5bdd9bab`), producing deploy `6adabec7…`, **ready**.

## 4. Post-deploy verification (measured)

| Check | Result |
|---|---|
| `/auth/login` | **200** |
| Login page chunk containing the **publishable** key | `app/auth/login/page-602b8b6ba6e4a1cd.js` ✓ |
| Chunks containing the **legacy JWT** | **none** — 0 of 15 on the login page, and 0 across `/dashboard` and `/` |
| Password-grant discriminator post-deploy | publishable key → `invalid_credentials` (valid) |
| `/api/health/rate-limit` | **200** |
| `/api/token-stats` | **200** |

Before the deploy the same scan found the legacy JWT in
`page-85467fe212e3974c.js` and **no** publishable key; after, that file is gone and its
successor carries the publishable key. The bundle change is direct evidence the new value
was baked in, not merely set.

## 5. Rollback

Restore the legacy key (its value is re-fetchable from the Supabase Management API even
when disabled) and rebuild:

```
netlify env:set NEXT_PUBLIC_SUPABASE_ANON_KEY "<legacy value>" \
  --context production --site 9617719a-40f4-4743-8b85-770c2fe61f63 --force
netlify api createSiteBuild --data '{"site_id":"9617719a-40f4-4743-8b85-770c2fe61f63"}'
```

Note this rollback is **time-limited**: it only works while Supabase keeps the legacy key
enabled. Once Supabase disables it, rollback is not available and the publishable key is
the only viable configuration — which is the reason for making this change before that
happens rather than after.

## 6. Limitation — the end-to-end proof is outstanding

**A real authenticated sign-in has not been exercised against production.**

What is proven: the publishable key is valid and accepted by production's auth endpoints for
the exact password-grant operation the login form performs, the deployed bundle carries it,
and the same application code already authenticates with a publishable key on staging.

What is **not** proven: that a production user can complete a sign-in and reach a protected
route after this change.

This gap is inherent to the control, not an oversight in the test: R-014's failure mode
presents as an **authorisation redirect**, so an anonymous request and an
authentication-broken request are indistinguishable from outside. There is no unauthenticated
probe that can discriminate them — which is precisely why the original breakage went
unnoticed for three days.

Closing it requires a genuine session, i.e. one of: the operator signing in through the UI,
or an authorisation to mint a session via a temporary production test account (created and
deleted) as was done for the staging R-005/R-006 verification.

## 7. What this does not fix

- **R-009 remains open.** `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` are
  still scoped `all`, and `AIRDROP_WALLET_PRIVATE_KEY` / `BITXBIT_TOKEN_MINT` still hold
  identical values across contexts — so preview deploys still execute arbitrary branch code
  with the production treasury key and service-role key. This change re-points one
  client-side key; it does not isolate contexts.
- `is_secret` remains false on every variable (R-010 / NA-9).
