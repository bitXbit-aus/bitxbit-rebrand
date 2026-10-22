# R-014 — retired legacy anon key broke staging auth (2026-10-22)

**Found while** attempting the deployed R-005/R-006 verification, which required an
authenticated session on a preview deploy.
**Severity:** HIGH (availability). **Status:** staging fixed; production still exposed.

---

## 1. The finding

Authentication was **broken on every preview deploy** — and had been for three days.

Requesting any protected route returned a redirect to login:

```
GET /admin/rewards         -> HTTP/2 307   location: /auth/login
GET /admin/rewards (no cookie) -> HTTP/2 307   location: /auth/login
```

An authenticated request and an anonymous one were indistinguishable, which is what made
this silent: there was no error, no 500, no degraded state — just a login redirect.

### Root cause

The preview deployment's embedded anon key is a **legacy JWT that Supabase has disabled**:

```json
{"hint":"Your legacy API keys (anon, service_role) were disabled on
 2026-10-19T06:18:33.786739+00:00. Re-enable them in the Supabase dashboard,
 or use the new publishable ..."}
```

Confirmed from both sides:

| Check | Result |
|---|---|
| Supabase API, staging project `luqrwhgjtiyfmeawbtmp` | legacy `anon` key → **`"disabled": true`** |
| Preview client bundle | contains that same key (legacy JWT, `role=anon`, `ref=luqrwhgjtiyfmeawbtmp`, 208 chars) |
| Staging `/auth/v1/settings` with that key | rejected, `disabled on 2026-10-19T06:18:33` |
| Production `/auth/v1/settings` with production's key | **accepted** — production is unaffected |

### Mechanism

`supabase.auth.getUser()` in `middleware.ts` fails when the anon key is rejected, so
`data.user` is null. The route guard then redirects:

```ts
if (!user && (isAdminRoute || isDashboardRoute)) {
  return NextResponse.redirect(new URL("/auth/login", request.url));
}
```

So the failure presents as an authorisation redirect, not as an authentication error —
the least diagnosable possible symptom.

## 2. Why nothing caught it

**D4's deployed test does not exercise an authenticated path.** It asserts three *public*
endpoints return HTTP 200 — `/api/public/offers`, `/api/public/transparency`,
`/api/token-stats` — and those use the **service-role** key server-side. They pass
regardless of the anon key.

So the 2026-10-22 D4 verification was correct in what it claimed (34/34 previews
staging-scoped) and still missed this entirely. That is a **blind spot in the D4 harness**,
not an error in its result.

The staging smoke test (`npm run test:staging`) also missed it: it drives Supabase directly
with the service-role key, never through the app's own authentication.

## 3. Ruling out the alternative explanations

Before concluding the key was at fault, the following were eliminated:

| Hypothesis | Test | Result |
|---|---|---|
| Wrong cookie name | read the derivation from the installed client: `sb-${baseUrl.hostname.split('.')[0]}-auth-token` | matches the preview's bundle URL — **correct** |
| Wrong cookie format | reproduced the middleware's cookie adapter exactly in Node (`@supabase/ssr` `createServerClient` + the `cookie` package) and called `getUser()` | **`user=verify-r005r006-…` — the cookie format is correct and authenticates** |
| The session itself invalid | `GET /auth/v1/user` with the access token | **200, correct user** |
| Cookie too large for transport | 2140-char session JSON → 2738 encoded, 2773-byte header (limit ~4096) | not the cause |
| Preview pointing at the wrong project | scanned the bundle for Supabase URLs | `https://luqrwhgjtiyfmeawbtmp.supabase.co` — **correct (staging)** |

The cookie, session, name, format and project were all correct. The only failing component
was the **anon key the deployment ships**.

## 4. Remediation applied (staging)

```
NEXT_PUBLIC_SUPABASE_ANON_KEY
  deploy-preview  : <legacy anon, disabled>  ->  sb_publishable_CbgASUIR3MTwfSIohir2Kg_CYEGGi6o
  branch-deploy   : <legacy anon, disabled>  ->  sb_publishable_CbgASUIR3MTwfSIohir2Kg_CYEGGi6o
  production      : UNCHANGED
```

Verified by sha256 per context, before and after — values never printed:

| Context | before | after |
|---|---|---|
| `production` | `52bad0d3306368c4` | `52bad0d3306368c4` ← **unchanged** |
| `deploy-preview` | `d16dea84868b978a` | `05709071c2150bb6` |
| `branch-deploy` | `d16dea84868b978a` | `05709071c2150bb6` |

The publishable key was confirmed working before the change was applied:

- `/auth/v1/settings` → 200
- `/auth/v1/user` with a session token → returns the user
- `/auth/v1/admin/generate_link` → `401 no_authorization` (correctly refused — it is not a
  privileged key)

Environment variables resolve at deploy time, so this takes effect on the **next preview
build**, not on existing deploys.

## 5. Production — not remediated

Production still runs a legacy anon key. It works today, but Supabase has demonstrated on
this very account that it will disable legacy keys. If the same happens to production,
**every user is signed out and no one can log in** — a total authentication outage with no
degraded state.

The migration is a single environment-variable change plus a redeploy, and the value is
client-visible so the risk is low. It is nonetheless a production release and is left as an
explicit owner decision.

## 6. Limitations

- **The staging fix is applied but not yet observed working.** It requires a preview
  rebuild; the redeploy is what this document's follow-up verification will exercise.
- **No production resource was touched.** Every probe went to preview deploys, the staging
  Supabase project, or the Netlify env API for the two non-production contexts.
- The publishable key is a **public** value (it ships in the client bundle); it is recorded
  here in the clear for that reason. No secret value appears in this document.
- This document does not establish whether Supabase's retirement of the staging key was
  deliberate hardening by the owner or an automatic deprecation; only that the key is
  disabled and the deployment was never updated to match.
