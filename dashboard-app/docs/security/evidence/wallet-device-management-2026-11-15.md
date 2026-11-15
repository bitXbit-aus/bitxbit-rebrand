# Recognised devices + revoke — evidence (R-021, D5)

**Register:** R-021 (prevention, the member-facing half) · **Design:** `../wallet-step-up-design.md` §3.4
**PR:** #89 (branch `security/r021-device-management-ui`) · **Migration:** none — the `revoke_wallet_device`
RPC and `wallet_trusted_devices` shipped in **029**, already applied to production and staging.

**Status: implemented, verified locally, PR open. NOT merged, NOT deployed. R-021 is unchanged by this.**

## Why this control exists

Part 1 (the step-up gate, PR #87) means a relayed signature no longer mints a session — and the R-021
detection alert tells a member to *remove a device that was not them*. Until this change there was nothing to
remove it with: the only lever was **unlink your wallet**, which is a far bigger action, and one a member
should not have to take to respond to "someone else has a device you use". D5 is the list and the removal
button, so the alert's instruction has a target.

## The one property that matters, and how it is asserted

`revokeWalletDevice` takes **only the device hash** from the caller. The account id comes from the **session**
(`p_user_id: user.id`), and the RPC is scoped by it — so a well-formed hash for another member's device
revokes nothing.

If the account id were ever read from the form, any signed-in member could revoke **anyone's** device: a
targeted lockout of another member's wallet sign-in. That is invisible to `tsc`, the build and CI —
`p_user_id: anything` type-checks — so it is asserted against the source in
`lib/wallet-device-guard.test.ts`, matching **calls**, not names (the action's own doc comment mentions
`revoke_wallet_device` and `user.id` in prose).

| Mutation | Compiles? | Detected by |
|---|---|---|
| `p_user_id: user.id` → `p_user_id: deviceHash` | **yes** — so the compiler cannot be the catcher | `wallet-device-guard.test.ts` |
| guard removed from `revokeWalletDevice` | yes | `action-authz.test.ts` **and** the new guard test |
| count tripwire `32` → `30` | yes | reported `expected: 30, actual: 32` |

The first row is the point of the table: a mutation that only `tsc` catches is not a test catch, and here it
**compiles**, so the assertion has to be one that looks.

## A test that was wrong on first run

The assertion that no `p_user_id` is caller-sourced was first written as a negative lookahead:
`p_user_id:\s*(?!user\.id)`. It **passed a correct call**. `\s*` backtracks to zero width, so the lookahead
tests the *space* before `user.id` — it is satisfied by every well-formed line, and would have reported a
correct implementation as broken while a genuinely caller-sourced id sat beside it. It is now an extraction of
the assigned tokens compared as a set (`new Set([...]) === ["user.id"]`), which cannot be fooled that way.
Recorded because a security assertion that cannot fail is worse than none.

## Gate

```
tsc -p tsconfig.json --noEmit                0 errors
npm test                                     351/351 pass   (baseline at #87: 338; +13)
npm run test:migration                       replay green (010–029 ×2 + invariants + races)
next build (placeholder env)                 clean; /dashboard/wallet compiles
```

New test files are added to the explicit input list in `package.json` — `npm test` enumerates its inputs, it
does not glob, so an unlisted file is silently not run.

## What is NOT verified

- **The browser half.** Per repo rule 12, a browser-facing change is not done until it is exercised in a real
  browser against a deploy preview. The list and the remove button have not been clicked by a human or by a
  real browser session on a deployed preview. The Playwright smoke suite covers the page's error shell, CSP,
  console and asset skew — not this control's behaviour. **Not claimed.**
- **The revoke → re-gate loop end to end.** That a revoked device is put back behind the gate *is* asserted on
  migration 029's own verification and on `deploy-preview-87` by the wallet harness, but **not** through this
  new action's path (there is no test that presses the new button).
- **No member has used it.** Obvious, and worth stating plainly.
- **D5 does not change the residual.** A victim talked into relaying the *code* as well as the signature still
  gets a session. Part 2 — the device-bound key (design §4) — is the closure of R-021, and is not built.
