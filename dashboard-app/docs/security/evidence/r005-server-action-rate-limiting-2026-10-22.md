# R-005 — rate limiting for costly Server Actions (2026-10-22)

**Status: IMPLEMENTED AND TESTED. Not yet verified in a deployment.**
**Risk:** R-005 · **Tracked as:** NA-3

---

## 1. The finding

R-005 is not an access-control gap — every Server Action is authorization-guarded.
It is an **unbounded-work** gap: `checkRateLimit` appeared **zero times** in
`lib/actions.ts` across 30 actions, so an authenticated operator could drive costly
work (a reward calculation over every user, an on-chain distribution that signs one
transaction per recipient) with **no request ceiling**. A retry loop, a
double-submitted form, or a stuck client could fan out without limit.

It was deliberately **not** implemented while R-004 was open: limits on a store
that was not shared would have created the appearance of protection without the
substance. R-004 is now fixed and verified, so the limits here are real.

## 2. Design

**Subject = the authenticated user id, not a client address.** A Server Action has
no `NextRequest`, so the origin-side client resolution used for API routes
(`lib/client-ip.ts`, R-004) is unavailable. Substituting a header would let the
caller choose its own key — exactly the spoofing hole R-004 closed. Every action
limited here is authorization-guarded, so an identified user is always in hand.

**Refusals are RETURNED, not thrown.** A thrown Server Action error becomes an
opaque HTTP 500 in a production build (Next.js redacts the message), so an operator
cannot distinguish a deliberate ceiling from a server fault — the lesson already
paid for by the test-airdrop guard. `{ error }` reaches the UI intact via the
contract in `lib/action-result.ts`, which `FormWithToast` renders as a destructive
toast. All five call sites are already `FormWithToast`-wired, so no UI change was
needed.

**Denials are not written to the security audit log.** The refusal happens before
any mutation, and a caller who is being limited could otherwise use the audit trail
itself as an amplification target.

**Key shape:** `action:<action>:user:<user id>`. Namespaced by action so budgets are
independent (exhausting the airdrop ceiling must not consume the calculation
ceiling), and prefixed `user:` so an action key can never collide with the
client-address keys used by API routes.

## 3. Scope — what was limited, and what was not

| Action | Limit (per user / 60 s) | Why |
|---|---|---|
| `reward.airdrop` | **3** | Signs one transaction per recipient. Most expensive, least reversible. |
| `reward.testAirdrop` | **3** | On-chain. |
| `reward.calculate` | 6 | O(users) recalculation. |
| `reward.correct` | 6 | O(users) recomputation. |
| `reward.approve` | 6 | Period-wide transition. |

Chain budgets are asserted at or below compute budgets by a test, so a careless
edit cannot loosen the irreversible path.

**Deliberately excluded:**

- `getAirdropWalletBalanceAction` — called during **page render**
  (`app/admin/rewards/page.tsx`), so a refusal object would break the page rather
  than inform the operator. Rate limiting a render path needs its own design.
- `getTokenBalanceAction` — called from a client component whose UI expects a
  balance, so the same contract problem applies. **Separate observation:** this
  action has **no authorization guard at all** (`lib/actions.ts`), unlike every
  other action in the file. That is a distinct finding, recorded here rather than
  folded into this change; it should be assessed on its own.
- Bulk user mutations — bounded by an explicit selection and already audited;
  left for a follow-up rather than widening this change's review surface.

## 4. Verification

- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npm test` — **146/146** (was 133; 13 new).
- `npm run test:migration` — replay + all concurrency races pass (unaffected).
- Dummy-env production build — compiles.
- **Mutation testing: 8/8 detected, 0 compile errors.** A green suite is not
  evidence the tests can fail, so each mutation was applied and the failing
  assertion identified:

| Mutation | Detected by |
|---|---|
| Drop the per-action namespace | `sends the namespaced key to the store` |
| Drop the `user:` component | `namespaces the key by action and user`, `gives each user their own budget` |
| Constant wait text (ignore `resetAt`) | `derives the wait from resetAt`, `never reports a zero or negative wait` |
| Empty `error` string | `returns a refusal object…`, plus the wait tests |
| Loosen the chain budget past compute | `keeps chain-touching actions at or below compute budgets` |
| Off-by-one ceiling (`maxRequests + 1`) | the three budget-independence and boundary tests |
| Drop a guard from `lib/actions.ts` | both call-site wiring tests |
| Guard checks `allowed` but never refuses | `returns the refusal from every guarded call site` |

The last two exist because the unit tests alone prove only that the limiter
**works**, not that it is **reached**: a limit can be declared in the map and never
applied, and every behavioural test would still pass. The wiring tests fail if a
guard is dropped or stops returning the refusal.

## 5. Limitations — what this does NOT establish

- **Not verified in a deployment.** No live request has been observed being
  refused. The controls are proven by unit test and by source assertion only.
- **The limiter inherits the store's degradation mode.** If the shared store is
  unavailable the counters fall back to per-instance memory, so the ceiling
  becomes per-instance — weaker, though still not absent. This is visible via
  `GET /api/health/rate-limit` (NA-15).
- **Only five actions are bounded.** The 25 others, including bulk user mutations
  and the two excluded read actions, remain uncapped.
- **Not a substitute for authorization.** Every limited action is still
  authorization-guarded; the ceiling bounds work, it does not grant or deny access.
