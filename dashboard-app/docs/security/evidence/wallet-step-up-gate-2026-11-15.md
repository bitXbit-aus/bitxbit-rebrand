# Wallet step-up gate — evidence (2026-11-15)

**Register:** R-021 (prevention, Part 1) · **Design:** `../wallet-step-up-design.md`
**Migration:** 029 (applied to production and staging) · **PR:** #87

The gate that makes a relayed wallet signature no longer sufficient. Verified in a deployment, not only in
unit tests, because the property that matters is an HTTP one: **after a relay, `/dashboard` must not be 200**.

## The measurement that matters

`npm run test:wallet-signin` against `deploy-preview-87`, with migration 029 applied to staging:

```
ok   THE RELAY NO LONGER MINTS A SESSION (R-021 prevention)
ok   the relayed attempt is refused by the gate — step-up required, or fail-closed if the code could not be delivered
ok   after a relay, /dashboard is not 200
...
42 assertion(s) passed, 0 failed
wallet sign-in end-to-end verification PASSED
```

Before this change the same harness asserted the opposite — *"a challenge requested with no browser context
can be completed by a different one (the relay is open — R-021)"*. That assertion was rewritten rather than
deleted, so the harness now proves the gate instead of proving the gap.

Also asserted on the deployment: a valid signature on an unrecognised device does not sign in · no session
cookie is set before the step-up · a wrong code is refused and sets no cookie · the right code completes and
the minted session authenticates `/dashboard` · a code is single-use · **a recognised device signs in without
a step-up** · **a revoked device is put back behind the gate** · every negative case and the enumeration
guarantee unchanged · teardown clean.

## Two defects found during the work

**1. A fail-open in the attempt limit, caught by the migration gate.** `complete_wallet_stepup` incremented
`attempts` and then `RAISE`d. A caught exception in PL/pgSQL rolls back its own subtransaction, so the
increment was undone, the counter stayed at 0, and a 6-digit code had **no attempt limit at all**. Failure
paths now return a status; only parameter validation raises, and only before any write. The gate asserts the
counter itself (attempts must reach exactly 5), not just that an exception occurred.

**2. The harness trusted the wrong browser.** The first deployed run failed *"a recognised device signs in
WITHOUT a step-up"* because the completion request did not send the device cookie — so the completion trusted
a **fresh** handle while the returning browser presented the original one. The harness now sends the cookie,
as a browser does. Worth stating plainly: the harness was wrong, and the failure was the harness's, but the
*design* requirement it exposed is real — the device handle must survive from gate to completion, and a
browser that drops cookies will simply step up every time (safe, and annoying).

## Environment findings

- **The staging Supabase project was `INACTIVE`** (paused), so `luqrwhgjtiyfmeawbtmp.supabase.co` returned
  **NXDOMAIN** and every staging-backed deploy preview answered `500` on `/api/auth/wallet/challenge`.
  Restored, and the preview works again. Worth knowing: a pause silently breaks every preview, and the
  symptom looks like an application failure.
- **Migration 029 was applied to staging** as well as production — the previews are staging-backed, so a
  staged verification of this feature is impossible without it.

## What is NOT verified

- **Part 2 (the device-bound key) is not built.** The residual is explicit and recorded in the register: a
  victim talked into relaying the *code* as well as the signature still gets a session. The gate raises the
  attack from one deception to two, and warns the victim in between — it does not make them immune.
- **No member has used this flow in production.** The gate's own path has been exercised only against a
  staging-backed preview with disposable fixtures.
- **The step-up email in a real inbox.** The transport is proven (the R-021 alert delivers), and the payload
  is unit-tested, but the code email has not been seen by a human.
- **Safari's ~7-day storage eviction** will cost returning Safari members an extra step-up. Predicted, not
  measured.
