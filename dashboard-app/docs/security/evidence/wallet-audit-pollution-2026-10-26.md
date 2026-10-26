# Fix: fabricated `wallet.address_save` failures polluting the security audit log

**Date:** 2026-10-26
**Reported by:** owner, after successfully verifying a wallet and signing in
**Severity:** low (no user-facing error, no security control weakened) — **but in the
evidence layer**, where a noisy signal is actively harmful.

## How it was found

The owner verified a wallet and signed in successfully. Verifying that against production
turned up four **failed** `wallet.address_save` rows in `security_audit_log` at
20:09:56, 20:10:08, 20:10:20 and 20:14:44 — for a session in which nothing failed from
his side.

## Root cause

Two components combined:

1. `lib/actions.ts` — `saveWalletAddress()` deliberately refused any address that was not
   already the verified one:

   > "Wallet address changes require ownership verification. Please verify the new wallet
   > before saving it as your payout address."

   On the only path it permitted (same address), it persisted **nothing** — it revalidated
   paths and returned. So the action could never actually save.

2. `app/dashboard/wallet/page.tsx` — an effect called it on **every wallet connect**,
   wrapped in a `try/catch` that swallowed the error ("Expected when the connected wallet
   differs from the saved address"). The user therefore saw nothing.

The defect is the interaction with auditing: `saveWalletAddress` called
`auditMutationFailure(...)` **before** rethrowing. So every ordinary wallet connection
wrote a `success: false` row — with `metadata: {}`, so it was **indistinguishable from a
real failure**.

Net effect: connecting a wallet quietly fabricated security incidents.

## Why this matters more than it looks

An audit log that cries wolf is worse than no audit log. These rows were in the exact
table the project uses to diagnose incidents — the same table that correctly recorded
`wallet_not_verified` and `wallet.signed_in` during this same session. A reviewer
investigating "failed wallet address saves" would have chased four phantoms, and the
cheapest lesson to learn would have been to ignore the signal.

## The change

- **`app/dashboard/wallet/page.tsx`** — the connect effect no longer calls any action. It
  only re-reads status via `loadSavedWallet()`. Same UI result, no write. Connecting a
  wallet changes no persisted state; `verifyWalletSignature()` is the only path that
  writes `wallet_address` / `wallet_verified`.
- **`lib/actions.ts`** — `saveWalletAddress` deleted. It had exactly one caller (the
  removed effect) and no test, and its entire behavioural surface was "no-op" or "throw".
  Leaving a `saveWalletAddress` that can never save is misleading API surface.
- **`lib/action-authz.test.ts`** — the Server Action inventory tripwire moves 30 → 29,
  with the reason recorded inline. The deleted action did call `requireActiveUser()`, so
  no unguarded surface was lost.

## Verification

```
tsc                               0 errors
tests                             228/228 pass
build                             exit 0  (/dashboard/wallet 10.4 kB)
residual references to the action none
```

**Mutation test on the inventory assertion** (it must fail for the right reason, not be
neutered): setting the expectation back to `30` produced
`expected: 30, actual: 29` and `# fail 1`, then the file was restored to `29`. The
assertion is still live and discriminating.

## What this does NOT claim

- **The already-written rows were not deleted.** `security_audit_log` is append-only by
  trigger; the four fabricated rows remain on record. That is correct — this fixes the
  generator, not the history. Anything auditing that window should read them as
  connect-time noise, not failures.
- **Not verified in a browser.** The code path is proven by inspection plus the build and
  type gates; the wallet page still needs a real connect to confirm end-to-end — the same
  standing residual as R-007.
- **Unlink/replace is still absent.** This change removes a broken no-op; it does not add
  wallet management.
- **M8 human review remains WAIVED under D5 — not satisfied.**

## Follow-up worth considering

Any future action that refuses on policy grounds should record a **distinct** outcome
(e.g. `*_refused`, `success: true`, with a `reason`) rather than a mutation failure, so
that policy decisions never masquerade as errors.
