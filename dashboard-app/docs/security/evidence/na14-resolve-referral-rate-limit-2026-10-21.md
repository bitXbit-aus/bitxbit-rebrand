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

## 5. Next step

Root cause needs in-app visibility, which external probing cannot supply. The cheapest instrument is
a **temporary response header** on this one route carrying the resolved identifier, the
`RateLimitResult`, and the selected backend — one deploy, one request, then removed. Do not fix by
inference: the caching explanation was already wrong once.
