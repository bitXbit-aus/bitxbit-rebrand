# R-018 — `uuid` reachability assessment (2026-10-27)

**Advisory:** [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — *"uuid: Missing
buffer bounds check in v3/v5/v6 when buf is provided"*.
**Severity:** moderate · **CVSS 3.1 7.5** · `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N` — **integrity only**,
no confidentiality or availability impact.
**Range:** `<11.1.1`. **`fixAvailable: false`.**

This closes the "unassessed" note against `uuid` in R-018. Method follows the R-002 pattern: characterise
the trigger by experiment, then argue reachability from the dependency graph — not the other way round.

## What is installed, and who uses it

| Copy | Version | Vulnerable? | Who requires it |
| --- | --- | --- | --- |
| top-level `node_modules/uuid` | **9.0.1** | **yes** | root `package.json` (`^9.0.1`) and `@solflare-wallet/sdk` (`^9.0.0`) |
| `node_modules/jayson/node_modules/uuid` | **8.3.2** | **yes** | `jayson` only |
| `node_modules/rpc-websockets/node_modules/uuid` | **14.0.2** | **no** — ≥ 11.1.1 | `rpc-websockets` only |

The app's own source **never imports `uuid`** (checked across `app/`, `lib/`, `components/`, `scripts/`).

## The trigger, measured — not assumed

The advisory is specifically about `v3`/`v5`/`v6` **when a `buf` argument is supplied**. Measured against
the installed `uuid@9.0.1` in its own process:

| Call | Result |
| --- | --- |
| `v5(name, ns)` — no buffer | returns a 36-char UUID string (the only shape any dependency uses) |
| `v5(name, ns, buf16, 0)` | writes 16 bytes correctly |
| `v5(name, ns, buf4, 0)` — **undersized buffer** | **returns the 4-byte buffer, silently truncated, no exception** |
| `v5(name, ns, buf32, 24)` — offset | writes what fits, silently truncates |
| `v4(undefined, buf, 0)` | fine — `v4` is not in the advisory's scope |
| `v1(undefined, buf, 0)` | fine — `v1` is not in the advisory's scope |

**What the defect actually is, here:** Node's `Buffer` ignores writes past its end rather than
overflowing, so the missing bounds check manifests as **silent truncation — a wrong value returned with no
error**. That is an integrity failure, which is exactly what the CVSS vector says (`I:H`, `C:N`, `A:N`).
It is *not* memory corruption in this runtime, and the earlier instinct to read "missing bounds check" as
"buffer overflow / potential RCE" would have overstated it.

## Reachability: the vulnerable functions are never called

Enumerated from the installed tree, at the call sites rather than from documentation:

| Dependent | Call site | Function |
| --- | --- | --- |
| `jayson` | `lib/generateRequest.js:3`, `lib/utils.js:6`, `lib/client/browser/index.js:3` | `require('uuid').v4` |
| `rpc-websockets` | `dist/index.cjs:374` | `uuid.v1()` |
| `@solflare-wallet/sdk` | dist bundle | `{ v4 }` |

**No `v3`, `v5` or `v6` call exists anywhere in the installed tree.** So the trigger is not reached —
not because a caller declines to pass a buffer, but because the vulnerable functions are never invoked at
all, with or without one. That is a stronger claim than "we pass no buffer", and it is the load-bearing
fact.

Note this holds for `jayson`'s own nested `uuid@8.3.2` as well: the argument is about the **call site**,
which is `v4`, not about which copy resolves.

## Conclusion

**Not reachable.** The app does not import `uuid`; every dependency that does calls `v4` or `v1`; the
advisory covers only `v3`/`v5`/`v6` with a buffer argument; and where such a call *would* go wrong the
impact is silent truncation of a caller-supplied buffer, not memory corruption. Severity in this tree is
therefore below the advisory's headline score.

## Secondary finding — the direct declaration is unused (but removing it is not remediation)

Root `package.json` declares `uuid@^9.0.1`, yet no application source imports it — the same shape as the
`zod` finding. **But unlike `zod`, removing the declaration would not remove the package or the
advisory**, because `@solflare-wallet/sdk`, `jayson` and `rpc-websockets` still require it. The
declaration is hygiene (it stops `npm audit` reporting `uuid` as a *direct* dependency of an app that does
not use it), not risk reduction. Recorded as a recommendation rather than actioned here, so this
assessment stays an assessment.

## Not verified

- **No runtime trace.** The conclusion rests on static call-site enumeration plus lockfile analysis, not
  on observing production executions. A call path introduced by a future dependency upgrade would not be
  caught by this analysis — the guard is that re-reading this entry is required if the `uuid` dependents
  change.
- **`fixAvailable: false` is not a decision.** The advisory is fixed in `uuid ≥ 11.1.1`, but no compatible
  upgrade path exists for the dependents that pin `^8`/`^9`. This entry records that the risk is
  unreachable, not that it is fixed.
