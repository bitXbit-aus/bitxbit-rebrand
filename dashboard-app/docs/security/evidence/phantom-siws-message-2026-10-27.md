# Phantom could not sign anything — malformed SIWS message

**Date:** 2026-10-27
**Severity:** every Phantom user was completely unable to use wallet authentication
**Detected by:** the owner, by using the product
**Not detected by:** CI, type-checking, unit tests, or any Solflare test — the previous
test suite *certified* this bug

## Symptom

Linking a Phantom wallet to an account, the user saw Phantom refuse with:

> "the app's signature request cannot be shown due to invalid formatting"

The same wallet worked in Solflare. Three attempts, identical result.

## What the evidence said

`security_audit_log`, actor `shri_appananda@pm.me`, wallet `J3KDs55nHsUr…`:

```
09:30:22  wallet.verification_challenge_created   success
09:30:34  wallet.verification_challenge_created   success
09:30:54  wallet.verification_challenge_created   success
          …and nothing. Not one further row.
```

All three challenges were **never consumed**. No `wallet.verified`. No failure row.

That ruled out a rejected signature: had one been submitted and failed, there would be
a record. **No signature ever reached the server**, three times, deterministically.

## Root cause: the message we asked Phantom to sign was not valid SIWS

Read back verbatim from the stored challenge:

```
app.bitxbit.com.au wants you to sign in with your Solana account:
J3KDs55nHsUr47dLi1nqNsTPvGq6VJiemXAKYEh91NJu

Purpose: Verify wallet ownership for bitxbit rewards
Nonce: ffad3425-ab15-487f-a5b7-171e35f0e403
Issued At: 2026-10-26T22:30:21.752Z
Expiration Time: 2026-10-26T22:35:21.752Z
```

Per Phantom's SIW specification (CAIP-122), which marks `uri`, `version` and `chain-id`
as **Required: true**:

```
field block we sent   : ['Purpose', 'Nonce', 'Issued At', 'Expiration Time']
field block spec wants: ['URI', 'Version', 'Chain ID', 'Nonce', 'Issued At', 'Expiration Time']

MISSING required      : ['Chain ID', 'URI', 'Version']
UNRECOGNISED field    : ['Purpose']
```

The first line matches the SIWS prefix exactly, so **Phantom recognised the message as
SIWS and engaged strict validation** — then found `Purpose:` where `URI:` must be,
could not parse the field block, and refused **without ever showing a prompt**. That is
Phantom's hard block, distinct from the bypassable warning it shows for a wrong field
*value*. Nothing was signed, so the server legitimately had nothing to record.

**Solflare does not parse SIWS at all — it signs whatever it is handed.** That asymmetry
is why this survived: the message worked, silently, for every Solflare user.

## The fix

`buildSiwsMessage` now mirrors Phantom's own reference implementation,
`createSignInMessageText` (`github.com/phantom/sign-in-with-solana`), byte for byte,
emitting `URI`, `Version` and `Chain ID`, and placing the human-readable purpose as a
proper bare `statement` line:

```
app.bitxbit.com.au wants you to sign in with your Solana account:
J3KDs55nHsUr47dLi1nqNsTPvGq6VJiemXAKYEh91NJu

Verify wallet ownership for bitxbit rewards. Signing proves you own this wallet and costs no fee or transaction.

URI: https://app.bitxbit.com.au
Version: 1
Chain ID: mainnet
Nonce: ffad3425-ab15-487f-a5b7-171e35f0e403
Issued At: 2026-10-26T22:30:21.752Z
Expiration Time: 2026-10-26T22:35:21.752Z
```

It also **refuses to build** a message a validating wallet would reject, rather than
emitting one: statement containing a newline, unrecognised chain id, or a `uri` whose
origin does not match the domain (Phantom returns `-32000` on that mismatch) now throw
server-side, with a reason.

**Scope: one function, two paths.** `lib/wallet-crypto.ts` is shared by
`wallet-verification.ts` (verify ownership) and `wallet-signin.ts` (sign in), so
**Phantom could not sign in either** — not merely verify. Both are fixed together.

## Three further defects fixed in the same change

### 1. Verification failures left no trace at all
`verifyWalletSignature` had seven throw paths; **exactly one** wrote an audit row. The
other six — including the `catch` that swallowed crypto errors into a generic message —
threw into silence. Proof this mattered: `wallet.verification_signature_invalid` had
**never once been recorded in this application's history**, so no verification failure of
any kind had ever left server-side evidence.

All ten failure paths now record `wallet.verification_failed` with a `reason` from a
closed set (`invalid_address`, `challenge_expired`, `signature_unverifiable`, …). A
failure that leaves no trace is a failure that cannot be fixed.

### 2. A signature format assumption that failed client-side
Both client paths did `bs58.encode(await signMessage(...))`. Some wallet providers resolve
`signMessage` to `{ signature: Uint8Array }`; encoding that wrapper throws **in the
browser**, where the server cannot see it. New `lib/wallet-signature-format.ts`
normalises the shape, or throws a readable error instead of encoding garbage.

### 3. A misleading error message
The sign-in button's `catch` wrapped both `signMessage` *and* `bs58.encode`, reporting any
failure as **"Signature cancelled — you dismissed the wallet prompt."** An encoding bug
would therefore be reported to the user as their own cancellation, sending anyone
debugging after the wrong cause. The two are now distinct: dismissing the prompt stays
"cancelled"; an unreadable response says so.

## Verification

```
tsc     0 errors
tests   241/241 pass
build   exit 0
```

**Tests now pin to the SPEC, not to our implementation.** `wallet-crypto.test.ts`
contains a verbatim copy of Phantom's reference serialiser and asserts our output is
byte-identical. The previous test asserted `Purpose: …` — a field absent from the spec —
and asserted nothing about the three required fields, so **it certified the bug.**

**Mutation-tested.** Reintroducing the exact defect (dropping `URI`/`Version`/`Chain ID`
and restoring `Purpose:`) produces **4 test failures**:

```
not ok 1 - is byte-identical to Phantom's reference SIWS serialiser
not ok 2 - includes every field the SIWS spec marks as required
not ok 3 - never emits the non-standard Purpose: field that broke Phantom
not ok 4 - places the statement as a bare line between two blank lines
# fail 4
```

Restored: 241/241. The guard actually catches the bug rather than merely describing it.

## Correction to an earlier hypothesis

The first hypothesis was that `request.url` rewriting (a real Netlify behaviour) put a
deploy host into the SIWS `domain` field, mismatching the page host. **Measured and
disproved**: the stored message says `app.bitxbit.com.au`, which matches. Domain was never
the problem. A secondary observation stands — `getAppDomain()` reads
`NEXT_PUBLIC_APP_URL`, which is production in every context, so the message always names
the production domain even on previews.

## NOT verified — stated plainly

- **No browser confirmation with a real Phantom extension.** The fix is derived from
  Phantom's own reference implementation and their published validation rules, and the
  message is now spec-compliant and byte-identical to their serializer — but it has not
  been observed being accepted. **The next step is the owner retrying Phantom.**
- **Wallet sign-in cannot be tested on a preview at all.** Previews point at the staging
  Supabase project while real wallets are linked on production, and the message always
  names the production domain — so Phantom's domain check cannot be satisfied there.
- **A fix that leaves no trace is still possible.** If Phantom refuses for a new reason,
  the refusal happens inside Phantom and nothing reaches the server. The failure-path
  auditing closes the *server-side* blindness, not the browser-side gap.
- **No automated real-browser wallet test.** This class of bug — correct server logic,
  wrong bytes handed to a wallet — is invisible to every gate this repository has.

## Why this is worth recording

The server-side logic was right the entire time. Signatures, nonces, replay protection,
challenge expiry, the link-only identity model: all sound. The defect was in the **exact
bytes we handed to a wallet**, which only a real browser with a real Phantom extension
could have revealed — and only because the owner tried it and reported the error text.

**Seven defects surfaced today through use. None through CI.** This one had a unit test
with the right *name* ("builds a SIWS-compatible message containing all required fields")
that asserted the wrong thing. A test named after a property is not a test of that
property.

**M8 human review remains WAIVED under D5 — not satisfied.**
