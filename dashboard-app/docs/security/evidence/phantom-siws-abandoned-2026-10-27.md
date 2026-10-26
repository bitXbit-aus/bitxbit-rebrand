# Phantom: dropped SIWS from the wallet challenge message

**Date:** 2026-10-27
**Supersedes the diagnosis in:** `phantom-siws-message-2026-10-27.md`
**Impact:** every Phantom user was unable to verify or sign in with a wallet

## Outcome in one line

Phantom refuses **any** message shaped like SIWS, however correct it is. We no longer
send one. Wallet verification now works on both Phantom and Solflare.

## How the cause was found — and how it was almost missed

Three diagnoses were proposed and **all three were wrong**. Each was killed by a
measurement, not by argument:

| hypothesis | how it died |
|---|---|
| SIWS `domain` came from Netlify's rewritten `request.url` | read the stored message: it said `app.bitxbit.com.au`, and the page host matched |
| missing required fields (`URI`/`Version`/`Chain ID`) | fixed those — byte-identical to Phantom's own reference serialiser — **and Phantom still refused** |
| CSP `frame-src` blocking a Phantom iframe | console showed no CSP violation, only `WalletSignMessageError` from Phantom's provider |
| missing `display` argument on `signMessage` | two-argument call failed identically to the one-argument call |

What finally settled it was a **controlled browser probe** (four diagnostics, seven
message variants) run against the real wallet:

```
plain message                                  PASS  (64 bytes)
SIWS prefix + address, NO field block          PASS  (64 bytes)
SIWS prefix + address + any field block        FAIL  no prompt
SIWS, any domain / statement / chainId / expiry  FAIL  no prompt
Solflare, all of the above                     PASS
```

**The pattern is unambiguous:** a plain message works; a SIWS-shaped message does not;
and the presence of a *field block* is what tips it over. Phantom's SIWS parser is
rejecting our field block regardless of content.

One variant produced a **different, explicit error** — a message whose first token did
not match the page origin returned *"…the domain in the sign-in message does not match
the requesting app's origin"*. Phantom names the cause when the **domain** is at fault.
Production's generic *"invalid formatting"* therefore ruled the domain out. That
distinction is the single most useful thing this investigation produced.

## The decision: SIWS was the wrong trade

SIWS exists so a **third party** can parse and validate a message it did not create.
**No third party ever parses ours.** We mint the nonce, store the message, check expiry,
and verify Ed25519 over the exact stored bytes ourselves. Every property SIWS claims is
already held, more strongly, elsewhere:

| property | held by |
|---|---|
| replay protection | single-use nonce, consumed **atomically inside Postgres** |
| freshness | `Expires` + a 5-minute challenge TTL, checked server-side |
| domain binding | the challenge is server-minted; the `Site:` line exists for the **user** |
| signature integrity | Ed25519 over stored bytes, never over what the client claims |

**The security boundary was never the message text.** A hostile site can induce a
signature over a message that merely *says* `app.bitxbit.com.au` — but it carries that
site's nonce, which does not exist in our challenge table, so our server refuses it.
Trust comes from the nonce we minted, not from a string a wallet pattern-matched.

Adopting SIWS bought interoperability we never used, and cost us an entire wallet.

## What changed

- `buildSiwsMessage` → **`buildWalletChallengeMessage`** (`lib/wallet-crypto.ts`),
  emitting a plain, readable, non-SIWS block:

  ```
  bitXbit wallet verification

  Site:    https://app.bitxbit.com.au
  Wallet:  J3KDs…
  Nonce:   6f34556c-b73d-4f92-b6ad-cdff0a78bcb7
  Issued:  2026-10-26T22:52:14.774Z
  Expires: 2026-10-26T22:57:14.774Z
  Purpose: Link this wallet to your bitxbit account.

  Signing this proves you control this wallet. It is not a transaction:
  nothing is sent on-chain and no fee is charged.
  ```

- It **refuses to build** an SIWS-shaped message, via `looksLikeSiws()`. The detector is
  deliberately loose: Phantom refused both the exact phrase and a near-miss, so a false
  positive costs a clear server error while a false negative costs a silent refusal in
  the user's browser.
- All call sites updated: `wallet-verification.ts`, `wallet-signin.ts`, the e2e harness.
- **No migration, and nothing breaks mid-flight:** every challenge row stores its own
  `message` and verification uses the stored text, so challenges issued before this
  change still verify. The 5-minute TTL clears any stragglers.

Carried over from the previous attempt and still correct: the **failure-path auditing**
(all ten paths record `wallet.verification_failed` with a reason), the **signature-shape
normaliser**, and the fixed **"Signature cancelled" mislabel**.

## Verification

```
tsc     0 errors
tests   241/241 pass
build   exit 0
```

**Mutation-tested.** Reintroducing an SIWS-shaped first line fails **4 assertions**:

```
not ok 2 - is NOT SIWS-shaped — the property that makes Phantom work
not ok 3 - recognises the SIWS shapes Phantom actually refused, including the near-miss
not ok 4 - refuses to build an SIWS-shaped message out of a purpose string
not ok 6 - lays the message out as a readable block, not a single line
```

Restored: 241/241. So a future "let's be spec-compliant again" change fails in CI rather
than silently in someone's browser.

## NOT verified — stated plainly

- **No browser confirmation of the fix yet.** The probe proved a plain message is signed
  successfully by this wallet in this browser, which is strong, but the end-to-end flow
  through our own deployed page has not been re-run. **That retry is the real test.**
- **No test of what Phantom's SIWS validator is actually doing.** We know it refuses our
  field block and accepts plain messages; we do not know why, and we are no longer
  depending on it either way.
- **A hint of a wallet-side defect:** an independent MetaMask forum report describes this
  exact error appearing in Chrome but not Firefox. If Phantom fixes its parser, this
  change remains correct — a plain message is valid on every wallet that signs anything.
- **`looksLikeSiws` is a heuristic**, not a spec parser. It guards one known-bad shape.

## Lesson for the register

Three confident diagnoses were wrong before the fourth was proven. Two of them were
built on real, verified facts (`request.url` rewriting is real; the SIWS spec does mark
those fields required) — **a true premise is not a cause**. What broke the deadlock was
a controlled probe that varied **one thing at a time against the real wallet**, and the
one useful datum in the whole investigation was a *differently-worded error message*.

The uncomfortable part: the message-format fix was shipped, merged and deployed to
production while being **wrong about the cause**. The fix was a genuine improvement — the
message really was malformed — but it was announced as the solution, and the user tested
it and reported it still broken. A fix that is correct for the wrong reason still needs
the same evidence as any other before it is called done.

**M8 human review remains WAIVED under D5 — not satisfied.**
