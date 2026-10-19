# Rate-limit store: R-004 remediation and atomicity evidence

**Date:** October 19, 2026
**Change:** `security/rate-limit-fallback-visibility` (PR #5), migration `027`
**Scope:** replaces the per-instance in-memory rate-limit fallback with a shared, atomic Postgres counter.

---

## 1. The defect

`getRateLimitStore()` selected Upstash **only** when `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` were both set, and otherwise silently used an in-process `Map`. Neither
variable is configured (site or team level), so **in production every instance limited requests
independently**. An attacker spreading requests across instances received a multiple of the intended
allowance, and the fallback logged nothing — which is why this remained "unconfirmed" rather than
known.

## 2. Why Netlify Blobs was rejected

The obvious "no third-party account" option is Blobs, already part of the platform. It is the wrong
tool, and Netlify says so explicitly:

> *"**Do NOT build counters, balances, or read-modify-write logic on a blob key** — even with
> `onlyIfMatch` retries. That is transactional data; use Netlify DB."*
> *"This isn't a soft preference."*

Three independent blockers:

1. **Default consistency is eventual** — updates propagate to edge locations within **60 seconds**,
   while a rate-limit window is measured in seconds.
2. **No transactions.** The only concurrency controls are `onlyIfMatch` / `onlyIfNew`, which Netlify
   rules out for counters by name.
3. **A live SDK defect** ([netlify/primitives#741](https://github.com/netlify/primitives/issues/741)):
   conditional writes return `{ modified: true }` for *every* non-412 failure, including a 503 after
   retries are exhausted. A CAS loop would believe it incremented when nothing was written — a silent
   lost write on precisely the code path the counter would need.

A Blobs-backed counter would therefore have passed a single-instance test while over-allocating under
concurrency: a control that *appears* to work, which is worse than one that admits it does not.

## 3. What was built

| Artifact | Role |
|---|---|
| `supabase/migrations/027_shared_rate_limit_counter.sql` | `rate_limit_counters` table + `check_rate_limit()` RPC |
| `lib/rate-limit-supabase.ts` | store implementation; validates every payload, degrades on failure |
| `lib/rate-limit.ts` | `resolveRateLimitBackend()` — Supabase → Upstash → memory |

**Atomicity:** one statement, `INSERT … ON CONFLICT DO UPDATE … RETURNING`. Concurrent sessions
serialise on the row lock and the loser re-evaluates against the committed row.

**Semantics:** fixed window anchored to the first request, matching the Redis store it replaces, plus
bounded probabilistic reaping so the table cannot grow without limit.

**Failure behaviour:** any RPC error — or an unparseable payload — routes to a per-instance fallback
and is logged (at most once a minute). It is **never** treated as "allowed": a bug that silently
permitted traffic would be indistinguishable from a working limiter.

**Privileges:** `SECURITY DEFINER` with `search_path` pinned; RLS enabled with no policies; table
access revoked from `PUBLIC`, `anon`, `authenticated`; `EXECUTE` granted to `service_role` only.

## 4. Proof of atomicity

A single-instance test cannot detect a lost update, so both runs issue concurrent calls from
**independent database sessions** and compare the final counter against the number of calls that
actually succeeded.

### Local Postgres (migration replay)

```
rate-limit atomicity test passed (30 concurrent calls, exactly 10 allowed, counter=30, privileges locked down)
```
`npm run test:migration` exit 0; all four concurrency tests pass.

### Staging Supabase (`luqrwhgjtiyfmeawbtmp`)

Migration applied to staging (ledger row `027` recorded to match the existing convention).

```
connected calls : 30   (failed: 0)
counter         : 30   (expected 30)
allowed         : 10   (expected 10)
RESULT: ATOMIC
```

Functional check, `max=3`: `true, true, true, false`.

Privileges on staging: `anon_read=false anon_exec=false auth_exec=false service_exec=true`.

### A false alarm, recorded because it matters

The first staging run reported `counter=15` against 30 calls — apparently a 50% lost-update rate. It
was not. The Supabase pooler caps **session-mode** clients at `pool_size: 15`:

```
15 failures: FATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15
```

Only 15 sessions ever connected, and the counter was **exactly 15** — matching the calls that
succeeded. Re-run through the transaction-mode pooler (which multiplexes) with 0 connection failures,
the counter was exactly 30.

The lesson is worth keeping: a concurrency test that does not verify its own calls connected will
report a lost update when the real cause is a refused connection. **`allowed` alone did not
discriminate** — with 15 increments and `max=10` it still read `10`, which would have looked correct.

## 5. Status

**R-004 is fixed in code and proven at the database layer. It is not yet closed.** Environment
variables resolve at deploy time, so the change is inert until a deployment is built. Closure needs
the deployed staging HTTP test (D4) to confirm the app actually reaches the RPC in a running
deployment — the database proof above shows the store is correct, not that the wiring is.

That distinction is deliberate: configuration and unit proofs are not runtime evidence.
