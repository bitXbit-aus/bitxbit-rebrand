# R-007 — authenticated authorisation matrix and session-refresh verification (2026-10-24)

**Closes the "authenticated half" of M7 §5.3** — the last technical blocker on the Next.js 15
migration. Everything below was measured on a **deployed preview**, not locally.

**Gate:** `dashboard-app/scripts/authz-matrix-verify.py` — re-runnable, exit 0 only if all 12 checks
pass. Re-run twice on 2026-10-24 (second run after a type-only edit), **12/12 both times**.

---

## Why this needed measuring

A middleware regression **cannot fail a build**, and the cookie adapter is the migration's
highest-risk change. `@supabase/ssr`'s own documentation states the failure mode plainly: if the
cookie methods are not provided correctly, the library *"will result in difficult to debug
authentication issues such as random logouts, early session termination or problems with
inconsistent state."* The library additionally warns that a chunked cookie which decodes to invalid
JSON — *"a partial cookie write left the browser holding a mix of old and new generations"* — is
**treated as absent**, i.e. a silent logout. None of that is visible to `tsc`, tests, or a build.

## Method

Target: preview **`deploy-preview-49`** (`https://deploy-preview-49--bitxbit-dashboard.netlify.app`),
built from the migration head, **staging-scoped (D4)**.

1. **Ephemeral staging test user** created through the Supabase admin API. The `handle_new_user()`
   trigger provisioned the `users` row and an `active`/`member` `user_authorizations` row.
2. **Session minted without handling any password or one-time code**: admin `generate_link`
   (`magiclink`) → the action link is followed with redirects suppressed → the session is taken from
   the redirect fragment.
3. **Cookie built with the app's own encoder** — `createChunks` + `stringToBase64URL` from the
   installed `@supabase/ssr@0.12.7` — so the probe cannot drift from the format the app writes.
   (One chunk, `sb-luqrw…-auth-token`, 2651 B — under the 4096 B limit, so no fragmentation.)
4. Requests issued against the deployed preview with only that cookie.

**Why a minted session rather than a browser sign-in:** deploy previews are staging-scoped, so no
production account exists to sign in with; and minting avoids handling a password or an OTP at all.
**Not covered by this method, stated plainly:** the *browser* client's own cookie writing. That path
was checked by reading it instead — `lib/supabase/client.ts` passes no `cookies` option, and
`createBrowserClient` manages cookies internally via `createStorageFromOptions`, so the
`get/set/remove` → `getAll/setAll` interface change does not touch it. The app's browser client needed
no change, and none was made.

## Results — 12/12

`user_authorizations` was mutated between phases; the same session was reused, since the middleware
re-reads authorisation on every request.

| Phase | Request | Expected | Observed |
|---|---|---|---|
| — | no cookie → `/dashboard` | 307 → `/auth/login` | ✅ 307 → `/auth/login` *(negative control)* |
| active member | session → `/dashboard` | 200 | ✅ 200 |
| active member | session → `/admin` | 307 → `/dashboard` | ✅ 307 → `/dashboard` |
| active member | session → `/auth/login` | 307 → `/dashboard` | ✅ 307 → `/dashboard` |
| **suspended** | session → `/dashboard` | 307 → `error=account_inactive` | ✅ 307 → `/auth/login?error=account_inactive` |
| **suspended** | session → `/auth/login` | 200 (not bounced) | ✅ 200 |
| **deactivated** | session → `/dashboard` | 307 → `error=account_inactive` | ✅ 307 → `/auth/login?error=account_inactive` |
| **admin** | session → `/admin` | 200 | ✅ 200 |
| refresh | expired-access session → `/dashboard` | 200 | ✅ 200 |
| refresh | response carries a refreshed cookie | `Set-Cookie` present | ✅ 1 × `sb-luqrw…-auth-token` |
| refresh | refreshed cookie → `/dashboard` again | 200 | ✅ 200 |
| refresh | refreshed value actually differs | changed | ✅ hash differs |

## The `setAll` proof in detail

The session cookie was rebuilt with `expires_at` **600 s in the past** while keeping the genuine
refresh token — precisely the state a returning user is in. Sent to `/dashboard`:

- the route still returned **200** (the session was refreshed, not dropped);
- the response carried **`Set-Cookie: sb-luqrw…-auth-token`** — so `setAll` **wrote the refreshed
  session onto the response**, which is the thing that silently fails;
- replaying that returned cookie produced **200** on a second request, so the refreshed cookie is
  genuinely usable — **no session loss**;
- decoding the two cookies confirms a real refresh, not a re-write:

| | access token | refresh token | `expires_at` |
|---|---|---|---|
| before | `ebf432d9…` | `abb5c0a4…` | +3560 s |
| after | `0f91eed8…` | `52ad0021…` | +3589 s |

Access token **changed**, refresh token **rotated**, expiry in the future, same user.

## Cleanup — verified, not assumed

Test user deleted across all three surfaces and the deletion confirmed by re-reading:
`user_authorizations` → 0 rows, `users` → 0 rows, auth user → 404. All session material (session JSON,
cookie sets) shredded with 4-pass random overwrite and removed. The gate script performs this teardown
itself and reports `teardown: user_authorizations rows=0 -> clean`.

## What this does and does not close

- **Closes:** the authenticated half of §5.3 (session persistence and the full role/status matrix).
  Combined with the automated gate, the D4 staging regression and the devnet fault suite, **every
  technical verification in the migration plan is now done**.
- **Does not close:** **M8, independent review.** The register's division of authority is explicit that
  the implementing agent cannot supply it, and that is now the *only* blocker on PR #49.
- **Scope note:** production was not touched by any of this. The verification is on a staging-scoped
  preview — which is what the plan specifies — using the same code that would ship.
