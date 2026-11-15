# Wallet sign-in notification — evidence (2026-11-03)

**Branch:** `security/wallet-signin-notification`
**Register:** R-021 (detection half) · **Threat model:** `../wallet-signin-threat-model.md`
**PR:** #83 · **Released:** merge `bc396d44fafd728e882a16b6c834f5d471fa0e9c`, production live 2026-11-15

The compensating control for the signature-relay risk. Prevention needs a step-up factor and is an owner
decision (R-021 stays open for that); **detection needs nothing from the member at sign-in time**, which is
what makes it worth shipping now.

## What it does

On a successful wallet sign-in, the account owner is emailed: what happened, which wallet, the time, the
source IP, and what to do if it was not them — reset the password, unlink the wallet, contact support. It
also states the one host where a bitXbit signing prompt is legitimate, which is the sentence that would
have defused the relay in the first place, delivered where the member will read it.

## Two properties treated as load-bearing

**1. It can never fail a sign-in.** The session is already minted when it runs; the send helper returns an
outcome rather than throwing; and the route block is wrapped anyway. A mail outage must not become an auth
outage.

**2. A non-send is never silent.** The outcome is written to `security_audit_log` as
`wallet.signin_notified` with a `reason`, so `not_configured` and provider failures are distinguishable
from "nothing happened". A notification that silently does not send would be a false sense of safety —
precisely the failure this whole risk is about.

## Gate — local

| Gate | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit 0** |
| `npm test` (clean env) | **313 / 313 pass**, 0 fail (was 294; +19) |
| `npm run build` (placeholder env only) | **exit 0** — `/api/auth/wallet/verify` emitted dynamic |

## Mutation control — 6 / 6 caught

| Mutation | Caught by |
|---|---|
| `notifyWalletSignIn` loses its try/catch | *a malformed input is caught and reported, never thrown* |
| the route block loses its try/catch | *the notification block is guarded so it cannot fail the sign-in* |
| the notification outcome gates the sign-in response | *…guarded so it cannot fail the sign-in* (+ two cache-safety tests) |
| the HTML part stops escaping | *a hostile value cannot inject markup into the HTML part* |
| the alert drops the only-host sentence | *the alert states the ONLY host a prompt is legitimate on* |
| a missing key still fires an unauthenticated request | *with NO api key, no request is made at all* |

**The first mutation was NOT caught on the first run, and that is the most useful line in this document.**
Deleting the guard in `notifyWalletSignIn` changed nothing, because every path the tests exercised goes
through a sender that already never throws. The guard is load-bearing only for the **builder**, which does
throw on malformed input (escaping an absent wallet address is a `TypeError`) — a path no test covered. A
test was added for it, the mutation was re-run, and it is now caught. An untested guard is
indistinguishable from a working one until something removes it.

## Deployed verification — deploy-preview-83, 2026-11-03

Run against this PR's preview, where **no key is configured** — the state production is in today.

1. **The wallet sign-in harness still passes 26 / 26.** Authentication is unaffected by the mailer: the
   fail-soft path holds in a deployment, not only in a unit test.
2. **The inert control is visible in the audit trail**, which is the property that keeps this from being a
   false sense of safety. Read back from `security_audit_log` (staging):

```
action                  success  reason            created_at
wallet.signed_in        true     —                 2026-11-03 10:56:15.122
wallet.signin_notified  false    not_configured    2026-11-03 10:56:15.701
wallet.signed_in        true     —                 2026-11-03 10:56:08.619
wallet.signin_notified  false    not_configured    2026-11-03 10:56:09.249
```

The pairs are the point: every sign-in is followed by a notification row that names **why** it was not
sent. Rows from the earlier harness run (10:33) have **no** `signin_notified` partner, because that
deployment predates this change — so the two states are distinguishable in the log, not just in theory.

Once `RESEND_API_KEY` is set, `success` flips to `true` and `reason` to `sent`; a provider failure lands as
`failed` with the provider's status. All three are queryable.

## Production verification — 2026-11-15

Released, then measured against the real thing. This was the **first wallet sign-in production has ever
recorded**, which is what makes the row unambiguous:

```
action                  success  reason            method           created_at
wallet.signed_in        true     —                 solana_wallet    2026-11-15 06:17:05.140
wallet.signin_notified  true     sent              —                2026-11-15 06:17:05.415
```

`sent` means the provider **accepted** the message (2xx). It landed **275 ms after the session was minted** —
the sign-in was already complete, so the alert cannot have gated it, which is the load-bearing property
proven in production rather than only in a unit test. `not_configured` is gone: the key reached the function
on the deploy that carried the code.

Visible four minutes earlier, and worth reading correctly: `wallet.signin_failed · wallet_not_linked`. A
**failed** sign-in sends no alert, and that is right — no session existed, so there is nothing to warn the
member about. Noticing repeated failures is a different control (rate limiting or lockout), not this one.

## Closed 2026-11-15 — owner confirmed receipt

The `sent` row shows the provider **accepted** the message; it does not show it arrived. The account owner has
now confirmed the alert reached the inbox, so the loop is closed end to end and R-021's detection half has no
unverified step left.

As with the recovery email for R-015, that is the **owner's self-report** rather than something we measured,
and it is recorded as such so it is not mistaken for an independent check.

## What is NOT verified

- The alert reports the trusted client IP as the source. It does not attempt geolocation, and a relayed
  sign-in will report the *attacker's* IP — which is the point, but means the alert is only as useful as
  the member's willingness to read it.
- Sign-in **latency** grows by up to the send timeout (2.5 s) when the provider is slow. Chosen
  deliberately: in a serverless function a floating promise may never run, and an alert that silently does
  not send is worse than a few hundred milliseconds.

## Configuration — done 2026-11-15, with one follow-up

`RESEND_API_KEY` is set on the dashboard site with scopes `builds, functions, runtime` — `functions` is the
one that matters, because the alert runs in a serverless function. Read back through the Netlify API; secret
values come back **masked**, so that read confirms presence and scope, and the `sent` row above is what
confirms the key itself.

**Follow-up:** it is currently enabled for **deploy previews and branch deploys** as well as production.
Those are staging-backed, and the sign-in harness uses `…@staging-verify.bitxbit` — a domain that cannot
receive mail — so harness runs there would **bounce against the very domain that carries password resets**.
Narrowing it to Production only is recommended. It is a platform-side edit, no code, and it applies on the
next deploy.
