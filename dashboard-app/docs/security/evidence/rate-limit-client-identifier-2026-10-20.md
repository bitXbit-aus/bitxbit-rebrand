# Rate-limit client identifier — R-004 was deployed but keyed on an infrastructure IP

**Date:** 2026-10-20
**Found:** during post-deploy verification of R-004 (PR #5, deploy `6ad71dde`)
**Fix:** `security/client-ip-forwarding` — resolve the client address at the edge and forward it explicitly

---

## 1. What was observed

R-004's store was correct and its migration applied cleanly (`027`; ledger recorded; privileges
verified). The deployed app demonstrably reached the RPC — production `rate_limit_counters` held rows
keyed `api:token-stats:…` and `api:resolve-referral:…`, written at `07:56:14`/`07:56:17`, after the
deploy published at `07:55:04`. Those keys are produced only by the app's own code, through an RPC
only `service_role` may execute, and only the app holds that key.

**But the address inside those keys was wrong.** The client making the requests was at
**`206.83.119.2`** — the address Netlify's own request log records for those very requests
(`client.address`, corroborated by the `client_address` / `connection_address` top-k). The keys were
written with **`13.236.191.253`**, which appears in *neither* of those dimensions.

Forcing cache misses (via `_rsc`, which is in the site's `netlify-vary` query list) made the handler
execute twice from that same client. The result:

```
api:token-stats:13.236.191.253   count=2   window_started_at 2026-10-20 08:01:20
```

Two requests from one client, one shared key — and the key's embedded address is not the client's.

## 2. Mechanism

`getClientIdentifier()` read `x-nf-client-connection-ip`, which Netlify sets to the client's address.
That is correct **at the edge**, but the request then passes through the middleware, which runs as a
Netlify **edge function** (`___netlify-edge-handler-middleware` — confirmed executing via 177
invocations in one hour) and forwards to the origin serverless function. That edge → origin hop
replaces `x-nf-client-connection-ip` with the hop's own address.

So the route handler was reading an infrastructure address.

## 3. Impact

Rate limits were **per-edge-node, not per-client**. Every client behind the same edge node shared one
bucket. Both directions are wrong:

- an attacker routed through a different edge node receives a fresh allowance; and
- one caller can exhaust the shared bucket and lock out unrelated legitimate users behind that node.

The counter itself was never at fault — atomic, correctly privileged, and proven. **The defect was in
the identifier, not the store.** It is the same species of failure as the original R-004: a control
that reads as working.

**R-004 is therefore deployed but was not effective as designed.** Nothing is closed by this document.

## 4. The fix

Resolve the client address where the trusted value still exists — the edge — and forward it in a
header the application controls.

| Artifact | Role |
|---|---|
| `lib/client-ip.ts` | `resolveClientIp()` (edge-side resolution), `withClientIp()` (forwarding), `isValidIp()` (validation), `CLIENT_IP_HEADER` |
| `middleware.ts` | resolves once at the edge; forwards via `withClientIp()` on every `NextResponse.next()` |
| `lib/rate-limit.ts` | `getClientIdentifier()` prefers `CLIENT_IP_HEADER`, then falls back |

**Trust boundary.** `CLIENT_IP_HEADER` is trustworthy only because the middleware **overwrites it
unconditionally** before any route runs — a client-supplied value cannot survive — and **deletes** it
when no address can be resolved, rather than writing a placeholder that downstream might trust.
Anything reading it must sit behind the middleware matcher, which excludes only static assets and
images (not rate limited).

**Hardening beyond the bug.** Every source is now validated as a bare IP literal. Previously
`x-nf-client-connection-ip` and the `x-forwarded-for` entry were accepted as arbitrary strings, so a
malformed or forged value could become a rate-limit key. `resolveClientIp()` also refuses a value
containing a port, brackets, whitespace or a hostname.

**Cookie semantics preserved.** The forwarded headers are rebuilt per use rather than captured once,
because the middleware mutates `request.cookies` while refreshing a Supabase session and the existing
code relied on `NextRequest.next({ request: { headers } })` carrying those mutations. Capturing the
headers early would have silently stopped session-cookie propagation — the fix would have introduced
an auth regression.

## 5. Verification

`npm test`: **103/103 pass** (was 68 before PR #5; 103 now includes `client-ip`).

Mutation-tested, because a green suite proves nothing about whether the assertions can fail:

| Mutation | Expected |
|---|---|
| `withClientIp` stops overwriting a client-supplied value | must fail |
| `withClientIp` writes a placeholder instead of deleting | must fail |
| `isValidIp` accepts anything | must fail |
| `getClientIdentifier` stops preferring the forwarded header | must fail |

Full-project typecheck: clean (127 files, no code diagnostics; `middleware.ts` included).

## 6. Not yet verified — the part that actually matters

The unit tests prove the logic. They **cannot** prove that `x-nf-client-connection-ip` is still the
real client at the edge — that is the platform assumption the whole fix rests on, and it is exactly
the assumption that turned out to be false one hop later.

**The production check:** after deploy, force a cache miss (`?_rsc=…`) and confirm the counter key
carries the **client's** address (`206.83.119.2`) rather than `13.236.191.253`. Until that is
observed, this fix is unproven in the environment where the defect was found.

A second network would strengthen it: a request from a different address must produce a *different*
key. That is the test that would have caught the original defect.

---

## 7. FALSIFIED 2026-10-20 — the fix was deployed and changed nothing

The fix above was merged (`ad3ee01d`) and deployed (`6ad721eae21f5c2ab1597e0a`,
`commit_ref ad3ee01d`, published `08:12:25Z`). **It did not change the identifier.**

Observed after the deploy:

| Check | Result |
|---|---|
| Counter key after the fix | still `api:token-stats:13.236.191.253` |
| 5 requests from the client at `206.83.119.2`, distinct `_rsc` values | key moved **2 → 7** — exactly +5 |
| Client egress IP, confirmed locally | `206.83.119.2` |

The `+5` is the load-bearing measurement: it proves those requests **did** reach the route handler and **did** key on the edge address. They were not merely cache hits, so the absence of a client-keyed row cannot be explained away by caching.

**This falsifies §2.** The header does not hold the real client at the edge either — it already carries `13.236.191.253` before any hop, so re-forwarding it changes nothing.

### What the evidence now points to

- Netlify's own support guidance: `x-nf-client-connection-ip` is **not reliably populated inside Edge Functions** — which is what Next.js middleware is on Netlify — and the supported replacement is `Context.ip`; the header "will no longer be directly accessible".
- A separate production postmortem reports Netlify setting **`x-forwarded-for` to the edge network's own address**, so XFF is not the client either.
- `13.236.191.253` is an AWS **Sydney edge-node** address, consistent with both.

### Consequences

1. **The identifier defect remains OPEN.** R-004 is deployed and still keyed per edge node, not per client.
2. **The forwarding code is inert, not a fix.** It is retained only because it hardens validation (every source must now be a bare IP literal) and because it forwards whatever the edge provides. Its comments have been corrected to say so, so the code does not carry a false claim.
3. **Do not repeat the mistake of reasoning from the platform's documented behaviour.** The next change must be driven by observing the headers the origin actually receives.

### Next step — get the data, don't guess again

A temporary, token-gated diagnostic route that echoes the request's forwarding headers (`x-nf-client-connection-ip`, `x-forwarded-for`, `x-real-ip`, `forwarded`, `x-nf-*`) as seen by the **origin serverless function**, deployed, queried once, then removed. That identifies which header, if any, still carries `206.83.119.2` — or establishes that none does, in which case the identifier must come from Netlify's edge `Context.ip` (not reachable from Next.js middleware) or the design must change to something that does not depend on the client IP.
