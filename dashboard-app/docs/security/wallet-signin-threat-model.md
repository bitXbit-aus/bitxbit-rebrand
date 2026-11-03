# Wallet sign-in — signature-relay threat model (2026-11-03)

**Register:** R-021 · **Status:** accepted and documented; mitigation proposed, not yet built
**Scope:** `/api/auth/wallet/challenge` → `/api/auth/wallet/verify` (Phase 2 B3, link-only wallet sign-in)

Raised by independent review as *"wallet sign-in has a signature-relay phishing risk"*, recommended as a
threat-model review. The review's framing is accurate and is adopted here. This document records the
measurement, the mitigation analysis, and the decision that is still open.

## The flow

1. The browser POSTs a wallet address to `/api/auth/wallet/challenge`. The endpoint is **public by design**
   — it must answer for an unregistered wallet without becoming an enumeration oracle — and returns a
   nonce plus the exact message the wallet will be asked to sign.
2. The message is stored server-side, with a 300-second TTL.
3. The user's wallet signs it; the browser POSTs `{walletAddress, signature, nonce}` to
   `/api/auth/wallet/verify`.
4. The server recovers the message **from the database** (never from the caller), verifies the Ed25519
   signature against it, atomically consumes the challenge, and — only if the account's wallet is
   `wallet_verified` — mints a Supabase session.

## The attack

Requires victim interaction. It is a phishing relay, not a signature forgery.

1. The attacker requests a challenge for the **victim's** wallet address from the public endpoint. They are
   handed a genuine nonce and the exact message we stored. No account, no authentication, no prior
   relationship is needed.
2. The attacker displays that message to the victim on a site they control, framed as a verification the
   victim needs to complete.
3. The victim signs it. The signature is genuine — over the exact bytes we minted.
4. The attacker submits it to `/api/auth/wallet/verify` and is handed a session for the victim's account.

A legitimate nonce proves only that **somebody asked us for one**. It does not prove which site displayed
the signing prompt, and the server has nothing else to go on.

## What was measured (2026-11-03, deploy-preview-80)

`scripts/wallet-signin-verify.ts` drives the real HTTP surface with real keypairs. The relay is asserted
there as an explicit, named property rather than left implicit:

| Measure | Result |
|---|---|
| `Set-Cookie` headers on the challenge response | **0** — nothing binds a challenge to the client that requested it |
| A challenge requested with no browser context, completed by a different one | **HTTP 200, `ok: true`** |
| The minted session against a protected page | **`GET /dashboard` → 200** |
| Challenge TTL / rate limits | 300 s · 10 requests per minute per client identifier (challenge and verify) |

The exact message a wallet displays (challenge-only probe, no account required):

```
bitXbit wallet verification

Site:    https://app.bitxbit.com.au
Wallet:  86Wo1UkZ…
Nonce:   7482427d-…
Issued:  2026-11-03T10:27:08.414Z
Expires: 2026-11-03T10:32:08.414Z
Purpose: Sign in to your bitxbit account with your Solana wallet

Signing this proves you control this wallet. It is not a transaction:
nothing is sent on-chain and no fee is charged.
```

## Why the obvious fix does not work

The natural instinct is to bind the challenge to the browser that requested it — a cookie or token issued
at step 1 and required at step 4. **It does not close the relay, and shipping it would be worse than
shipping nothing**, because it would replace an honest gap with a false claim of safety.

The reason is structural: **any value issued in the challenge response is readable by whoever requested the
challenge**, and the attacker is free to request it. A cookie is a bearer token; a hostile client captures
`Set-Cookie` from its own request and replays it. Binding to the nonce fails the same way — the attacker
holds the nonce, because we handed it over. The only thing that would defeat this is a secret the attacker
cannot obtain *while also* obtaining a signature from the victim, and no such secret exists at challenge
time: pre-authentication there is nothing to bind to.

The same argument rules out an `Origin` check as a standalone control: it stops a browser-based cross-site
submission, but `Origin` is caller-controlled for a server-side request, which is all the attacker needs.

**Therefore the mitigation cannot live in the challenge/verify handshake.** It has to be either an
independent factor, or detection.

## What is already mitigated, and why it does not help here

These properties are real and are why the rest of the surface is sound — but none of them addresses a
genuine signature:

| Property | Mechanism | Why it does not stop the relay |
|---|---|---|
| Replay | single-use nonce, consumed atomically in Postgres | the relayed signature is used **once**, legitimately |
| Freshness | 300 s TTL, server-checked | the relay completes in seconds |
| Integrity | Ed25519 over the **stored** bytes | the victim really did sign them |
| No enumeration | identical failures without a valid signature | orthogonal |
| Ownership | account resolved only when `wallet_verified` | the victim's account **is** verified |
| Password change | wallet session cannot set a password (R-020) | limits blast radius; does not prevent sign-in |

## Residual risk — accepted, stated plainly

A member who is persuaded to sign a bitXbit challenge on a site that is not bitXbit can have their account
signed into by the attacker. The attacker gains whatever the account can do in a session: read member data,
and perform any action the account is authorised for. It requires the victim to interact, and it is not
prevented by anything in the current flow.

## Mitigations — options, cost, and the decision

### 1. Step-up verification for an unrecognised device (the review's recommendation) — **recommended**

Sign-in completes immediately only on a device that has signed in before; an unrecognised device must pass
one additional check before a session is minted. The attacker relaying a signature is on a device the
account has never seen, so they hit the extra step — and it is a factor they do not have.

Design sketch (reuses the signed-cookie pattern already shipped for R-020):

- on a successful wallet sign-in, set a long-lived `httpOnly`, HMAC-signed device cookie;
- if a sign-in succeeds and the device cookie is absent or invalid, **do not mint the session** — record a
  short-lived pending state and require a confirmation step bound to the account email;
- only a completed confirmation mints the session.

**Cost:** a device cookie, a pending-state store, an email send, a confirmation route and UI, plus a
production migration if the pending state is stored in the database (a signed cookie can hold it instead,
avoiding that). **Trade-off:** wallet sign-in stops being a single step on a new device — a real UX change
for members, and therefore an owner decision, not an engineering one.

### 2. Notify the account owner on wallet sign-in — **cheap, real, detection only**

An email on every wallet sign-in ("if this wasn't you…") gives the victim the chance to act. The app has no
mailer today (auth email goes through Supabase's SMTP), so this needs a small mail path and a template.
It does not prevent the sign-in; it bounds how long it goes unnoticed.

### 3. Make the prompt unmistakable — **cheap, but needs a real-wallet test**

The message already names the site and the purpose, which is the right shape. Two improvements are
available: the headline currently reads *"bitXbit wallet verification"* for a **sign-in** challenge (the
purpose line does say sign-in), and a line telling the user to check the address bar would arm the victim
directly. Both are edits to the signed text, and this project has already measured that Phantom **refuses**
some message shapes outright — so neither may ship without being exercised on Phantom and Solflare by
someone holding the wallets. That verification is the owner's.

### 4. Challenge binding — **rejected**

See above. Documented so it is not re-proposed as a fix.

## Verification run — 2026-11-03, deploy-preview-82

```
26 assertion(s) passed, 0 failed
wallet sign-in end-to-end verification PASSED
```

Run against the preview of the change that documents this risk (`npm run test:wallet-signin`). It covers
the full HTTP surface with real keypairs: challenge issuance, a completed sign-in with a session that
authenticates `/dashboard`, every negative case (wrong signer, replayed nonce, unverified wallet,
unregistered wallet), the enumeration guarantee, and the two R-021 assertions above. Teardown proved clean
(no challenge rows, no disposable users).

**Before this change the same harness reported 23 passed / 1 failed on every deployment** — a stale
assertion read the message host from line 1, the position it held in the SIWS layout the message no longer
uses. A permanently red harness is not a gate, which is why it is fixed here rather than noted.

## What this document does not claim

- It does not claim the risk is mitigated. It is **accepted and open** (R-021).
- The mitigation analysis in "Why the obvious fix does not work" is **reasoning, not measurement**; what was
  measured is the relay itself and the absence of any client binding.
- The relay measurement ran against a **staging-backed preview** with disposable fixtures, not against
  production member accounts.
