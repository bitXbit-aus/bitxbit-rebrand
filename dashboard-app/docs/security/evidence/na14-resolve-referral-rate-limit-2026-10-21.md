# NA-14 — `/api/public/resolve-referral` does not enforce its rate limit (2026-10-21)

**Status: CONFIRMED DEFECT. Root cause not yet established.** Supersedes the earlier
"cache bypasses rate-limit accounting" description, which **measurement disproved**.

Found while verifying R-004. Not part of R-004: the client identifier is correct and enforcement is
proven on other routes.

---

## 1. What is proven

**The route does not enforce.** Limit is 30 per 60 s. Every probe returned zero 429s:

| Probe | Requests | 429s |
|---|---|---|
| distinct `_rsc` per request | 38 | 0 |
| distinct `_rsc` per request | 38 (repeat) | 0 |
| distinct codes, no `_rsc` | 120 | 0 |
| distinct `_rsc`, timed (28 s) | 35 | 0 |

**No counter row is ever written for it.** Queried repeatedly, including *while the window was
live* (db_now `23:14:37`, window would expire `~23:14:5x`): no `api:resolve-referral:*` row exists,
while `api:token-stats:206.83.119.2` showed `count=38` from the same period.

**Other routes enforce at the same moment.** Same technique, same minute:

| Route | Limit | Result |
|---|---|---|
| `/api/token-stats` | 30/60 s | 30 allowed, **429 from #31** |
| `/api/wallet/rewards` | 60/60 s | 60 allowed, **429 from #61** |
| `/api/public/activity` | 60/60 s | 61 non-429, **429 from #61** |
| `/api/public/resolve-referral` | 30/60 s | **38/38 allowed, no 429** |

So the shared store is healthy; the fault is specific to this route.

**The handler provably runs.** From Netlify's own request records for six requests to one URL:

```
has_function_invocation: true    edge_cache_result: "miss"    durable_cache_result: "miss"
status_code: 404
```

It is **not cached**, and it returns its own differentiated bodies (`404 Referrer not found`,
`400 Missing referral code`) — so the handler executes on each request.

**The code is deployed.** `main`'s version calls `checkRateLimit(identifier, RESOLVE_RATE_LIMIT)`
as the first statement, with `keyPrefix: "api:resolve-referral"`, `maxRequests: 30`.

## 2. What is disproven

**Caching is not the cause.** `edge_cache_result` and `durable_cache_result` are both `miss` on
every request, and `cache-status` shows `fwd=bypass` — the response is never cached. For contrast,
`/api/public/activity` *is* edge-cached (`"Netlify Edge"; hit; ttl=17`) and still enforces, because
varying `_rsc` forces a miss.

**A global store outage is not the cause.** The other three routes enforced at their exact limits
within the same minute.

## 3. Leading hypothesis (UNPROVEN)

`SupabaseRateLimitStore.increment` wraps the RPC in `try/catch` and on **any** error falls back to
an in-process `MemoryRateLimitStore`. Per-instance counting would produce exactly this signature:
no table rows, and 35–120 requests spread across instances never reaching a threshold of 30.

The mechanism of the RPC failure is **not established**. It is not a global failure and not a
constraint on the key (`api:token-stats:206.83.119.2` is structurally identical and works).

## 4. Why this matters more than the route

The fallback is documented as "loud": it calls `console.error`. **That output is not observable.**
Netlify's request logs return `logs: []` even for requests with `has_function_invocation: true`, and
a `LogText` filter returns nothing. So a degraded rate-limit store is **undetectable in production**
— the same failure mode R-004 was created to eliminate, now in the degradation path itself.

A control that cannot report its own degradation is indistinguishable from a working one. That is
worth fixing independently of this route.

## 5. ROOT CAUSE (2026-10-21) — the rate-limit result is served STALE

An instrumented deploy (PR #18, gated on `?na14=1`, since removed) reported the backend, the
identifier, the store's own result, and a **direct** `check_rate_limit` call. Its first reading:

```
backend:      "supabase"                              <- correct backend, not memory
identifier:   "206.83.119.2"                          <- correct client
storeResult:  { allowed: true, remaining: 29, resetAt: 1792626523386 }
directRpc:    { data: { allowed: true, remaining: 2 }, error: null }   <- the RPC works
```

So nothing is degrading silently: the backend is right, the identifier is right, and the RPC
succeeds. But every subsequent request returned **byte-identical** values — the same `resetAt` to the
millisecond — and so did the direct RPC probe.

**The decisive measurement.** After letting the 60 s window expire:

```
store: resetAt=1792626523386   delta vs now = -82.5 s   remaining=29
rpc:   resetAt=1792626525277   delta vs now = -80.6 s   remaining=2
```

A fresh execution would report `resetAt` roughly **+60 s** ahead. Reporting it **82.5 s in the past**
means the body was produced 140 s earlier and is being **replayed**. Confirmed in the database: both
keys were written **once** and never advanced —

```
api:resolve-referral:206.83.119.2   count=1   window_started_at 23:47:43
probe:na14:direct                   count=1   window_started_at 23:47:45
db_now 23:48:46      (~10 further requests in between, none of which incremented)
```

**Mechanism:** the first call executed and wrote the row; every later call returned the first call's
result without touching the database. The counter therefore never advances, so the limit can never
trip — which is exactly the observed behaviour.

**Ruled out, each by measurement:** caching at the edge (request records show
`has_function_invocation: true` with `edge_cache_result` and `durable_cache_result` both `miss`, and
the *function* produced the stale body); a silent store failure (the RPC returns `error: null`); the
wrong backend (`supabase`); a wrong identifier (`206.83.119.2`); a stale or altered RPC (the deployed
function is byte-identical to migration `027`, single 3-arg signature, `SECURITY DEFINER`).

## 6. What is still not established

1. **Which cache layer replays the result.** The app's Supabase client
   (`lib/supabase/service.ts`) passes no custom `fetch`, so it inherits Next.js's patched `fetch` —
   the leading candidate, but not proven.
2. **Why only this route.** `/api/token-stats`, `/api/wallet/rewards` and `/api/public/*` all
   enforced at their exact limits in the same minute. The discriminator is not `force-dynamic`
   (`/api/public/*` has it and enforces) and not the key shape
   (`api:token-stats:206.83.119.2` is structurally identical to this route's key).

Until (1) is pinned, any fix is a guess — and guessing is what produced the disproven caching
explanation earlier. **A fix must be validated by outcome:** the counter advancing *and* a `429` at
the limit on this specific route.
