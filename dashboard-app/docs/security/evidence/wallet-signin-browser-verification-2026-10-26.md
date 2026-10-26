# Wallet SIWS sign-in — verified end-to-end in a real browser

**Date:** 2026-10-26
**Environment:** production — `app.bitxbit.com.au`, deploy `04321bb`
**Wallet:** Solflare (browser extension), wallet `E5qLqZMRcgKE61Tg4TssjYw5R291gHvmfkVLhWQ8PffQ`
**Account:** production user with the wallet linked and `wallet_verified = true`

## Why this document exists

R-007 has carried this sentence since 2026-10-24:

> "Application sign-in/PKCE cookie writing and wallet connect/sign/disconnect remain
> **unverified residuals** … Do not read this entry as 'fully verified'."

For the **wallet sign-in path**, that is no longer true. This records the measurement
that changed it — because a register that overstates its own risk is as wrong as one
that understates it, and the difference matters when someone decides what to rely on.

## What was exercised

A human, in a real browser, with a real wallet extension:

1. Signed out of the dashboard.
2. Clicked **"Sign in with your linked wallet"** on `/auth/login`.
3. Solflare opened; clicked **Approve**.
4. Signed the SIWS message.
5. **Landed authenticated on the dashboard.**

No injected cookies, no scripted session, no synthetic signature.

## Server-side confirmation

`public.security_audit_log`, production:

```
21:37:31  wallet.signed_in                          success   E5qLqZMRcg...
20:56:26  wallet.signed_in                          success   E5qLqZMRcg...
20:55:42  wallet.verified                           success
20:55:35  wallet.verification_challenge_created     success   E5qLqZMRcg...
```

- **Failed wallet rows in the hour containing this test: 0.**
- Audit trail contains only real events — `challenge_created`, `verified`, `signed_in`.
- **No `wallet.address_save` rows after 20:48:03Z**, the merge of PR #62 which removed the
  connect-time save that used to fabricate failures. Before that fix the same connect
  produced four such rows; it now produces none.
- Production state: 8 users / 3 with a wallet / 2 verified.

## What this does and does not prove

**Proven:** the full SIWS browser path works — challenge issuance, wallet connect,
`signMessage` through a real extension, Ed25519 verification, session minting on the
cookie-backed SSR client, and the redirect to an authenticated page. The failure
messages also behaved correctly during the session: an attempt *before* verification
recorded `wallet_not_verified`, and preview attempts against a database with no linked
account recorded `wallet_not_linked` — both specific, both only reachable after the
signature verified.

**NOT proven — still open residuals:**

- **Wallet disconnect.** Never exercised in a browser.
- **Wallet unlink/replace.** No such path exists; B3 was deliberately sign-in only.
- **Passwordless (magic-link/PKCE) sign-in cookie writing** in a real browser. The server
  adapter and legacy-cookie compatibility are tested; the browser flow is not.
- **Preview callback destination.** Corrected in `lib/auth-callback-url.ts`, not
  browser-exercised.
- **Wallet sign-in on a preview deployment** cannot be exercised with a real identity at
  all, because deploy previews point at the **staging** Supabase project while a real
  user's wallet is linked on production. Measured: three preview attempts all recorded
  `wallet_not_linked` with 0 matching users in staging. This is a configuration property,
  not a defect — but it means wallet changes cannot be verified before they deploy.

## Defects found on the way to this result

This verification was not a formality — five defects surfaced, none reachable by CI:

| defect | how found |
|---|---|
| wallet sign-in implied wallet-only sign-up | owner read the page |
| deploy/asset skew → blank page | owner loaded the site |
| skew → dead buttons (route chunk 404, no console error) | owner clicked on Safari |
| connect-time code fabricated `address_save` audit failures | owner succeeded; audit log read |
| CSP had no `frame-src`, so the Solflare connect iframe was blocked; service worker threw `Failed to convert value to 'Response'` | owner pasted the browser console |

The fifth is the one that made *this* document possible: before it, the flow died at the
iframe with `ERR_FAILED` and never reached signature verification.

## Residual risk

The wallet is linked to an account and can now authenticate it. Anyone holding that
wallet's key can sign in as that user — by design, and the reason `wallet_verified` is
required before the lookup resolves. There is no unlink path, so a compromised wallet
cannot currently be detached by the user; that remains the most substantive gap in this
feature area.

**M8 human review remains WAIVED under D5 — not satisfied.**
