# R-002 — bigint-buffer / CVE-2025-3194, re-assessed by measurement (2026-10-22)

**Advisory:** GHSA-3gc7-fjrx-p6mg / CVE-2025-3194 — buffer overflow in `bigint-buffer`'s
`toBigIntLE()`. **Range:** `<= 1.1.5` (all versions). **CVSS 7.5**
(`C:N/I:N/A:H` — **availability impact only**; no confidentiality or integrity impact).

**Status after this work:** the risk is **lower than the register records**, but the
register's *justification* was argued on the **wrong axis** and has been replaced.

---

## 1. The package is still unfixed — that part holds

| Check | Result |
|---|---|
| `bigint-buffer` latest version | **1.1.5** — unchanged |
| Last publish | **2022-04-11** (unmaintained for 4 years) |
| `@solana/buffer-layout-utils` latest | **0.3.0** — still depends on `bigint-buffer: ^1.1.5`; upstream repo **archived January 2025** |
| `@solana/spl-token` latest | **0.4.15** — already installed; still pulls the chain |
| `npm audit` "fix" | a **semver-major downgrade** of `@solana/spl-token` to `0.1.8` — not a fix |

So "no upstream fix path" remains true. **New information:** community pure-JS forks now
exist (`bigint-buffer-safe`, `bigint-buffer-fixed`), which the original acceptance did not
have available. Neither is adopted here — see §5.

## 2. What the vulnerability actually is (measured, not inferred)

Run against the installed tree, each case in its own process:

| Input to `toBigIntLE` | Result |
|---|---|
| `null` | **SIGABRT** — `Assertion failed: (status == napi_ok), function toBigInt, file bigint-buffer.c, line 49` |
| `undefined` | **SIGABRT** |
| string `'abc'` | **SIGABRT** |
| number `42` | **SIGABRT** |
| `Buffer.alloc(0)` | ok → `0n` |
| 1 / 7 / 8 / 9-byte Buffer | ok |
| `Uint8Array(8)` | ok |

**The trigger is input *type*, not buffer length.** Every Buffer length is handled
correctly; the abort is the native addon failing `napi_get_buffer_info` on a non-Buffer.
This matters because it means no crafted *length* in chain data can trigger it.

**The vulnerable code is the native C addon.** The package's pure-JS fallback
(`dist/node.js`, taken when `require('bindings')` fails) is **safe** — the same inputs
raise a catchable `TypeError` instead of aborting:

```
fallback toBigIntLE(null)      -> THREW TypeError (no process abort)
fallback toBigIntLE(undefined) -> THREW TypeError
fallback toBigIntLE(42)        -> THREW TypeError
```

## 3. The register's existing justification argued the wrong axis

R-002 is currently accepted on the reasoning that reachability is constrained because
*"the treasury mint is operator-controlled, not user-supplied"*, payout amounts are
canonicalised from migration 025, and *"users cannot select the mint or the account layout
being decoded"*.

Those are controls on **data content**. The measured trigger is **input type**. None of
those controls has any bearing on whether a non-Buffer reaches `toBigIntLE` — so the
recorded justification was giving confidence for a reason that does not apply. The
conclusion (low risk) happens to survive, but it needs the correct argument.

## 4. The correct argument: a single caller that converts first

| Check | Result |
|---|---|
| Packages in the installed tree depending on `bigint-buffer` | **exactly one** — `@solana/buffer-layout-utils` |
| Does the app's own source require it? | **no** (`lib/solana.ts`, `lib/payout.ts`, `lib/wallet-verification.ts`, `lib/actions.ts`) |
| The call site | `bigint.js`: `littleEndian ? toBigIntLE(Buffer.from(src)) : toBigIntBE(Buffer.from(src))` |

The sole caller **wraps the argument in `Buffer.from(...)` before calling**, and
`src` comes from `blob(length).decode(buffer, offset)` — always Buffer-backed. So the
vulnerable function always receives a Buffer, and **the trigger is unreachable by
argument** through the only path in this tree.

The app reaches it via `@solana/spl-token` → `getAccount()` → `AccountLayout.decode` →
`u64` layout → that call site.

## 5. Structural backstop added

Argument-based reasoning is fragile — a new caller would silently invalidate it. So the
vulnerable code is now also **excluded from the deployment**:

```js
// next.config.mjs
experimental: {
  outputFileTracingExcludes: { '*': ['node_modules/bigint-buffer/build/**'] },
}
```

The native addon is therefore not traced into the serverless function bundle, so the safe
pure-JS fallback is what runs — the vulnerable code is **absent**, not merely unreached.
Measured after the change: `.next` contains **0** `.node` files and no `bigint-buffer`
directory.

**Not adopted:** replacing the dependency with a community pure-JS fork. That would remove
the CVE outright, but it means adopting unvetted third-party code to mitigate a
**DoS-only** advisory whose trigger is already unreachable, on a package that is already
absent from the deployed bundle. The trade is not favourable; it is recorded as a
deliberate decision rather than an oversight.

## 6. Verification

- `npx tsc -p tsconfig.json --noEmit` — clean
- `npm test` — **162/162** (4 new R-002 guard tests)
- `npm run test:migration` — replay + concurrency races pass
- Dummy-env production build — compiles; `outputFileTracingExcludes` accepted by the config schema
- **Mutation testing: 5/5 detected**, each failing the intended assertion:

| Mutation | Detected by |
|---|---|
| Remove `outputFileTracingExcludes` | `keeps the native addon out of the traced server bundle` |
| Exclude the wrong directory | same |
| A new package starts depending on `bigint-buffer` | `has exactly one package in the tree depending on bigint-buffer` |
| The sole caller stops wrapping in `Buffer.from` | `reaches toBigIntLE only through a caller that wraps…` |
| App source imports `bigint-buffer` directly | `does not call bigint-buffer from the application's own source` |

The guard tests exist precisely so that the load-bearing claim cannot rot silently: if the
caller set changes, or the caller stops converting, or the exclusion is dropped, the suite
fails.

## 7. Limitations

- **Not verified in a deployment.** The exclusion's effect on the Netlify function bundle is
  inferred from a local production build (`npm run build`), not inspected in the deployed
  artifact.
- The exclusion is defence in depth, not the primary argument — the primary argument is the
  single converting caller (§4).
- **The advisory is not closed upstream** and the package remains unmaintained. The residual
  risk is a *theoretical* process abort requiring a non-Buffer to reach the function, which
  the only caller prevents.
- This document does not claim the app is immune if `@solana/spl-token` changes its decoding
  path in a future upgrade — the guard test would fail, and R-002 should be re-read then.
