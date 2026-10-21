# R-004 client-identifier instrument — 2026-10-21

**Status:** instrument deployed and inert; awaiting one gated request. **Temporary — remove when
the investigation concludes.**

Related: [`rate-limit-client-identifier-2026-10-20.md`](rate-limit-client-identifier-2026-10-20.md)
(§7 records the falsification that made this necessary), R-004, NA-13.

---

## 1. Why this exists

On 2026-10-20 a fix was deployed that resolved the client address in the middleware and re-forwarded
it in a header the app controls (`ad3ee01d` → deploy `6ad721ea`). **It changed nothing.** Counters
were still keyed `api:token-stats:13.236.191.253`, and five requests from a client at
`206.83.119.2` moved that key from 2 to 7 — exactly +5, proving the requests reached the handler and
keyed on the edge address.

That falsified the working explanation. The header does not hold the real client *at the edge*
either. External evidence points at Netlify not reliably populating `x-nf-client-connection-ip`
inside **Edge Functions** (which is what Next.js middleware is on Netlify) and setting
`x-forwarded-for` to the edge network's own address; `13.236.191.253` is an AWS Sydney edge-node
address.

The conclusion was to stop reasoning from documented platform behaviour and **observe** instead.

## 2. The instrument

`app/api/diag/forwarding-headers/route.ts` returns, as the **origin serverless function** receives
them:

- `x-nf-client-connection-ip`, `x-forwarded-for`, `x-real-ip`, `forwarded`, `x-nf-request-id`,
  `x-nf-geo`, `x-country`, `user-agent`;
- every other header whose name matches `ip|forward|real|client|country|geo`;
- `clientIpHeaderFromMiddleware` — what the middleware forwarded;
- `resolveClientIpAtOrigin` and `getClientIdentifierResult` — what each layer concludes;
- `NextRequest.ip`.

**Fail-closed:** returns a bodiless `404` unless `DIAG_HEADERS_TOKEN` is set *and* supplied in
`x-diag-token`. With the variable unset the route is indistinguishable from a route that does not
exist.

**Reading the two 404s** — they are distinguishable, and this matters when checking whether the
route is deployed at all:

| Response | Meaning |
|---|---|
| `404`, **0 bytes** | the route ran and its gate closed |
| `404`, **~12 KB of HTML** | Next.js `_not-found` — **the route is not registered** |

## 3. Tooling findings (2026-10-20/21)

Recorded because each one silently produces a wrong conclusion:

1. **The MCP env-var write reports success without persisting.** `manage-env-vars` returned
   *"Environment variable upserted"* twice — once with `scopes: ["all"]`, once with the explicit
   `["builds","functions","post_processing","runtime"]` every other variable uses — and the key was
   **absent from a subsequent listing both times**. The deploy built afterwards therefore had no such
   variable, and the instrument stayed inert. **Always re-list and assert the key is present before
   depending on a variable write.**
2. **Branch deploys are opt-in per branch.** A pushed branch produced no deploy; its
   `<branch>--<site>.netlify.app` hostname returned Netlify's `Site not found` page. "Push a branch
   and test on the preview URL" was not available.
3. **No local Netlify CLI credentials.** `~/.netlify/config.json` absent and no `NETLIFY_*`
   environment variables, so `netlify api createSiteBuild` (the documented way to force a rebuild
   without a code change) could not be used.
4. **The MCP `deploy-site` path fails.** It uploaded the project and then returned
   `500 Internal Server Error` from `zipAndBuild`. Not usable as a rebuild trigger.
5. **Next.js does not route `_`-prefixed folders.** The route first lived at
   `app/api/_diag/forwarding-headers/` and returned Next's 404 page because underscore-prefixed
   folders are private and excluded from routing. Renamed to `app/api/diag/`.

Consequence of 1–4: the only available rebuild trigger is a **git-linked build**, i.e. a commit to
`main`. Environment variables are resolved at deploy time, so a deploy built before the variable was
set does not have it — the variable being present in the dashboard is **not** evidence that a
running deploy can see it.

## 4. Next step

1. `DIAG_HEADERS_TOKEN` set by the owner (2026-10-21T21:51:26Z, context `all`, scopes
   `[builds, functions, post_processing, runtime]`).
2. Git-linked rebuild so a deploy carries the variable.
3. One gated request; compare the origin's view against Netlify's own `client_address` for the same
   request.
4. **Remove this route** and the variable once the identifier is understood.

If no header carries the client address, the identifier must come from Netlify's edge `Context.ip`
(not reachable from Next.js middleware), or the rate limiter must stop depending on the client IP.
