# NA-16 — `lib/supabase/server.ts` does not share NA-14's fetch-caching flaw

**Date:** 2026-10-22 · **Status:** MEASURED, NOT AFFECTED — no fix needed
**Risk:** NA-14 · **Instrument:** PR #24 / #27, removed in this change

## 1. The question

NA-14 fixed a rate limiter whose store path was served a **replayed** result, and recorded the
cause as "Next.js's patched `fetch` caching the Supabase client's request". `lib/supabase/server.ts`
builds a server-side client the same way, and is used by **25 files** — admin and dashboard pages,
`lib/authz.ts`, and `lib/actions.ts`, which drives mutating RPCs (reward approval, payout
finalization, reward calculation). If it shared the flaw, every server-side read could serve stale
data and a mutation could silently not happen.

It was deliberately **not** patched on suspicion. It was measured.

## 2. Method

A temporary instrument read through the **real** server client (`createClient()` from
`@/lib/supabase/server`) and issued a **raw** `fetch` with `cache: "force-cache"` as a **positive
control**. The app was never asked to report on itself: ground truth is **Supabase's own edge logs**,
which record every `/rest/v1/` request with method, path and `x_client_info` — the SSR client
identifies itself as `supabase-ssr/0.1.0`.

The check is whether the upstream request count scales with the number of app requests (not cached)
or stays flat (cached).

**Why the control matters:** a negative result is worthless unless the method can produce a
positive. Without it, "10 requests reached Supabase" could mean "not cached" or "the counting is
broken".

## 3. The measurement

Five app requests, each issuing two reads and two RPC posts:

| Path | Client | Upstream requests | Expected if uncached | Verdict |
|---|---|---|---|---|
| `GET /rest/v1/users?select=id&limit=1` | `supabase-ssr/0.1.0` | **10** | 10 | **1:1 — not cached** |
| `POST /rest/v1/rpc/is_admin` | `supabase-ssr/0.1.0` | **10** | 10 | **1:1 — not cached** |
| `GET /rest/v1/users?select=id&limit=2` (**control**, `force-cache`) | — (raw fetch) | **1** | 5 if cached | **cached ✓** |

The control's `date` header was also frozen at `Thu, 22 Oct 2026 01:27:01 GMT` across six
consecutive calls, independently confirming that it was served from cache.

**Conclusion: `lib/supabase/server.ts` does not share NA-14's flaw.** Reads and RPC POSTs both reach
Supabase on every call, while a fetch that should be cached demonstrably is.

The POST case was measured deliberately: `lib/actions.ts` drives mutating RPCs through this client,
and a cached POST there would mean a mutation silently not happening — the same shape as NA-14's
anomaly, which was also a POST. `is_admin(user_id)` was used as a safe stand-in: it is
anon-executable, returns 200 and mutates nothing. What matters is whether the request is *issued*,
which the edge logs count.

## 4. Side finding — NA-14's recorded mechanism does not hold

Inspecting what each library passes to `fetch` shows that **neither** `@supabase/supabase-js` nor
`@supabase/ssr` passes a `cache` or `next` option for a read. And NA-16's measurement shows the same
Next.js runtime does **not** cache a Supabase client request — GET *or* POST.

So "Next.js's patched `fetch` caches the Supabase client's requests" is **not a general mechanism**, and NA-14's row has been corrected accordingly.

**Correction (2026-10-22) — this conclusion is wrong, and the negative result is
explained by this measurement's own setup.** Next.js's patched `fetch` *does* cache
a non-GET request by default, with `revalidate = false`, unless the route is
*already* dynamic (`staticGenerationStore.revalidate === 0`) at the moment of the
fetch. The client measured here, `lib/supabase/server.ts`, reads `cookies()` when it
is constructed — which marks the route dynamic and switches on the `autoNoCache`
escape. Its POSTs were therefore never cacheable, so 1:1 was the *expected* result
and says nothing about the mechanism in general.

The operational conclusion in §3 below — that `lib/supabase/server.ts` is not
affected — **still holds**, now for a demonstrable reason rather than by absence of
evidence. NA-14's recorded *layer* (the patched `fetch`) was correct; only its
wording was too narrow. Evidence: `na14-mechanism-pinned-2026-10-22.md`.

What remains true about NA-14: the freeze was **real**, not an artifact. Only **2** upstream
`check_rate_limit` requests reached Supabase across ~10 app requests in the failing window, so the
result genuinely was replayed rather than recomputed. **Which layer replayed it was never pinned** —
fetch layer versus route/edge layer. NA-14's fix (`cache: "no-store"` on the service client's fetch)
is verified by outcome and stands regardless: the counter advances and the limit rejects at 30/60 s.

## 5. Scope and limitations

- Measured against an **anon** read and an **anon** RPC. That is the server client's normal
  privilege level; the service-role client is a different object (and was NA-14's subject).
- Measured on one route. The client, the runtime and the fetch patch are the same everywhere, so
  this is expected to generalise — but it is one route's evidence, not every route's.
- The instrument was removed in the same change that recorded this.

## 6. What was NOT done

No change to `lib/supabase/server.ts`. The measurement found no defect, so patching it would have
been a change made on suspicion — the exact failure this investigation has already paid for twice.
