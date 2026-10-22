# NA-15 — a degraded rate-limit store is now able to report its own degradation

**Date:** 2026-10-21 · **Status:** FIXED AND VERIFIED · **Risk:** R-004 · **Code:** PR #23,
`main` = `2ff743efc1a9ac9b629cca738a7325b4ce421197`

## 1. The defect

Two paths degrade the limiter, and **both reported only through `console.error`**:

1. **Nothing shared is configured** — `createStore` selects `MemoryRateLimitStore`, so limits
   apply per serverless instance and are not shared.
2. **The shared store fails at runtime** — `SupabaseRateLimitStore` catches the error and falls
   back to a per-instance check.

Netlify's request logs return `logs: []` even for requests with
`has_function_invocation: true`, and a `LogText` filter returns nothing. So neither degradation
was observable in production. A limiter that had silently become per-instance was
indistinguishable, from outside, from one enforcing shared limits — the failure mode R-004
existed to remove, sitting inside R-004's own degradation path.

## 2. What was built

- **`lib/rate-limit-health.ts`** — a degradation registry: typed reason, running count,
  timestamp, and a **pure** composer (`buildRateLimitHealth`) so the decision logic is testable
  without a Next.js runtime. Reasons are distinct, because they call for different responses:
  `no-shared-store`, `store-unavailable`, `invalid-payload`.
- **`GET /api/health/rate-limit`** — the queryable surface. **503 when degraded**, 200 when
  healthy, `cache-control: no-store`, and an `x-ratelimit-degraded` header.
- **The 429 path** carries `x-ratelimit-degraded`, so a rejection states whether the store
  behind it is healthy.
- **`RateLimitPayloadError`** separates "the store is unreachable" from "the store is returning
  nonsense".

No credentials are exposed and **no raw error text** — a Supabase error message can carry the
project URL, and this route is unauthenticated.

## 3. The degraded branch, executed rather than asserted

Production is healthy, so the degraded branch cannot be observed there. Rather than claim it
works because a unit test passes, the **real route file** was compiled to CJS and invoked
directly under Node, with the shared store deliberately unconfigured:

```
=== REAL route, NO shared store configured ===
  status : 503
    cache-control: no-store, max-age=0
    x-ratelimit-degraded: true
  body   : {"status":"degraded","degraded":true,"shared":false,"backend":"memory",
            "degradedCount":0,"lastDegradedAt":null,"lastReason":"no-shared-store",...}
=== 429 path (rateLimitResponse) ===
  status : 429
    retry-after: 30
    x-ratelimit-degraded: true

=== REAL route, shared store configured ===
  status : 200
    cache-control: no-store, max-age=0
    x-ratelimit-degraded: false
  body   : {"status":"ok","degraded":false,"shared":true,"backend":"supabase",...}
=== 429 path (rateLimitResponse) ===
  x-ratelimit-degraded: false
```

Two consecutive calls returned different `checkedAt` values, confirming the diagnostic is not
itself cached — NA-14's failure mode in a new place.

## 4. A bug found by executing it, not by testing it

The 429 header originally keyed on `degradedCount > 0` alone. Executing the real route showed it
returning **`x-ratelimit-degraded: false`** on a deployment with **no shared store configured** —
a 429 from a per-instance limiter claiming to be healthy, on the exact deployment the header
exists to warn about. It now composes through `buildRateLimitHealth`. Two tests cover it, and
mutation **M8** proves they can fail.

This is the second time in this investigation that running the code found what reasoning about it
did not.

## 5. Verified live (production, deploy `2ff743ef`)

```
GET /api/health/rate-limit
  http=200   x-ratelimit-degraded: false   cache-control: no-store,max-age=0
  {"status":"ok","degraded":false,"shared":true,"backend":"supabase",
   "degradedCount":0,"lastDegradedAt":null,"lastReason":null}

  call 1 checkedAt 1792630303470
  call 2 checkedAt 1792630304354     -> distinct, so not cached

after driving real traffic through /api/token-stats and /api/public/activity:
  degraded: false   degradedCount: 0   lastReason: null      -> no false positive

real 429 from /api/public/resolve-referral (30/60 s, first at request #30):
  retry-after: 18
  x-ratelimit-degraded: false
```

## 6. What was NOT verified, and why

**A genuinely degraded store reporting `degraded: true` in production was not observed.** It
cannot be: production has Supabase configured, so the store is not degraded. The degraded branch
was executed against the real route file locally (§3) and covered by mutation-tested units — it
was not observed in the deployed environment.

## 7. Known limitation, stated rather than hidden

The registry is **per-process**, and a serverless deployment has many. A probe therefore observes
the instance that served it. That is adequate because the dominant failure modes are global — a
missing configuration affects every instance identically, and a shared-store outage affects all at
once — but a transient failure on one instance can still be missed by a single probe. This is why
the surface reports a running count and a timestamp rather than a bare boolean: repeated probes
accumulate evidence.

It is **not** a substitute for monitoring the positive signal — counter rows advancing in
`rate_limit_counters` — which remains the stronger check.

## 8. Note for monitoring

This is a **control-health** probe, not a site-liveness probe. It returns 503 when the limiter is
degraded, deliberately: an endpoint whose purpose is to raise the alarm must not answer 200 while
the control is broken. Point general uptime monitors at a different path so a degraded limiter
does not read as an outage.

## 9. Test and mutation evidence

**125/125** tests pass (+16 for this change). **8/8 mutations detected**, baseline and restore both
clean:

| Mutation | Effect | Detected by |
|---|---|---|
| M1 | stop recording the memory-backend degradation | store-selection suite |
| M2 | collapse the two runtime reasons | NA-15 store suite |
| M3 | stop recording runtime fallbacks | NA-15 store suite |
| M4 | ignore configuration-level degradation | composer + store selection |
| M5 | pin the status to 200 | composer |
| M6 | drop the default reason | composer |
| M7 | count only the first failure | registry + store suite |
| M8 | revert the 429 composition | store-selection suite |

M7 matters beyond coverage: the **log** is throttled to one per interval, but the **count** must
not be, or the registry would understate how much traffic ran on the fallback.
