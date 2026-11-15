# Recognised devices + revoke — evidence (R-021, D5)

**Register:** R-021 (prevention, the member-facing half) · **Design:** `../wallet-step-up-design.md` §3.4
**PR:** #89 (branch `security/r021-device-management-ui`) · **Migration:** none — the `revoke_wallet_device`
RPC and `wallet_trusted_devices` shipped in **029**, already applied to production and staging.

**Status: implemented, verified locally, and exercised in a real browser against the PR's deploy preview; PR
open. NOT merged, NOT deployed. R-021 is unchanged by this.**

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

**CI on the exact head SHA** (`543daa1`): *Tests, migration replay, and build* **pass**, 2m42s, reporting
`# tests 351 / # pass 351` — the required check ran on the candidate commit itself rather than an earlier one.
**Browser smoke suite** 7/7 against `deploy-preview-89`.

## Verified in a real browser (rule 12) — measured

The unit suite is structurally blind to this half, so it was exercised against the deploy preview.

**Target:** `https://deploy-preview-89--bitxbit-dashboard.netlify.app` — `/api/version` reports
`deployedCommit = 543daa1504c4d2089441ea7be91c4e77f9fb18a6`, **identical to the PR head**, so the app under
test is the exact candidate.

**How a session was obtained, because it is part of the finding:** previews can no longer send mail (the
`RESEND_API_KEY` narrowing carried by PR #88), so the step-up gate takes its **fail-closed** branch there and
a *human* cannot complete a wallet sign-in on a preview at all. The session was therefore minted server-side
for a staging **fixture** member (the `11111111-` scheme) through the app's own plumbing —
`admin.generateLink({type:'magiclink'})` → `verifyOtp` via the same `@supabase/ssr` cookie adapter the app
uses — and injected into the browser. **No credential was typed, requested or displayed**, and the session
material lived in a mode-0600 file that was shredded afterwards. The device row was seeded with the
documentation address `198.51.100.24` and the label `D5 automation browser`.

| Step | Observed |
|---|---|
| Card renders | "Recognised Devices" with its description, on an authenticated `/dashboard/wallet` |
| List loads through the action | the seeded row: label, **"This device"** badge, last-used / first-seen, "From 198.51.100.24", Remove button |
| Press Remove | active list empties to "No recognised devices yet"; the row moves to **"Removed devices — D5 automation browser · Removed 15 Nov 2026"** |
| Database | `revoked_at = 2026-11-15 08:52:17.806Z` on that row |
| Audit | `wallet.device_revoked`, `success: true`, metadata carrying that device hash, at `08:52:18.408Z` |

**The cross-account boundary was measured, not only asserted.** This is the property the guard test exists
for, and a structural assertion is not a measurement:

| Probe | Result |
|---|---|
| `revoke_wallet_device(<victim's hash>, <attacker's user_id>)` | **`false`** — and the victim's row stayed unrevoked |
| Positive control: `revoke_wallet_device(<victim's hash>, <owner's user_id>)` | **`true`**, `revoked_at` set |

The control matters: without it, `false` could mean a broken instrument rather than a real refusal. The
cross-account call is exactly what the action would send if it took the account id from the form.

**Teardown, read back:** both probe rows deleted (2 rows returned), the mode-0600 session file shredded, and
the injected cookies deleted from the browser (`Network.getCookies` for that host → `[]`). The
`security_audit_log` row is **append-only by trigger and deliberately left** — it accurately records that a
device was revoked, and a fabricated row is permanent while this one is true.

## What is NOT verified

- **The cross-account refusal was measured at the RPC layer**, which is the last line of defence. The
  *action*-level refusal was not driven through the UI (invoking a Server Action cross-account from the page
  was not attempted); it rests on the structural assertion plus the mutation that **compiles** and is caught
  by the assertion. Two layers, one measured and one asserted — stated as such.
- **The revoke → re-gate loop through this button.** That a revoked device is put back behind the gate is
  asserted by migration 029's own verification and on `deploy-preview-87` by the wallet harness, and the
  revocation itself is measured above — but no test signs in *again* from a revoked device through this
  action's path.
- **No member has used it.** Obvious, and worth stating plainly.
- **D5 does not change the residual.** A victim talked into relaying the *code* as well as the signature still
  gets a session. Part 2 — the device-bound key (design §4) — is the closure of R-021, and is not built.
