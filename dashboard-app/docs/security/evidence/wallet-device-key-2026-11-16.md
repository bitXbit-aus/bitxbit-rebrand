# Evidence — R-021 Part 2, the device-bound key

**Date:** 2026-11-16
**PR:** #91 `feat(r021): device-bound key — the closure of R-021 (Part 2)`
**Merge commit:** `a4549005157556dcd15dc6f44ae0ae27d6812a2c` (parents `1e5dc45` + `48a9427`)
**Verified head:** `48a942740d513647bcdc3ac040bbde1ad1f4b90e`
**Production:** `/api/version` reports the merge commit (**released** — observed at tick 7)

Every claim below is bound to the SHA above. Nothing in this file is inferred from a green check.

---

## 1. The security property, measured in a real browser (rule 12)

Chromium, on the `deploy-preview-91` origin — `secureContext: true`, IndexedDB available.

| Measurement | Result |
|---|---|
| `generateKey({ECDSA, P-256}, extractable: false, ["sign","verify"])` | `privateKey.extractable === false` |
| `exportKey("jwk", privateKey)` | **throws `InvalidAccessError`** |
| `exportKey("jwk", publicKey)` | succeeds — `{kty:"EC", crv:"P-256", x, y}`, **no `d`** |
| `sign(...)` output length | **64 bytes** (raw `r ‖ s`) |
| IndexedDB round trip (structured clone) | returns a `CryptoKey`; `extractable === false`; `exportKey` still throws; still signs |
| After a **full page reload** (fresh JS realm) | key read back from IndexedDB; still non-extractable; still signs |

The first two rows are the whole of Part 2: the private key has **no readable form**, so there is nothing a
victim can be talked into reading out and relaying. The last row is why the browser module stores the
`CryptoKey` **handle** rather than a JWK — persisting a JWK would have destroyed that property.

## 2. The browser-to-server contract, closed from both ends

A signature produced by the real browser, and one produced **after a page reload**, were verified by calling
the exported server function directly — `verifyDeviceSignature`, **no test doubles**:

```
ok  the browser's public JWK passes parseDevicePublicKey
ok  a LIVE browser signature verifies via the server module
ok  a signature made AFTER A PAGE RELOAD verifies
ok  the live signature against a different nonce is refused
ok  the reload signature against a different nonce is refused
ok  a signature from another key is refused
ok  DEVICE_SIGNATURE_BYTES is the browser's 64
7/7 browser-to-server checks passed
```

Curves, hashes and encodings agreeing in the abstract is not evidence; these bytes are. The vectors are now
pinned in `lib/wallet-device-key.test.ts` (tests 161–164), so a change to the encoding, hash or accepted JWK
shape fails in CI rather than at sign-in in production.

**Teardown:** the probe database was deleted from the origin (`indexedDB.databases()` → `[]`), `localStorage`
empty. No credential was typed, requested or displayed; no wallet extension was involved — the probe exercises
the WebCrypto half, which is the half that had never been run.

## 3. Deployed harness — 46/46, 0 failed (`deploy-preview-91`)

Part 2 assertions, all green:

```
ok  the step-up ENROLLED the device key                                  ← read back from the row, not a 200
ok  a device that ENROLLED a key signs in WITHOUT a step-up
ok  a recognised device with NO device signature does not sign in
ok  a signature from a DIFFERENT device key does not sign in             ← the relay case
ok  a device enrolled WITHOUT a key steps up instead of signing in       ← why no migration was needed
```

The last one is the migration claim, measured rather than argued. Each negative asserts the **security
property** (no `sb-` session cookie), not merely a status code.

## 4. A harness defect this work surfaced, and the fix

The first harness run reported **three FAILED SECURITY ASSERTIONS** — all three were `429`s. The verify
endpoint enforces 10 requests/60 s (read from the route: `windowMs: 60_000`, `maxRequests: 10`, keyPrefix
`api:wallet-signin-verify`); the harness makes **11** verify calls and **11** challenge calls, so the three new
Part 2 cases pushed it past its own subject's ceiling. A working rate limit was being reported as three
vulnerabilities.

Fixed in two halves, because pacing alone leaves the trap armed:

1. **Pacing** — one request of headroom under each real ceiling (challenge 9/60 s, verify 9/60 s, step-up
   9/600 s), logging the wait so a slow run is legible.
2. **A 429 aborts** rather than asserting, naming the endpoint and the pacing constant. A harness able to
   manufacture security findings out of its own speed teaches you to ignore it. Aborting still runs teardown
   (`main().catch()`), so no disposable users or challenge rows are left behind.

Re-run after the fix: **46/46, 0 failed**, with the pacing waits observed at exactly the three points that had
failed — which confirms the diagnosis rather than assuming it.

## 5. Gate

```
npx tsc -p tsconfig.json --noEmit                0 errors
npm test                                         366/366 pass
  ok 161 - a public key exported by a REAL BROWSER is accepted
  ok 162 - a signature captured from a REAL BROWSER verifies
  ok 163 - a signature made AFTER A PAGE RELOAD ... verifies
next build (placeholder env)                     compiled successfully
npm run test:wallet-signin (deploy-preview-91)   46/46 pass, 0 failed
CI on 48a9427                                    all checks pass, CLEAN / MERGEABLE
```

## 6. Design deviation, recorded before building

Design §4 sketches a separate `POST /api/auth/wallet/device-challenge` with its own nonce table. **Not built
that way**, by owner decision: the device key signs the **existing** challenge nonce, already fresh, TTL'd
(300 s) and single-use (consumed by `verify_wallet_signin`). Replay protection is inherited rather than
re-implemented, and **no table, RPC or migration was required** — so nothing had to be applied to production
ahead of the merge. Given up: an independent freshness boundary for the device factor alone.

## 7. Not verified — explicitly not claimed

* **Safari's ~7-day scripted-storage eviction.** Predicted, not measured; the browser probe ran in Chromium. An
  evicted key costs the member one extra step-up — fail-closed.
* **No production sign-in from a new device has been observed.** The meaningful production proof is the first
  real one and its audit rows: `wallet.step_up_required`, `wallet.step_up_completed`, `wallet.device_key_failed`,
  and `wallet.signed_in` with `device: recognised | stepped_up`.
* **A wallet extension was not involved.** The wallet-signature path is untouched by this PR, so Phantom and
  Solflare compatibility is unchanged.
* **`RAISE` after a write still discards the write** in `complete_wallet_stepup` — handled by returning a status
  rather than raising (migration 029), unchanged here.
