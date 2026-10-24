# `getTokenBalanceAction` — authorization guard added (2026-10-23)

**Status: FIXED.** 30 of 30 Server Actions guarded. `tsc` clean; **167/167** tests; production
build passes; new guard **mutation-verified 5/5**.

---

## 1. The finding (2026-10-23 register sweep)

`lib/actions.ts` opens with `"use server"`, so **every export in it is a publicly reachable Server
Action endpoint**. Measured: **30 exports, 29 guarded, 1 not** —

```ts
export async function getTokenBalanceAction(walletAddress: string) {
  return getTokenBalance(walletAddress);
}
```

No `requireActiveUser` / `requireActiveAdmin` / `requireCapability`. An **unauthenticated** caller
could invoke it and drive an on-chain RPC read for an arbitrary address.

**Impact — stated precisely.** Not confidentiality: SPL token balances are public chain state. It
is an **unauthenticated work / RPC-amplification vector**, and it contradicted the register's own
access-control claim ("30 Server Actions guarded" — it was 29).

## 2. The fix

```ts
export async function getTokenBalanceAction(walletAddress: string) {
  await requireActiveUser();
  return getTokenBalance(walletAddress);
}
```

**Why `requireActiveUser` and not `requireCapability`.** The only caller is the member's own wallet
page (`/dashboard/wallet`), which requires an authenticated *active* user. `requireCapability` is
admin-scoped and would lock members out of their own page — the sibling
`getAirdropWalletBalanceAction` correctly uses it because it reads the **treasury** balance, which
is an admin concern.

**Why no client change was needed.** The sole caller, `app/dashboard/wallet/page.tsx:98` (a
`"use client"` component), already wraps the call:

```ts
try { const balance = await getTokenBalanceAction(publicKey.toBase58()); setTokenBalance(balance); }
catch (error) { console.error(...); setTokenBalance(null); }
```

`requireActiveUser` **throws** `AuthorizationError`, which that existing `catch` already tolerates.
This is precisely why the action was excluded from R-005's *returned*-refusal rate limiting — a
returned `{ error }` object would have been set as the balance and rendered as such.

**Why the action could not simply be deleted.** The caller is a **client** component, so it needs a
server round-trip; `getTokenBalance` lives in `lib/solana.ts` (server-only). Removing the export
would break the wallet page.

**Rate limiting: deliberately not added.** R-005 documents this exclusion for the read-path actions,
and the confirmed defect was the missing **authorization** guard. Bounding the read is a separate
design question (it would need a thrown, not returned, refusal to survive the caller's shape).

## 3. Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `npm test` | **167/167** pass, 29 suites, 0 fail (162 before + 5 new) |
| production build (dummy env) | **succeeds** |
| guard invariant | **0 of 30** actions unguarded |

**Mutation-tested — 5/5 detected, 0 compile errors** (a green suite is not evidence a guard can
fail):

| Mutation | Detected by |
|---|---|
| M1 remove the guard from `getTokenBalanceAction` | "guards every exported Server Action" **and** the specific test |
| M2 comment the guard out (`// await requireActiveUser();`) | **both** — a commented guard does not count |
| M3 rename the guard (typo `requireActiveUserTypo`) | both |
| M4 remove a guard from a **different** action (`getAirdropWalletBalanceAction`) | "guards every exported Server Action" |
| M5 delete an action entirely | the count test **and** the specific test |

## 4. The structural guard test

`lib/action-authz.test.ts` reads `lib/actions.ts` and asserts:

- there are **30** exported Server Actions (the count is asserted so that *adding* an action forces a
  re-check rather than silently passing);
- **every** one contains a real `await require…(` call **on a non-comment line**;
- `getTokenBalanceAction` specifically awaits `requireActiveUser`;
- a guard named **only in a comment** does not satisfy the check (proved by M2).

It reads the source rather than importing it: `lib/actions.ts` pulls in `server-only` modules that
will not load in a plain node test, and a source assertion is the right instrument for this
regression — a guard removed, or a new action added without one.

## 5. Residual / not in scope

- Rate limiting for `getTokenBalanceAction` and `getAirdropWalletBalanceAction` remains a deliberate
  exclusion (R-005).
- The action still accepts an **arbitrary** address, so an authenticated user can read any address's
  balance. That is public data, now bounded by authentication. Constraining it to the caller's own
  saved wallet was considered and **rejected**: the page legitimately shows the balance of the
  *connected* wallet, which may differ from the saved payout address.

## 6. Also closed from the sweep

R-002's structural claim — "`.next` contains **0** `.node` files and no `bigint-buffer` directory" —
was listed as *not re-measured* in the sweep. Re-measured here after a production build:
**0** `.node` files, **0** `bigint-buffer` directories. The only `bigint_buffer` references are the
package's pure-JS fallback (`try { require("bigint_buffer") } catch { console.warn(...) }`) — the
safe path. The native addon **does** exist in `node_modules/bigint-buffer/build/Release/`, so the
tracing exclusion is meaningful rather than vacuous.
