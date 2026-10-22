# NA-14 — the layer, pinned: Next.js caches a POST fetch by default (2026-10-22)

**Status: SETTLED.** Supersedes NA-14 §6's mechanism in part and NA-16 §4's
"not a general mechanism" conclusion. NA-14's *fix* is unchanged and correct.

**Risk:** NA-14 · **Method:** NA-16's upstream-request counting, plus payload progression.

---

## 1. The question

NA-14 recorded the mechanism as "Next.js's patched `fetch` caching the Supabase
client's request". NA-16 measured `lib/supabase/server.ts` (the **anon**
`@supabase/ssr` client) and found **no** caching, GET or POST, and concluded the
recorded mechanism "does not hold" as a general statement.

NA-16 explicitly left the object it did **not** test on the table (§5): the
**service-role** client (`createServiceClient`, `@supabase/supabase-js`), which
was NA-14's actual subject. So the layer was still unpinned.

## 2. Method

A local **production** build (`next build` + `next start`, **Next 14.2.35** — the
lockfile version) pointed at the **staging** Supabase project
(`luqrwhgjtiyfmeawbtmp`, migration 027), calling the real `check_rate_limit` RPC.

A temporary probe route compared seven channels. Each channel used **its own**
probe key, reused across **6 calls** (3 HTTP requests x 2 calls), so a replayed
response is observable as a frozen `remaining`.

Two independent measurements, as NA-16 requires:

1. **Payload progression** — `remaining` frozen vs advancing.
2. **Upstream request counts in Supabase's own edge logs** — one channel per
   window, so each count is attributable to a single channel.

| Channel | Construction |
|---|---|
| `legacy` | `createClient()` with **no** fetch override (pre-NA-14-fix) |
| `fixed` | `createServiceClient()` — the shipped fix |
| `rawDefault` | raw `fetch` POST, **no** `cache` option |
| `rawNoStore` | raw `fetch` POST, `cache: "no-store"` |
| `rawForceCache` | raw `fetch` POST, `cache: "force-cache"` — **POSITIVE CONTROL** |
| `rawDefaultCookies` | `cookies()` read, then raw `fetch` POST, no `cache` option |
| `legacyCookies` | `cookies()` read, then `createClient()`, no fetch override |

## 3. Results

| Channel | `remaining` over 6 calls | Upstream requests | Verdict |
|---|---|---|---|
| `legacy` | 29,29,29,29,29,29 | **1** | **FROZEN** |
| `rawDefault` | 29,29,29,29,29,29 | **1** | **FROZEN** |
| `rawForceCache` (control) | 29,29,29,29,29,29 | **1** | **FROZEN — control works ✓** |
| `fixed` | 29,28,27,26,25,24 | **6** | 1:1 — uncached |
| `rawNoStore` | 29,28,27,26,25,24 | 5 | 1:1 — uncached |
| `rawDefaultCookies` | 29,28,27,26,25,24 | **6** | 1:1 — uncached |
| `legacyCookies` | 29,28,27,26,25,24 | 5 | 1:1 — uncached |

The positive control is served from cache, so the method demonstrably *can*
detect caching — a negative result would have been worthless without it.

(5 vs 6 on two rows is window-boundary attribution in the log query, not a
caching effect; the 1-vs-5/6 contrast is unambiguous.)

**The freeze is not specific to the Supabase client.** A plain raw `fetch` with
no `cache` option froze identically to `createClient()`.

## 4. Mechanism

`next/dist/server/lib/patch-fetch.js` (14.2.35):

```js
const isUnCacheableMethod = !["get", "head"].includes(init.method);   // POST => true
const autoNoCache = (hasUnCacheableHeader || isUnCacheableMethod)
                    && staticGenerationStore.revalidate === 0;
...
if (typeof revalidate === "undefined") {
  ...
  else if (autoNoCache) { revalidate = 0; cacheReason = "auto no cache"; }
  ...
  else {
    cacheReason = "auto cache";
    revalidate = typeof staticGenerationStore.revalidate === "boolean"
              || typeof staticGenerationStore.revalidate === "undefined"
                 ? false : staticGenerationStore.revalidate;
  }
}
```

A non-GET fetch that carries no `cache`/`revalidate` of its own is only protected
when the route is **already dynamic** (`staticGenerationStore.revalidate === 0`)
*at the moment of the fetch*. Otherwise it falls through to `"auto cache"` with
**`revalidate = false`** — cached indefinitely, keyed on the request.

**`export const dynamic = "force-dynamic"` does not protect the fetch.** The probe
route carried it and still froze.

`createServiceClient()` issued its RPC with no `cache` option, so the first
`check_rate_limit` response was cached with `revalidate = false` and replayed on
every subsequent call. The counter never advanced, so the limit could never trip
— precisely NA-14's observed signature (row written once, `resetAt` 82.5 s stale).

## 5. Why NA-16 measured the opposite

NA-16's instrument read through `lib/supabase/server.ts`, whose construction
reads `cookies()`. **Reading cookies marks the route dynamic (`revalidate = 0`),
which switches on the `autoNoCache` escape** — so its POSTs were never cached.

Demonstrated directly: inserting a single `cookies()` read before the *same* raw
POST flipped it from FROZEN (1 upstream / 6 calls) to 1:1 (6 upstream / 6 calls),
and did the same for the `createClient()` path (`legacyCookies`).

So:

- NA-14's recorded **layer** (the patched fetch) was right; its wording ("the
  Supabase client's request") was too narrow — it is *any* uncached-by-default
  fetch in that route.
- NA-16's negative result is **explained**, not contradicted: it measured a
  client whose own construction disables the cache.
- NA-16's operational conclusion — `lib/supabase/server.ts` is not affected —
  **still holds**, and now for a demonstrable reason rather than by absence of
  evidence.

## 6. Consequence for the fix

Forcing `cache: "no-store"` on the service client's fetch (NA-14, PR #21) is
correct and remains necessary. The rationale is sharpened: the danger is not
that Next caches *Supabase* requests specifically, but that **Next caches any
non-GET fetch by default unless the route is already dynamic**. Any POST/RPC
through a client that does not force `no-store` can be replayed — a security
control that silently stops counting.

## 7. Still open

NA-14 §8 — why `/api/token-stats`, `/api/wallet/rewards` and `/api/public/*`
enforced while `/api/public/resolve-referral` did not — is **not** settled by
this experiment. None of the sibling routes obviously reads `cookies()` before
its limiter, so the `autoNoCache` discriminator does not by itself explain them.
Recorded as measured-and-unexplained rather than folded into the mechanism.

## 8. Reproduce

```bash
# Build + run locally against STAGING (never production).
# The probe route was temporary and is not committed.
npx next build && npx next start -p 3999
for ch in legacy fixed rawDefault rawNoStore rawForceCache rawDefaultCookies legacyCookies; do
  curl -s -H "Host: app.bitxbit.com.au" \
    "http://localhost:3999/api/na14probe?channel=$ch&n=2&tag=run" | head -c 300; echo
done
# Ground truth: count upstream POSTs in Supabase edge logs for the window.
```
