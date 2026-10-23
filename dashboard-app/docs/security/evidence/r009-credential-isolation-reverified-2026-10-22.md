# R-009 — credential isolation re-verified, and a variable the original audit missed (2026-10-22)

**Status:** the preview/branch-deploy exposure path is **verified closed**. One additional
shared secret was found and closed. Three items are recorded rather than fixed.

Re-verification was performed independently rather than by reading the register's own claims —
the session had already produced three instances of recorded prose outliving its evidence.

---

## 1. Re-scoping — verified by measurement

Every value was fetched per context and compared by sha256 (never printed). "Isolated" means
the `deploy-preview` / `branch-deploy` value **differs from production**.

| Variable | production | preview / branch-deploy | Isolated? |
|---|---|---|---|
| `AIRDROP_WALLET_PRIVATE_KEY` | `bb55ac25db` | `0732bdc1af` | **yes** |
| `SUPABASE_SERVICE_ROLE_KEY` | `459ae3dc9f` | `14eaa80ac7` | **yes** |
| `NEXT_PUBLIC_SUPABASE_URL` | `2ceee78631` | `a35c9ee633` | **yes** |
| `BITXBIT_TOKEN_MINT` | `47cfeefde1` | `46533acd5a` | **yes** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `c26787289b` | `05709071c2` | **yes** |
| `SOLANA_RPC_URL` | *(unset)* | `3d423a3cdf` | **yes** |

Decoded, the non-secret preview values confirm the intended targets:

| Preview value | Resolves to |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://luqrwhgjtiyfmeawbtmp.supabase.co` — **staging** |
| `BITXBIT_TOKEN_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` — **devnet** |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` — **devnet, explicitly pinned** |

So previews execute with a staging database, a devnet mint and a devnet RPC — the critical
path from "push a branch" to "sign with the treasury key" is closed.

## 2. NEW FINDING — `BIRDEYE_API_KEY` was still shared across all three contexts

The original audit's table enumerated **five** variables. It missed a sixth:

| Variable | Before | Significance |
|---|---|---|
| `BIRDEYE_API_KEY` | **identical** in `production`, `deploy-preview`, `branch-deploy` (`4faa22abd2`) | a real third-party API credential, reachable from arbitrary branch code |

`app/api/token-stats/route.ts:6` reads it and sends it as `X-API-KEY` to Birdeye. Because it sat
in the preview and branch-deploy runtime, **any branch pushed to the public repo could read and
exfiltrate it** — the same defect class as R-009, on a lower-impact credential.

**Fixed 2026-10-22:** unset from `deploy-preview` and `branch-deploy` only.

| Context | Before | After |
|---|---|---|
| `production` | `4faa22abd2` | `4faa22abd2` *(unchanged)* |
| `deploy-preview` | `4faa22abd2` | **unset** |
| `branch-deploy` | `4faa22abd2` | **unset** |

**Why removal rather than a staging value:** previews are devnet-scoped
(`BITXBIT_TOKEN_MINT` = devnet mint), and Birdeye serves **mainnet** token data. The key was
therefore *useless* on previews as well as exposed — it could never return data for the devnet
mint. The route degrades gracefully: `route.ts:106-108` records `"BIRDEYE_API_KEY not configured"`
in `stats.errors` and falls through to the keyless Dexscreener fallback at `route.ts:110`. The
D4 harness asserts only that `/api/token-stats` returns **200** (`staging-smoke-test.ts:560-567`)
and does not assert `stats.errors` is empty, so the change does not weaken D4.

## 2b. Deployed verification of the `BIRDEYE_API_KEY` removal

Measured on real preview deploys, not inferred from the code:

| Check | dp37 *(key present)* | dp38 *(key removed)* |
|---|---|---|
| `/api/token-stats` status | **200** | **200** |
| `errors` | `[]` | `["BIRDEYE_API_KEY not configured", "RPC holder count failed"]` |
| `holders` | `0` | `null` |
| `price` / `liquidity` | `null` / `null` | `null` / `null` |
| D4 harness | — | **all 6 checks pass**, incl. `public API health and rate-limit headers` |

**A finding worth recording.** The preview endpoint was already returning **meaningless** data: for
the devnet mint (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, the standard devnet USDC mint),
`price` and `liquidity` were `null` and `holders` was **`0`** — a Birdeye mainnet lookup against a
devnet mint. `0` reads like real data; `null` plus an explicit reason is more honest. The removal
therefore improves legibility rather than removing working functionality.

**`RPC holder count failed` is pre-existing, not introduced here.** `route.ts:139-146` counts
holders via Solana RPC whenever `stats.holders` is still `null` — independent of Birdeye. On dp37
that path was skipped only because Birdeye had supplied the (meaningless) `0`.

**Harness-invocation note:** the D4 wrapper reads `D4_APP_URL`, *not* `STAGING_APP_URL`; passing the
latter silently ran the suite against the default `deploy-preview-31`. The first run was therefore
invalid and was re-run with the correct variable. Recorded because a harness that reports green
against the wrong target is the same class of defect as a harness that asserts nothing.

## 3. `NEXT_PUBLIC_APP_URL` — reclassified, not a credential exposure

The register lists it as scoped `all`. It is **identical** across contexts, and that is
**deliberate**:

```
// app/auth/callback/route.ts:15
// Always redirect to the canonical app URL, not the origin of the magic link.
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin;
```

It is a `NEXT_PUBLIC_*` value, so it is **compiled into the client bundle and public by design** —
it carries no secret. Its significance is functional (preview auth flows redirect to the canonical
production URL), not a credential leak. **Reclassified: not part of the credential-exposure
surface.** The register's table should not imply otherwise.

## 4. Recorded, not fixed

**a. The `dev` context points at the production Supabase project.**
`dev` carries `NEXT_PUBLIC_SUPABASE_URL` = `https://flasgvendiiasuixeqzu.supabase.co` (**production**)
— identical to the production value — while its `SUPABASE_SERVICE_ROLE_KEY` (`11dab2ce7f`)
**differs** from production's (`459ae3dc9f`). So a `netlify dev` session resolves to the production
project with a key that is not production's. That is a configuration inconsistency rather than an
exposure: the mismatched key will not authenticate. It is recorded because it is the kind of
half-migrated context that produces confusing failures. Its `AIRDROP_WALLET_PRIVATE_KEY`
(`79071e29aa`) and `BIRDEYE_API_KEY` (`a501505650`) both differ from production — so `dev` was
partly scoped by the original remediation, and this one variable was left behind.

**b. The legacy `service_role` key deactivation could not be verified.**
The register's NA-8 row states the legacy `service_role` key was deactivated. The Supabase MCP
surface exposes only publishable and legacy-**anon** keys — there is no secret-key listing — so
this claim was **not independently confirmed**. It is carried forward as the register's claim,
not as a measurement.

**c. Rotation is consistent with, but not proven by, the current state.**
The register states the treasury key and service-role key were both rotated on 2026-10-19 (the
treasury key verified on-chain and by a real production airdrop; the service key verified by use).
What this work independently confirms is that the **current** production values differ from the
preview values. That is consistent with rotation but does **not** prove the previously-exposed
values are retired.

## 5. What remains for the owner

**`is_secret` (R-010 / NA-9)** — deferred by the owner. It is the one item the register already
identified as the remaining blocker to closing R-009. Note the constraint recorded in the skill:
flagging is **irreversible**, secrets cannot carry the `post_processing` scope, and `NEXT_PUBLIC_*`
must never be flagged secret.

**R-010's own text** should be read before acting, since a secret marked secret can be masked
inside functions on branch deploys — the exact context D4 depends on.
