# Phase 1 — Host/origin validation released to production (R-003)

**Date:** 2026-10-20
**PR:** #4 — "Add host/origin validation (NA-1 / R-003)"
**Branch:** `security/host-origin-validation` @ `34e4bf09985c`
**Merge commit:** `8430ae228318791cd9703db089d4d847a013f0ac`
**Deploy:** `6ad70e11caacc4720af6dfa8` — `commit_ref 8430ae22`, published `2026-10-20T06:48:01.724Z`, 142 s build
**Evidence level:** repository-inspectable + live HTTP probes. The mutation run and the local
integration run are reproducible from the repo; the probes need network access to the site.

---

## 1. Pre-merge gates

| Gate | Result |
|---|---|
| Head SHA | `34e4bf09985c` — check runs bound to that exact SHA (branches move) |
| `Tests, migration replay, and build` | **success** on `34e4bf09985c` |
| Mergeability | `clean` |
| Target | `main`, which the host auto-builds — so the merge **is** a release |
| Branch protection (live) | `strict: true`, required check `Tests, migration replay, and build`; **`required_pull_request_reviews: null`** — see §6 |

**Schema dependencies: none.** Derived from the diff, not from filenames:

- No files under `supabase/migrations` in either direction.
- Zero added `.rpc("<name>")` / `.from("<table>")` call sites in the branch's diff, so the
  branch calls no database object `main` lacks.
- No `package.json` / `package-lock.json` interaction: `main` had not changed either file
  since the branch's merge-base, so the merge could not revert PR #1's dependency state.
- No application-source overlap with PR #1's hardening: the branch's base **is** PR #1's head
  (`bdbdf00`), so it builds directly on the hardened `middleware.ts`.

Required order was therefore simply **merge → verify**, with no migration step.

## 2. Harness verification — the tests can fail

Baseline: **26/26 pass** (`lib/host-validation.test.ts`). Five mutations of
`lib/host-validation.ts` were applied one at a time and the suite re-run:

| Mutation | pass/fail | Detected |
|---|---|---|
| `isAllowedHost`: `if (!host) return false` → `return true` | 25 / 1 | ✅ |
| `parseHostPolicy`: localhost default inverted (`!==` → `===`) | 25 / 1 | ✅ |
| `HOST_SOURCE_HEADERS`: `x-forwarded-host` dropped | 25 / 1 | ✅ |
| `isNetlifyDeployHost`: slug pin removed (`return true` for any `*.netlify.app`) | 25 / 1 | ✅ |
| `validateRequestHost`: absent-header fail-closed inverted | 23 / 3 | ✅ |

All five produced failures, then the source was restored and the suite returned to 26/26. No
mutation was semantically neutral: each corresponds to a distinct security property the module
claims to provide. **The green suite is load-bearing, not decorative.**

Note: NA-1's "68/68 tests" is the **whole** `npm test` suite; `host-validation` contributes 26
of those 68.

## 3. Merge

Merged through the provider merge endpoint, `PUT /repos/{owner}/{repo}/pulls/4/merge` with
`merge_method: merge` → **HTTP 200** `{"merged": true, "sha": "8430ae22…"}`. A true merge commit,
consistent with PR #1.

This also **corrects the merge-404 diagnosis** in
`phase-1-release-2026-10-20.md`: the endpoint is `PUT`-only, and the earlier attempts used
`POST`, which is unrouted and returns 404. The cause was the HTTP verb, not the credential.

## 4. Deployed and verified

Deploy `6ad70e11caacc4720af6dfa8` reached `ready` on `commit_ref 8430ae22`. Secret scan:
**132,145 files / 0 matches**. The middleware is deployed as the Netlify edge function
`___netlify-edge-handler-middleware` — **177 invocations** observed in the hour after release,
so it is genuinely executing, not merely packaged.

### Live probes

| Probe | Expected | Observed | Reading |
|---|---|---|---|
| `GET /` on `app.bitxbit.com.au` | 302 → `/dashboard` | **302** | Legitimate traffic not rejected |
| `GET /` on `6ad70e11…--bitxbit-dashboard.netlify.app` | 302 | **302** | Pinned-slug preview path works in production |
| `GET /auth/login` (cache-busted) | 200 | **200** | No false rejection on a real app route |
| `GET /auth/login` on the preview host | 200 | **200** | Preview host serves the app |
| `GET /auth/login` + `X-Forwarded-Host: evil.example.com` | 400 | **200** | See §5 — the header does not reach the app |
| `GET /auth/login` + `Host: evil.example.com` | 400 | **404** | Edge rejects unknown Host before the app |

### Integration proof that the rejection path works

Probes through the edge cannot exercise the refusal, so the deployed commit's code was run
locally (`next dev` on `34e4bf0`, clean env):

| Request | Result |
|---|---|
| Control — `Host: localhost`, no spoof | **404** (reached app routing; *not* 400) |
| `X-Forwarded-Host: evil.example.com` | **400 `Bad Request: unrecognised host.`** |
| `Host: evil.example.com` | **400 `Bad Request: unrecognised host.`** |

So the wiring rejects a disallowed value on **both** header paths when it sees one, and the
control passes host validation. This is an integration run, not a guard-path test.

## 5. What is established, and what is not

**Established:**

1. The middleware rejects a disallowed `Host` or `X-Forwarded-Host` with 400 when it receives
   one (§4, local integration run at the deployed commit).
2. The middleware executes in production (edge-function invocation count).
3. Production serves legitimate traffic on both the primary domain and the deploy-preview host.
4. A client-supplied `X-Forwarded-Host: evil.example.com` does **not** produce a 400 in
   production — on the primary domain or the preview host.

**Not established — stated rather than glossed:** a client-supplied `X-Forwarded-Host` does not
reach the application in production. The consistent explanation is that Netlify manages that
header itself (it routes by `Host` and strips/overrides a client-supplied `X-Forwarded-Host`;
the support record for this is long-standing and the edge returned 404 for an unknown `Host` in
probe 6). That means the application-layer control is **defence-in-depth behind a platform
control**, and the platform control is the one actually rejecting. This is exactly what the
module's own docstring asserts — *"On Netlify the edge routes by Host, so a spoofed value
normally never reaches the application"* — and it is a **property of the hosting configuration,
not of the code**. If the app is moved off Netlify, or the edge is misconfigured, this control
becomes the only one and is expected to carry the load; that is the condition under which it was
written.

Two readings remain indistinguishable from outside the edge: (a) the edge rewrote the header and
the middleware allowed the request; (b) the middleware did not run for that request. The
edge-function invocation count in §4 rules out (b) as a general condition, but not per-request.
A definitive per-request discrimination would need the edge-function logs for that request ID.

## 6. R-003 status — released, **not closed**

The register's closure condition for R-003 is "independent review + deployed evidence".
The deployed component is now **satisfied in production**. The **independent review is still
absent** — the owner removed the branch-protection requirement rather than satisfying it, so
`required_pull_request_reviews` is `null` and there is no second human approval. That is a
recorded, dated accepted risk naming the owner, and it is **not** converted into a pass by this
release. **Only the owner can close R-003.**
