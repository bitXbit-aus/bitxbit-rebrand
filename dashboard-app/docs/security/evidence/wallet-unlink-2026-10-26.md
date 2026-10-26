# Wallet unlink path

**Date:** 2026-10-26
**Closes:** the largest gap in the wallet feature — until now a linked wallet could not
be removed at all, by the user or by anyone else.

## Why it exists

Wallet sign-in shipped as **link-only**: a wallet verifies against an existing email
account. That design is sound, but it shipped without a way back out. The consequence:
**a lost or compromised wallet could not be detached from the account.** The affected
user's only options were to abandon the account or ask an administrator to edit the
database by hand.

Unlink is therefore not a convenience feature. It is the recovery path.

## Design decisions, and why each is deliberate

### 1. No signature from the wallet being removed

The situation this exists for is *"that wallet is lost or compromised"* — where proving
control of the wallet is precisely what the user cannot do. Requiring its signature
would make the feature unusable at the only moment it matters.

The bar is an **authenticated session**, supplied by `requireActiveUser()`. This is
deliberate and worth stating plainly: the action trusts the account, not the wallet.

### 2. It cannot lock anyone out

Every account has a `NOT NULL UNIQUE` email and wallet sign-in is link-only, so **email
sign-in always remains available**. Unlinking can never strand a user without a way in.

### 3. It cannot strand money

Measured before building: `payout_operations` stores its **own** `wallet_address`
snapshot at claim time. An operation already created still pays to the address it was
created with. Only *future* claims are blocked, which is the intended effect of having
no verified payout address.

### 4. Only `wallet_address` is written

A `BEFORE UPDATE OF wallet_address` trigger
(`sync_wallet_verification_status()`) already sets `wallet_verified = FALSE` and
`wallet_verified_at = NULL` whenever the address changes. The action therefore writes
one column and lets the trigger maintain the rest, so that invariant keeps a **single
owner** instead of being restated in application code where it could drift or contradict.

### 5. Concurrency guard

The update carries `.eq("wallet_address", previousAddress)`. If a verify or link landed
between the read and the write, no row matches and the action **refuses** rather than
silently clobbering the newly linked wallet. Affected rows are checked via `.select()` —
`{ error: null }` does not prove a write happened.

### 6. Idempotent, and silent when there is nothing to do

Unlinking an account with no wallet returns `{ unlinked: false }` **without writing**.
This matters given the lesson from PR #62: an audit row must not be produced for an
action that changed nothing, or the log starts describing events that did not occur.

### 7. Audited under its own action name

`wallet.unlinked`, with the removed address in metadata. The `audit_users_security_changes`
trigger also writes a generic `update` row; the explicit action is what makes the removal
legible. Consistent with how verification writes `wallet.verified` alongside the same
trigger's rows.

## Safety properties summary

| question | answer |
|---|---|
| Can it lock a user out? | No — email sign-in always remains |
| Can it strand an in-flight payout? | No — the operation holds its own address snapshot |
| Can it remove someone else's wallet? | No — scoped to `user.id` from the session |
| Can a hijacked session detach a wallet? | Yes — same bar as changing an email or password; the audit row names it |
| Does it require the compromised wallet's key? | No — deliberately, see §1 |

## Verification

```
tsc          0 errors
tests        235/235 pass
build        exit 0   (/dashboard/wallet 10.8 kB)
```

The repository's existing `guards every exported Server Action` test now covers
`unlinkWallet` automatically — it reported no unguarded surface — and the Server Action
inventory tripwire was moved 29 → 30 in the same change, so the new surface is
deliberate rather than unnoticed.

## NOT verified — stated plainly

- **No browser test yet.** The button and the full flow have not been exercised against a
  real wallet. The type, test and build gates pass; that is not the same thing.
- **No deployed-database test.** The action has not been run against production or staging.
- **No tests for the action itself.** It is a thin database wrapper and the two behaviours
  worth asserting (refuse-on-concurrent-change, no-op-when-empty) are only provable
  against a real database, which this rig does not have. Recorded as a gap rather than
  claimed as covered.
- **Admin-initiated unlink** does not exist. An administrator still cannot remove a wallet
  on a user's behalf.
- **No re-authentication prompt.** A session is sufficient. If that bar proves too low,
  requiring a fresh password or magic-link round trip is the next increment.

**M8 human review remains WAIVED under D5 — not satisfied.**
