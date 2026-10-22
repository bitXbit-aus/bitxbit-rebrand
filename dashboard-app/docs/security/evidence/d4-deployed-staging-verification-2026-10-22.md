# D4 — deployed staging HTTP test, re-verified (2026-10-22)

**Decision D4:** *"A deployed Netlify staging HTTP test is mandatory, on a deployment
configured exclusively for staging Supabase and Solana devnet, verifying that no
production credentials or resources are involved."*

**Status: SATISFIED — verified against 34 live preview deployments, 2026-10-22.**
With one correction to the register and one defect fixed in the D4 harness itself.

---

## 1. Register correction — D4 was already satisfied on 2026-10-19

The register's **"D4 status"** section says *"D4 is now satisfiable in configuration,
but NOT yet proven in a deployment"*, and its table marks all four requirements
*"(unverified in a deploy)"*.

That section is **stale**. `evidence/phase-1-staging-rehearsal-2026-10-19.md` §"D4 —
deployed-app HTTP test — SATISFIED" records the test running against preview deploy
`6ad6a1fddbd521239c086a6a` (commit `bdbdf003`), and the same document's §"R-009 residue
closed" records the seven production-wired previews being deleted. The status section
was simply never updated — the same class of defect as the R-009/R-013 summary
contradictions.

Both sections now agree. The re-verification below was still worth doing, because
**34 preview deploys have been created since that run** and none of them were covered
by it.

## 2. What was verified today

### 2.1 Every preview deploy is staging-scoped — 34/34

Each deploy was probed at `/api/token-stats`, which reports the configured token mint.
Devnet `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` = staging-scoped.
Mainnet `DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5` = a production leak.

| Result | Count |
|---|---|
| Staging-scoped (devnet) | **34** |
| **Production-wired** | **0** |
| Inconclusive | **0** |

Range covered: `2026-10-19T23:04` (`security/phase-1-hardening` — the original D4
deploy) through `2026-10-22T03:28` (`security/r006-request-size-limits` — the newest).
Immutable per-deploy URLs were sampled at both ends and were also staging-scoped.

This matters because the R-009 residue on 2026-10-19 was exactly a *stale preview*
problem: Netlify serves each deploy at its own immutable URL, so a preview built before
the credential re-scoping stayed reachable. Every deploy built since has been checked.

### 2.2 Isolation proven at the bundle level, with a positive control

The `/auth/login` page's 15 client chunks were fetched from the preview and scanned for
both Supabase project refs:

| Target | production ref | staging ref |
|---|---|---|
| **Preview** | **0** | 1 |
| **Production** (positive control) | **1** | 0 |

The control matters: it proves the scan *can* detect a production reference. Without it
the preview's zero would be worthless. The preview's bundle contains the staging project
and no occurrence of the production project.

### 2.3 Isolation proven at the data level

| | `/api/public/offers` |
|---|---|
| Preview | `{"offers":[]}` |
| Production | `{"offers":[{"name":"KAST", …}]}` |

The preview's empty result is **not** an absence of evidence: querying staging's
`affiliate_offers` table directly returns `[]`, while production holds `KAST`. The
deployed preview matches staging exactly and differs from production — the strongest
available signal that it reads a different database.

*(On 2026-10-19 this endpoint returned "Staging Smoke Offer"; that row has since been
removed from staging, which is why the response is now empty.)*

### 2.4 The D4 harness ran against the deployed preview

```
✓ atomic reward approval
✓ wallet verification challenge lifecycle
✓ trusted offer click deduplication
✓ payout operation atomic creation and rejection
✓ payout operation rejects stale rewards and mismatches
  rate-limit store healthy (backend: supabase)
✓ public API health and rate-limit headers
All staging smoke tests passed.
```

Run as `npm run test:staging` with `STAGING_APP_URL` pointing at the preview. All five
endpoints D4 names return **HTTP 200**.

### 2.5 Bonus — the rate limiter enforces on a deployed environment

Not part of D4's isolation question, but reachable on the preview and worth recording:
driving `/api/public/resolve-referral` past its 30/60 s limit produced

- **first 429 at request #31** (30 allowed), matching the R-004 closure note
- `retry-after: 22`, `x-ratelimit-degraded: false`, `cache-control: no-cache`
- body `{"error":"Too many requests. Please try again later."}` — legible, no credentials

This is R-004/NA-14 enforcement observed **in a deployment** rather than locally.

## 3. Defect found and fixed — the harness was asserting nothing

`scripts/staging-smoke-test.ts` had a section named **"public API health and rate-limit
headers"** whose rate-limit check was an **empty branch**:

```ts
if (!res.headers.get("x-ratelimit-limit")) {
  // Not a failure; headers are optional depending on implementation.
}
```

It could never fail, and the three endpoints it inspected are not rate limited at all,
so no such header was ever present. The section name promised a control the code did not
check. The 2026-10-19 evidence doc recorded this honestly; it is now **fixed** rather
than merely noted.

The assertion moved to where a rate-limit signal actually exists — `/api/health/rate-limit`
(NA-15's route), which must return 200, must report `x-ratelimit-degraded: false` in both
header and body, and must not be cached.

**Mutation-tested: 3/3 detected**, each failing with its intended message:

| Mutation | Failure |
|---|---|
| Invert the degraded expectation | `rate-limit store degraded (x-ratelimit-degraded=false)` |
| Require a status that never occurs | `/api/health/rate-limit returned 200 — the shared rate-limit store is degraded` |
| Demand caching | `rate-limit health response must not be cached` |

## 4. Verification

- `npx tsc -p tsconfig.json --noEmit` — clean
- `npm test` — **158/158**
- `npm run test:staging` against the deployed preview — **all sections pass**
- D4 harness mutation test — **3/3 detected**

## 5. Limitations — stated, not glossed

- **D4 proves staging isolation; it does not verify the R-005 or R-006 controls.** Those
  are Server-Action controls behind authentication and are untouched by this test. They
  remain "implemented and tested — not verified in a deployment".
- **The devnet-mint probe reads environment configuration**, not the database. It is
  paired here with the bundle scan and the data comparison precisely because a single
  signal would not be sufficient.
- **The 34-deploy sweep checked the branch-alias URL of every preview** and sampled
  immutable URLs at both ends rather than sweeping all of them individually.
- **No production resources were touched.** Every request in this verification went to
  preview deployments or the staging database.
- The staging preview remains reachable and staging-scoped; this document does not
  claim anything about previews created after 2026-10-22.
