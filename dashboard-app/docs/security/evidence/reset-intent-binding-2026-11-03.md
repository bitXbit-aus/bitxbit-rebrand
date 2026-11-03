# Recovery-intent binding — evidence (2026-11-03)

**Branch:** `security/reset-intent-binding`
**Head verified:** `11b58b71143f3b8428ed6a366968f7ec32a2fdcf`
**Base:** `main` @ `6fe3ad69208b516c13a8746af492ebcb1a7bf8ea`
**Deploy preview:** `https://deploy-preview-80--bitxbit-dashboard.netlify.app` (staging-backed)
**Register:** R-020 · **PR:** #80

Closes the independent review's finding *"password recovery may be accessible through an ordinary wallet
session"*, which was raised as *verify and harden*. It was reproduced before any code changed.

## The defect

`/auth/reset-password` checked only that **a session existed**; the form then called
`supabase.auth.updateUser({ password })` from the browser. Wallet sign-in
(`app/api/auth/wallet/verify`) mints its session through the project's passwordless plumbing —
`admin.generateLink({ type: "magiclink" })` then `verifyOtp({ token_hash })` — so a wallet session is an
ordinary session, and the page accepted it.

## Measurement 1 — the provider, staging, 2026-11-03

One fresh throwaway user **per case** (cases must not contaminate each other: the first version of the
probe changed the password in case A, so case B's sign-in failed and looked like a refusal). Every change
is confirmed by a **password grant**, never by trusting a 200.

| Session class | `amr` | `PUT /auth/v1/user`, no `current_password`, no nonce | Old password after |
|---|---|---|---|
| **wallet-class** (`magiclink`) | `[{"method":"otp"}]` | **200 — password changed** | rejected |
| ordinary password sign-in | `[{"method":"password"}]` | 200 — password changed | rejected |
| genuine recovery | `[{"method":"otp"}]` | 200 — password changed | rejected |

**The wallet session and a genuine recovery session are the same class** (`otp`). That is the finding, and
it also dictates the fix: a guard keyed on `amr.method === "recovery"` would refuse the legitimate flow
too.

Two failed probes are retained rather than dropped:

- The first run reported `weak_password` for **all three** cases, which read as "the provider blocks
  everything". It was a bug in the probe, not a control: `local tok newp name="$3"` declared `newp` without
  assigning it, so every request carried an empty password. A plausible security result produced by the
  measuring instrument is the most dangerous kind — it would have closed this finding as *not exploitable*.
- Passwords containing `$` broke the shell when injected; replaced with values that carry no shell
  metacharacters.

## Measurement 2 — the two environments disagree

| setting | production `flasgvendiiasuixeqzu` | staging `luqrwhgjtiyfmeawbtmp` |
|---|---|---|
| `security_update_password_require_current_password` | **true** | false |
| `security_update_password_require_reauthentication` | **true** | false |

Production has both protections ON and **neither closes this path**: the current-password check is skipped
when `session.IsRecovery()` is true (which covers `otp`, `magiclink` and `recovery` sessions — the class the
wallet flow mints), and reauthentication only asks for a nonce when the session is older than 24 hours.

**Provenance:** the app-level gap, the session classes and both configs were measured here. The two
exemption rules are **documented** (GoTrue `internal/api/user.go` / `factor.go`, as independently tested and
reported), **not measured by this work** — the connector can set `require_reauthentication` but not
`require_current_password`, and no Supabase PAT is available on this machine. Stated as the working
explanation, not as a measured fact.

Staging is the **more permissive** environment, so it could not have detected this class at all. That is
why the guard moved into the application.

## Measurement 3 — deployed browser verification (deploy-preview-80)

### Negative — a session without the marker is refused

A real Chromium, signed in with a **password** on the preview, then requesting the reset page. Measured on
the raw response with the session cookie, so the layer that refuses is unambiguous — middleware is a
pass-through for this path (it acts only on `/admin`, `/dashboard`, `/auth/login`, `/auth/signup`):

```
GET /auth/reset-password   (valid session, no marker)
  HTTP/2 307
  cache-control: private,no-cache,no-store,max-age=0,must-revalidate
  location: /auth/login?error=reset_required

GET /dashboard             (same session — control)
  HTTP/2 200
```

The control matters: it proves the session is genuinely valid, so the refusal is the **marker check**, not
a broken session. In the browser the form was not served — `Set a new password` absent — and the request
ended on `/dashboard`, which is middleware forwarding a signed-in active user away from `/auth/login`.

### Positive — a correctly-signed marker still reaches the form and works

| Step | Result |
|---|---|
| marker present (httpOnly, path-scoped to `/auth/reset-password`) | form renders, `Set a new password` present, account email shown |
| submit through the Server Action | redirected to `/dashboard` |
| **did the password actually change?** | **old password REJECTED (`invalid_credentials`), new password ACCEPTED** |

### What this browser test did NOT do — stated plainly

The marker in the positive test was **minted by the harness** using the same construction and the same key
resolution the server uses, because the emailed-link hop cannot be completed here. It was measured, not
assumed: `admin.generateLink({ type: "recovery" })` returns a link whose verify redirect uses the
**implicit** flow (`#access_token=…`), not a `?code=`, and the application's callback exchanges a PKCE
`code`. A server-generated link therefore cannot drive this app's callback, and a genuine one needs the
mailbox.

So this run proves the **wiring and the decision** — a valid marker is accepted, an absent one is refused,
and the change completes end-to-end in a browser — while the **emailed hop itself remains unperformed**
here, as it was for the original reset work. It is owner-confirmed for the previous revision of this flow
and must be re-confirmed by the owner for this one before R-020 is treated as verified in production.

## Gate — local, on the head SHA

| Gate | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit 0** |
| `npm test` (staging vars unset) | **294 / 294 pass**, 0 fail (was 274; +20) |
| `npm run build` (placeholder env only) | **exit 0** — `/auth/callback` and `/auth/reset-password` both dynamic |
| `npm run test:migration` | **exit 0** |
| CI on the exact head | `Tests, migration replay, and build` **success**, `Production is serving main` **success**, browser smoke **success** |

### Mutation control — 5 / 5 caught, each by its own assertion

| Mutation | Caught by |
|---|---|
| `userId` dropped from the signed payload | *a marker minted for one user is REFUSED for another* |
| a client-side `updateUser` restored in the form | *the client form does NOT change the password itself* |
| guard neutered with `false &&` (still reads as enforced) | *the Server Action verifies the marker BEFORE it changes the password* |
| marker deleted without its path (a silent no-op) | *the marker is spent after use, deleted with the path it was written with* |
| marker issued for every path, not just the reset path | *the callback sets the marker ONLY for the reset path* |

The `false &&` mutation is the reason one assertion is written the way it is: asserting only that the
verification call is *present* passes for a neutered guard.

Two things the build caught, worth recording:

- **A `"use server"` module may export only async functions.** Exporting the refusal constant and the state
  type from the action failed the build; both moved into `lib/password-reset.ts`.
- **A word-shaped assertion is not a behavioural one.** The first version of the guard test matched
  `updateUser` anywhere in the form — including the comment that explains the history. It now matches the
  **call**.

## Teardown

Staging `auth.users` back to **20**, **0** probe leftovers. The cookie header captured for the raw-response
measurement was mode-0600 and has been deleted; the throwaway user was deleted; probe scripts print no
secret values.

## Owner confirmation — the emailed hop, 2026-11-03

Merged as PR #80 → `main` `c33f76f`, with production deploy `ready` for that commit and
`GET https://app.bitxbit.com.au/api/version` reporting it. The R-019 control observed the transition
itself (it read `6fe3ad6`, waited through the build, then *"Production is serving c33f76f — the merge
shipped"*).

**The owner then completed a real password recovery against a live account on the released revision** —
requesting the reset, following the emailed link, setting a new password, and signing in with it. This is
the one segment no gate here can reach, and it had to be re-confirmed rather than inherited, because this
release changed the shape of the flow: the password change now runs in a Server Action. The identifier is
deliberately not reproduced in this record.

With that, R-020 is **closed**. **M8 independent human review is waived under D5 — waived, not satisfied.**

## Not verified / residual

- **The provider-side exemption is documented, not measured** (Measurement 2) — a limitation of this
  analysis, not an open exposure, since the fix no longer depends on that setting.
- **The structural test cannot prove runtime enforcement.** The deployed browser run above is the
  behavioural proof; the structural test guards against regression in the wiring.
- **Wallet signature-relay phishing** (the same review's second finding) is deliberately not addressed in
  this change; it is a documentation/threat-model item for its own PR.
