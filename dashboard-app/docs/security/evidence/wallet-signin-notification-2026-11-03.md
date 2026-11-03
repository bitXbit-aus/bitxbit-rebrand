# Wallet sign-in notification — evidence (2026-11-03)

**Branch:** `security/wallet-signin-notification`
**Register:** R-021 (detection half) · **Threat model:** `../wallet-signin-threat-model.md`
**PR:** #83

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

## What is NOT verified

- **No email has been sent end to end**, because no key exists to send with. The payload, escaping,
  fail-soft behaviour and wiring are tested; **delivery is not**. Confirming a received alert is an owner
  step, exactly as the recovery email was for R-015.
- The alert reports the trusted client IP as the source. It does not attempt geolocation, and a relayed
  sign-in will report the *attacker's* IP — which is the point, but means the alert is only as useful as
  the member's willingness to read it.
- Sign-in **latency** grows by up to the send timeout (2.5 s) when the provider is slow. Chosen
  deliberately: in a serverless function a floating promise may never run, and an alert that silently does
  not send is worse than a few hundred milliseconds.

## Owner action

Set `RESEND_API_KEY` on the dashboard site in **production, preview and branch-deploy** contexts, then
confirm one real alert arrives. Until then the control is inert by design and says so in the audit log.
