# Password reset — implementation evidence (2026-10-27)

**Branch:** `security/password-reset`
**Base:** `main` @ `d63cc4309ecdedaa4a21470c724f3e648af98d81`
**Register:** R-015

## Problem

There was **no password-recovery route of any kind**. Present on `main`: `/auth/login` (password +
Google + GitHub), `/auth/signup`, `/auth/callback`. Absent: a `Forgot password?` affordance,
`/auth/forgot-password`, `/auth/reset-password`, and magic-link sign-in. A grep for
`forgot|reset-password|resetPasswordForEmail` across `app/` and `lib/` returned nothing.

Production (`flasgvendiiasuixeqzu`), measured 2026-10-27:

| Measure | Value |
|---|---|
| `auth.users` | 8 |
| identities by provider | `email` 7, `google` 1 |
| accounts with a password set | 7 |
| accounts with a wallet address | 3 |
| accounts with a **verified** wallet | 2 |
| ledger max | `028 wallet_signin` |
| `wallet_signin_challenges` present | yes |

Seven accounts sign in with a password and had **no** way to recover a forgotten one — a permanent
lockout with no support path.

## What was built

| File | Change |
|---|---|
| `lib/password-reset.ts` | Pure helpers: redirect builder, enumeration-safe outcome resolver, new-password validator |
| `lib/password-reset.test.ts` | 12 tests, incl. the enumeration guard and a mutation check |
| `app/auth/forgot-password/page.tsx` | Request page (client) — always shows the same message |
| `app/auth/reset-password/page.tsx` | Server Component: redirects to sign-in if there is no recovery session |
| `app/auth/reset-password/reset-password-form.tsx` | Set-new-password client form |
| `app/auth/login/page.tsx` | `Forgot password?` link; a legible message for `?error=reset_required` |
| `package.json` | New test inputs registered (the test script enumerates files explicitly) |
| `docs/security/risk-register.md` | R-015 detail + summary row |

### Design decisions and why

1. **Routed through the existing `/auth/callback`.** `redirectTo` is
   `<appUrl>/auth/callback?next=%2Fauth%2Freset-password`. The callback already exchanges the code
   for a session, reuses `safeAuthNextPath` (which rejects `//`, backslash and non-absolute values)
   and the deployment host policy (R-003). A separate recovery callback would be a second host
   allowlist that could drift. This also mirrors the shipped OAuth referral pattern
   (`/auth/callback?ref=…`).
2. **Client-side request.** `resetPasswordForEmail` runs through the browser client, as login and
   signup do, so the PKCE code verifier is stored where the user's browser can reach it when the
   link is clicked. A server-side call would keep the verifier server-side and the click would fail
   to exchange. (Same reason the magic-link flow is deferred as its own piece of work.)
3. **Enumeration safety by construction.** `resolveResetRequestOutcome` maps **any** non-rate-limit
   outcome — including an error whose text names the user — to one generic message. Only a
   rate-limit signal is distinguished, and its copy mentions no account state.
4. **Wallet is not a recovery credential.** The reset runs against the recovery-code session only;
   nothing lets a held wallet key change a password, so sign-in is not promoted to account takeover.
5. **`updateUser` acts on the current session**, so it can only change the signed-in user's own
   password.

## Gate — local (all on the branch, clean environment)

| Gate | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit 0** |
| `npm test` (staging vars unset) | **253 / 253 pass**, 0 fail (was 241; +12 new) |
| `npm run test:migration` | **exit 0** — first apply, constraint validation, second apply, and all four race/atomicity tests |
| `npm run build` (placeholder env only) | **exit 0** — `/auth/forgot-password` emitted static, `/auth/reset-password` dynamic |

The first test run had **1 failure** — a test bug, not a source defect: a rate-limit *code* was
passed as a message, and the detector matched on spaces only. Both were fixed: the detector now
normalises `_`→space and checks `code` and `message`, and the test asserts each spelling
explicitly.

## Mutation check (enumeration guard)

Reintroducing the leak — returning `error?.message` instead of the generic message — was applied to
`lib/password-reset.ts` and the compiled test re-run:

```
# tests 12
# pass 9
# fail 3
```

The guard is real: three assertions fail when the defect returns. The source was restored
afterward and confirmed free of the mutation.

## Probes — what was tried and what it proved

Question: does Supabase's redirect allowlist preserve `?next=` on the callback URL at click time?

A send-time probe against **staging** (`luqrwhgjtiyfmeawbtmp`, publishable key only, no secret
emitted) called `POST /auth/v1/recover` with `redirect_to` set to, in turn: the callback with a
query, the bare callback, a direct reset path, a **deliberately disallowed** host
(`evil.example.com`), `localhost:3000`, and a Netlify preview host. **Every request returned
HTTP 200 `{}`.**

**That proves nothing about the allowlist**, and it is recorded as a failed probe rather than a
pass: GoTrue does **not** validate `redirect_to` when sending, so the deliberately-bogus host
returned 200 too. The allowlist is only consulted when the emailed link is followed.

A useful side-effect, though: because the send never errors — for any address and any redirect —
the endpoint is trivially non-enumerating from the client's point of view.

## What is NOT verified

- **The recovery flow end-to-end in a browser.** Not done here: it needs a real account, a real
  mailbox, and a browser following the emailed link. This is the one open item on R-015 and it is
  exactly the class of defect (browser-facing integration) that CI, `tsc`, the tests and the build
  are blind to — the dominant defect class in this project. It should be closed by the real-browser
  CI smoke test (outstanding-work item 2).
- **Whether `?next=` survives the allowlist.** Unknown until the above is done. Mitigation in place:
  `/auth/reset-password` is reachable by any signed-in session, so a dropped `next` strands the user
  on `/dashboard` (already signed in, old password unchanged) rather than in a broken state; and the
  server-side guard sends a session-less visitor to
  `/auth/login?error=reset_required`, which now shows a legible message.
- **No application-level rate limiting** on the reset request. Supabase Auth's built-in email send
  limits are the only bound. Stated, not claimed.
- **Email deliverability/branding** of `supabase/templates/recovery.html` is a dashboard
  configuration and was not touched.

## Residual / follow-ups

- Magic-link sign-in (blueprint §9) remains unimplemented — a separate piece of work, deliberately
  not bundled here.
- R-011-adjacent: the duplicated CSP in `middleware.ts` and `netlify.toml` still lists
  `https://api.devnet.solana.com` in `connect-src` for **production**. Not touched by this branch.
