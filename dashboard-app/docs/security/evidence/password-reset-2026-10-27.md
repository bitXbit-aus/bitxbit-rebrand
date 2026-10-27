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

## Browser verification — deploy preview 68 (staging database)

Driven in a real Chromium against `https://deploy-preview-68--bitxbit-dashboard.netlify.app`
(head `0e354f8a`, Netlify deploy-preview-68 `success`), which resolves to the **staging** Supabase
project.

| Check | Result |
|---|---|
| `/auth/login` renders; `Forgot password?` → `/auth/forgot-password` | ✅ link present, correct `href` |
| `/auth/forgot-password` renders (email field, "Send reset link") | ✅ |
| Submit an **unknown** address | ✅ generic message in a `role=status` / `aria-live=polite` panel: "If an account exists for that email address, a password reset link is on its way…" — **no "user not found"**, no error text |
| `/auth/reset-password` with **no session** | ✅ → `/auth/login?error=reset_required`, login page shows "That password reset link has expired or was already used…" |
| `/auth/callback?next=…` with **no code** | ✅ → `/auth/login?error=callback`, no Next error shell |
| Signed in, `/auth/reset-password` | ✅ renders "Set a new password" with the account email; not bounced to the dashboard mid-flow |
| Submit a new password | ✅ `updateUser` succeeded, redirected to `/dashboard` |
| Did the password actually change? | ✅ measured by password grant — **old password REJECTED**, **new password ACCEPTED** (`session=true`) |

Teardown: the throwaway staging user was deleted; `auth.users` back to **20**; **0** orphan rows in
`public.users`; no fixture residue. The one-time recovery token file was mode-0600 in scratch and
has been shredded.

## The `?next=` allowlist question — answered, and a real finding

The first probe (send-time `POST /auth/v1/recover`) returned HTTP 200 for **every** `redirect_to`,
including a deliberately bogus host. That proved nothing and is retained as a **failed probe**:
GoTrue does not validate `redirect_to` when sending; the allowlist is consulted when the link is
*followed*. Useful side-effect: the send never errors for any address, so the endpoint is trivially
non-enumerating from the client's side.

The real answer came from `admin.generateLink`, which sends no email and embeds the effective
`redirect_to` in the returned link. Measured on staging:

| Requested `redirect_to` | Embedded in link | Verdict |
|---|---|---|
| `https://deploy-preview-68--bitxbit-dashboard.netlify.app/auth/callback` | `http://localhost:3000` | **substituted** |
| `…netlify.app/auth/callback?next=%2Fauth%2Freset-password` | `http://localhost:3000` | **substituted** |
| `http://localhost:3000/auth/callback` | `http://localhost:3000/auth/callback` | honoured |
| `http://localhost:3000/auth/callback?next=%2Fauth%2Freset-password` | same | **honoured** |

Two conclusions, pointing away from the initial worry:

1. **The `?next=` mechanism is sound** — a query string is preserved when the origin is allowlisted
   (row 4). The design does not need to change.
2. **Staging's redirect allowlist does not contain deploy-preview hosts** — only its SiteURL
   (`http://localhost:3000`). A reset requested *from a preview* has its `redirect_to` silently
   replaced, so the emailed link lands on `localhost:3000`. Previews therefore **cannot exercise the
   emailed-link hop** — the same missing-allowlist root cause that blocks wallet flows on staging.

### Production — confirmed 2026-10-27

The production allowlist was reported as exactly `https://app.bitxbit.com.au/auth/callback`. GoTrue
validates `redirect_to` at **verify** time, so this was measured on production with no user created
and no email sent — probing `/auth/v1/verify` with a deliberately invalid token and comparing where
it redirects:

| `redirect_to` probed | Production redirect |
|---|---|
| `…/auth/callback?next=%2Fauth%2Freset-password` (ours) | 303 → **that exact URL, query preserved** |
| `…/auth/callback` | 303 → preserved |
| `…/auth/reset-password` (not in the declared list) | 303 → **also preserved** |
| `https://evil.example.com/auth/callback` | 303 → **substituted** to `https://app.bitxbit.com.au` |

**Conclusion: the recovery link works on production** — the `?next=` survives. The effective rule is
site-host matching, not exact-path matching: any path on `app.bitxbit.com.au` is accepted, which is
why the undeclared `/auth/reset-password` also passed. Foreign hosts are still substituted, so this
is not an open redirect. The declared allowlist entry under-describes the real rule; no code change
is needed.

**Owner action remaining (staging only):** add the preview wildcard
(`https://*--bitxbit-dashboard.netlify.app/**`) to **staging** so previews can exercise the emailed
link. Production needs nothing.

## What is NOT verified

- **The emailed-link hop on a production-allowlisted host with a real mailbox.** Everything *around*
  it is verified above; the remaining segment — GoTrue verifying the token and redirecting with
  `?code=` — is Supabase's, and it lands on the same `exchangeCodeForSession` path OAuth already
  uses. The composition is sound, but the end-to-end click was not performed: no mailbox is
  available, and the preview host is not allowlisted (above). The real-browser CI smoke test
  (outstanding-work item 2) should own this.
- **Production's redirect behaviour** — now measured (above): `?next=` is preserved on the site host.
- **No application-level rate limiting** on the reset request; Supabase Auth's built-in email send
  limits are the only bound. Stated, not claimed.
- **Email deliverability/branding** of `supabase/templates/recovery.html` is dashboard configuration
  and was not touched.

## Residual / follow-ups

- Magic-link sign-in (blueprint §9) remains unimplemented — a separate piece of work, deliberately
  not bundled here.
- R-011-adjacent: the duplicated CSP in `middleware.ts` and `netlify.toml` still lists
  `https://api.devnet.solana.com` in `connect-src` for **production**. Not touched by this branch.
