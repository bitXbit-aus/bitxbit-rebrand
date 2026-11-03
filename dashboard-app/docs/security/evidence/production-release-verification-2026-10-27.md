# Production release verification — the control for R-019 (2026-10-27)

**Register item:** R-019. **Scope:** a version endpoint, a verification workflow, and two unit-test files.
No change to application behaviour beyond an unauthenticated read-only route.

## The gap this closes

R-019's mitigation removed the waste that exhausted Netlify's build minutes, but left the detection half
open: **nothing failed when a production build was skipped.** The Netlify deploy checks are not required
status checks, so `main` could sit ahead of production with every visible signal green — which is exactly
what happened.

## Why the control does not ask Netlify

Measured, before designing anything:

| Commit on `main` | Netlify check runs | Netlify statuses |
| --- | --- | --- |
| `7671f85` (quota-skipped) | none | none |
| `4e47f50` (deployed) | none | none |
| `acec64d` (deployed) | none | none |

**Merge commits on `main` receive no Netlify signal at all.** And where a signal does exist (previews), a
skipped build is reported as `failure | "Deploy Preview failed."` — byte-identical to a real build
failure, with a quota skip reported the same way. There is nothing to match on, and reading the deploy
record itself would need a Netlify API token in CI.

So the control is indirect by design: **it asks production what it is running.** A commit reference is
inlined into the bundle at build time, so a deployment that never built cannot produce one.

```
GET https://app.bitxbit.com.au/api/version
-> {"deployedCommit":"82ddc0f…","context":"production","production":true}
```

## Implementation

| File | Role |
| --- | --- |
| `next.config.mjs` | `env: { DEPLOYED_COMMIT: process.env.COMMIT_REF ?? '' }` — inlined at **build** time |
| `lib/deploy-version.ts` | pure resolution + the rule that unknown must be `null`, never a placeholder |
| `app/api/version/route.ts` | `force-dynamic`, `no-store`, statically-read `process.env.DEPLOYED_COMMIT` |
| `.github/workflows/production-release-verification.yml` | the two jobs below |

The inlining is load-bearing and subtle: Next only substitutes **static** `process.env.X` member
accesses. A dynamic lookup (`process.env[key]`) is not inlined and would report `null` forever, so the
route reads the variable as a literal member access.

Two jobs, deliberately different:

- **`Release reached production`** (push to `main`) — post-hoc. Decides whether the merge needed a deploy
  at all (merge commit vs its first parent, app files outside docs), then polls production for up to 20
  minutes. Fails loudly if the merged SHA never appears.
- **`Production is serving main`** (pull requests into `main`) — the one to make **required**. It derives
  main's newest ship-able commit and refuses to add releases while production is not serving it.

## Verification — real output, not a description

**1. The commit is inlined at build time.** Built with `COMMIT_REF=82ddc0f95aa07385e4eb8affb063f810b055b94f`:

```
$ grep -rl 82ddc0f95aa07385e4eb8affb063f810b055b94f .next/server
.next/server/app/api/version/route.js
```

**2. The built app reports it.** Served the production build locally (pm2, `PRODUCTION_HOST=localhost`
because R-003's host policy rejects `localhost` under `NODE_ENV=production`):

```
$ curl -H "Host: app.bitxbit.com.au" http://localhost:3000/api/version
{"deployedCommit":"82ddc0f95aa07385e4eb8affb063f810b055b94f","context":"production","production":true}
HTTP/1.1 200 OK
cache-control: no-store, max-age=0
```

`deployedCommit` equals the `COMMIT_REF` used at build, and the runtime context was resolved too.

**3. The workflow's own scripts were executed.** Extracted from the YAML with a parser rather than retyped,
then run against that live endpoint:

| Scenario | Result |
| --- | --- |
| production serves the merged SHA | **exit 0** — "the merge shipped" |
| production serves an older commit | **exit 1** — names R-019 and the deploy-retry path |
| merge changed nothing ship-able | **exit 0** — "no deploy was expected" |
| endpoint missing, switch off | **exit 0** with `::warning::` (bootstrap) |
| endpoint missing, switch on | **exit 1** |
| PR job: production serves main's newest ship-able commit | **exit 0** |
| PR job: main is ahead of production | **exit 1** with the resolution path |
| PR job: main has no ship-able commits | **exit 0** |

The "endpoint missing" rows are real: `https://app.bitxbit.com.au/api/version` returns **404** today,
because the route lands with this change. The control is therefore **inactive until this deploys**.

**4. A defect the run exposed.** The failure message hardcoded *"after 20 minutes"* while the window is
computed from `MAX_TICKS × TICK_SECONDS`. The script printed "after 20 minutes" during a 2-second test —
now it renders the actual window (`after 2s`), and the real configuration yields 20 minutes.

**5. Mutations, each caught:**

| Mutation | Failures |
| --- | --- |
| Stop inlining `COMMIT_REF` in `next.config.mjs` | 1 |
| Drop the docs exclusion from the workflow (disagreeing with the ignore rule) | 1 |
| Loosen the comparison to truthiness (`-n "$served"`) | 1 |
| Make a missing endpoint always pass | 1 |

Baseline 7/7 → each mutation 1 fail → restored 7/7.

**6. Three of these assertions failed on their first run** — wrong regexes against the real YAML. Recorded
because the opposite outcome is the trap: an assertion that never matches anything is indistinguishable
from one that is satisfied.

## Live in production — measured after the deploy

The control is now live. Production deploy `bc7901d` reached `ready`, and:

```
$ curl -sS https://app.bitxbit.com.au/api/version
{"deployedCommit":"bc7901d1949e83008dabd77f20c74de78a273529","context":null,"production":false}
HTTP 200
```

`deployedCommit` is exactly the merge commit on `main` — the primary signal works in production.

**Correction to the local example above.** That run printed `"context":"production","production":true`
because `CONTEXT` was set in the shell. In production it is **`null`**: `CONTEXT` is a **build-time**
variable on Netlify and is **not present in the running function**, so `context`/`production` will always
be null/false there. This is why the control keys on `deployedCommit` alone and never on the `production`
flag — and why `lib/deploy-version.test.ts` asserts that an absent context must not read as production. The
two informational fields are misleading in production and should either be inlined at build time like the
commit, or dropped. **Not fixed here** — recorded rather than left as a trap.

**Real CI verification** — workflow dispatch run `41602629205` on `main`:

```
Ship-able files changed - a production deploy is expected.
tick 1/40: production reports 'bc7901d…', expected 'bc7901d…'
Production is serving bc7901d… - the merge shipped.        -> success
```

That is the control doing its job on a genuine merge, not on a fixture.

**A note on how this PR was branched.** The R-019 work was started from the *previous* branch's head rather
than from `main`, so this PR was implicitly stacked on the build-ignore PR: its first diff showed 14 files.
Once the build-ignore PR merged first, the diff settled at the 9 files that belong to this change. Worth
knowing when reading the history — the stacking was not intended, and the merge order happened to absorb it
cleanly.

**The browser smoke job went red on the reconcile merge** — by design. That commit changed nothing under
`dashboard-app` outside docs relative to the branch's previous commit, so Netlify skipped the build and the
job failed fast with *"This is not a code defect"*. The head tree was **byte-identical** to `4e43e75`
(`git diff --stat` between them: 0 files), which is the commit the suite had already passed on — so the
content was verified, at its own commit. That is the documented trade-off: a loud failure over a silent
skip.

## Defects found by validating before enforcing

Making the check green on a real PR — rather than enabling it and hoping — found three genuine defects.
All three are fixed in the same change.

1. **The check itself would have failed on every PR after a merge.** `git log -1 --format=%H -- <path>`
   returned `4e43e75`, a commit that is not even on main's first-parent line, while production was serving
   `bc7901d`: default history simplification omits a merge commit that is TREESAME to one parent for those
   paths. The job then polled 20 minutes for a commit that could never appear. With `enforce_admins: true`
   this would have **blocked every merge**. Replaced with a first-parent walk.
2. **The browser-smoke wait accepted a canceled preview.** Netlify reports a *canceled* deploy as
   `state=success` with `target_url` pointing at the Netlify **admin** page. The step took that as "the
   preview" and ran Playwright against `app.netlify.com`, producing a suite failure that looked like a
   browser regression and was not one. Now only a real preview host is accepted, and the assertion covers
   it. *(Pre-existing, not introduced here — exposed by watching the job run.)*
3. **`TICK_SECONDS` was referenced but not defined in that workflow** — it exists only in the sibling
   release-verification workflow's env. Under `set -u` the wait step aborted at the first tick with
   `unbound variable`, which reads exactly like a smoke failure. Both variables are now defined in the
   workflow that uses them, and a test fails if one is referenced without being defined.

The lesson that generalises: **a red check is a claim, and it has to be read before it is believed.** Each
of these three looked like a code or browser defect from the outside and was a defect in the checking
machinery instead.

## Enabling it as a required check — DONE 2026-11-03

`Production is serving main` **is now a required status check on `main`**, and
`VERSION_ENDPOINT_REQUIRED=true` is set. Read back from the API:

```
required_checks: ["Tests, migration replay, and build", "Production is serving main"]
strict: true   enforce_admins: true
```

The order was deliberate and it paid for itself: the check was made **green on a real PR first**, and that
run failed before it passed — which is how defect 1 above was found. Enabling it directly would have put a
permanently failing required check on `main`, and with `enforce_admins: true` nobody could have bypassed it.

The failure path stays non-deadlocking: retrying the skipped deploy in the Netlify UI, or restoring build
capacity, are actions outside the merge path — and the failure message says outright that merging more
releases will not fix it.

## Not verified

- **The endpoint's behaviour is verified in production, but only for the happy path.** `/api/version`
  answered correctly on the live site, and the control verified a real merge (`bc7901d`). What has not been
  observed is the *failure* branch in production — no real merge has yet failed to ship since enforcement,
  so "production is behind" has been exercised only against fixtures and a locally served build.
- **`context`/`production` are null/false in production** — `CONTEXT` is build-time only on Netlify. The
  control does not use them, but they should be inlined at build time or dropped. See the production
  section above.
- The 20-minute window is a judgement, not a measurement of this pipeline's worst case. Netlify builds here
  have taken ~1–4 minutes; a heavily queued build could exceed it and produce a false failure.
