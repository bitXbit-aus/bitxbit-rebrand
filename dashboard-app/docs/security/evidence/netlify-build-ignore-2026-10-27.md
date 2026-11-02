# Netlify build-ignore rules — protecting the build-minute quota (2026-10-27)

**Register item:** R-019. **Scope:** `dashboard-app/netlify.toml`, `webflow-site/netlify.toml`,
`.github/workflows/dashboard-browser-smoke.yml`, plus a structural test. No application code changed.

## What happened

On 2026-10-27 the Netlify account's build minutes ran out. The production deploy for the merge commit
`7671f85` reported:

```
production | error | 7671f85 | Skipped due to account builds usage exceeded
production | ready | acec64d | (none)
```

**`main` moved and production did not.** CI was green throughout, and the deploy-preview checks GitHub
showed were the only signal — not a required check. The gap between `main` and the deployed commit was
docs-only, so the deployed bytes were identical and nothing broke, but the repository's operating
assumption ("a merge to `main` is a production release") had quietly stopped being true.

## Why the quota went first

Two structural wastes, both measured:

1. **The documentation lives inside the app.** The security register and evidence docs are at
   `dashboard-app/docs/**`, which is inside the dashboard site's base directory — so a docs-only merge
   was a genuine content change to Netlify and cost a **full Next build**. Four of the last eight merges
   were docs-only.
2. **Both sites built on every commit.** Any commit anywhere in the monorepo triggered a dashboard build
   *and* a marketing build, drawing on one shared account-wide quota.

Before this change, `build_settings.ignore` was **unset on both sites** (read from the API, not assumed).

## The change

A `[build] ignore` command on each site:

```
dashboard-app  ::  cd "$(git rev-parse --show-toplevel)" && test "$CACHED_COMMIT_REF" != "$COMMIT_REF" \
                   && git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- dashboard-app ':(exclude)dashboard-app/docs'
webflow-site   ::  cd "$(git rev-parse --show-toplevel)" && test "$CACHED_COMMIT_REF" != "$COMMIT_REF" \
                   && git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- webflow-site
```

Two details are load-bearing and are commented in place:

- **Exit-code polarity.** Netlify **skips** the build when the command exits **0** and **builds** on
  non-zero, so the command must read "true when there is nothing to build". An inverted command does not
  fail loudly — it silently cancels real deploys, which is the more dangerous direction.
- **The manual-deploy guard.** `test "$CACHED_COMMIT_REF" != "$COMMIT_REF"` keeps manual and
  clear-cache deploys building. With both refs equal, `git diff` reports "no changes", which would
  otherwise skip the very deploy that was explicitly requested.

`git rev-parse --show-toplevel` makes the pathspec mean the same thing whichever directory Netlify runs
from — with a bare `.`, a repo-root cwd would match the whole monorepo and nothing would be saved.

## How the rules were verified

**The exact command stored in each file** (unescaped as Netlify would) was executed against real
commit pairs, from **both** candidate working directories:

| Site | Ref pair | Meaning | Result |
| --- | --- | --- | --- |
| dashboard | `4e47f50..7671f85` | docs-only merges (#75, #76) | **exit 0 → SKIP** |
| dashboard | `774d841..4e47f50` | code change (#74, zod removal) | **exit 1 → BUILD** |
| dashboard | `7671f85..7671f85` | manual / clear-cache deploy | **exit 1 → BUILD** |
| marketing | `4e47f50..7671f85` | docs-only merge | **exit 0 → SKIP** |
| marketing | `b36bfea..bb3950a` | real marketing change | **exit 1 → BUILD** |

The dashboard command produced identical results with cwd = repo root and cwd = `dashboard-app`,
confirming the `--show-toplevel` guard.

A structural test (`lib/netlify-build-ignore.test.ts`, 6 tests) locks the properties in. It was
**mutation-tested** — each of five mutations was introduced, the test run, and the mutation reverted:

| Mutation | Tests failing |
| --- | --- |
| Remove `:(exclude)dashboard-app/docs` | **1** |
| Remove the manual-deploy refs guard | **1** |
| Invert polarity (`! git diff --quiet`) | **1** |
| Scope the marketing rule to `dashboard-app` | **1** |
| Remove the workflow's `app_changed` gate | **1** |

Baseline 6/6 pass, restored 6/6 pass. **One mutation initially reported a false pass** — the first
attempt to rescope the marketing rule used an escaped-quote pattern that did not exist in the file, so
the mutation was a no-op and the green result meant nothing. Redone against the verbatim string, it
fails as intended. Recorded because a mutation that does not apply is indistinguishable from a test that
does not work.

## The workflow interaction — why the smoke job had to be gated

Skipping builds for docs-only PRs means **no deploy preview exists**, and the browser-smoke job used to
wait 20 minutes for one and then fail — a red X that said nothing about the code.

The gate had to be **diff-based, not status-based**, because Netlify reports a skipped build through the
commit-status API as:

```
netlify/bitxbit-dashboard/deploy-preview | failure | "Deploy Preview failed."
```

— byte-identical to a real build failure, and identical again for a quota skip. There is no string to
match on.

So a `changes` job now diffs the PR's base tip against its head over `dashboard-app`, excluding
`dashboard-app/docs`, and the suite runs only when the app actually changed. When it is skipped it shows
as a **skip**, not as a green pass.

**Known limit, stated in the workflow:** if a branch changes app code and a later commit changes only
docs, Netlify may skip the build for the head commit while this gate (which sees the whole PR diff)
still expects a preview. That lands as a failure with an explanatory message, and the
`workflow_dispatch` `base_url` input runs the suite directly.

## Live verification — the platform skipped the build

The refs above prove the *logic*; this proves the *platform honours it*. By the time this was tested the
quota had reset (an app-changing commit built normally: `deploy-preview | ready | dd16d5d`). A **docs-only**
commit (`caf8349`) was then pushed to the same branch, and Netlify skipped it on **both** sites:

```
dashboard : error | caf8349 | Failed during stage 'checking build content for changes': Canceled build due to no content change
marketing : error | caf8349 | Failed during stage 'checking build content for changes': Canceled build due to no content change
dashboard : ready | dd16d5d | (none)
```

Three things follow, and one of them changed the workflow:

1. **The rules work on the platform**, not just in theory.
2. **Netlify diffs a deploy against the branch's PREVIOUS commit, not the base branch tip.** The PR's whole
   diff into `main` contained app changes (`netlify.toml`, `package.json`, the test), yet the build was
   still skipped — which can only happen if the comparison was `dd16d5d..caf8349` (docs only). This is why
   a commit that touches only docs or `.github/` produces no preview at all.
3. **That made the smoke job's wait a trap.** The job's own gate looks at the whole PR diff, so it expects
   a preview, while Netlify will never build one for that commit — the old behaviour was to poll for 20
   minutes and then report a timeout that reads like a code fault. The wait step now fails **fast** with an
   explicit "this is not a code defect" message when the *head commit* changes no app files, and names the
   `base_url` escape hatch.

A local `netlify build` was also run against the docs-only pair: it **completed a full build (39.9s, exit
0)** rather than skipping, so the local CLI does not evaluate `[build] ignore`. The platform is the only
authority for this setting — recorded so nobody repeats that path expecting a skip.

## Not verified

- **The marketing site's skip still rests on the same mechanism**, which was observed for the docs-only
  commit above; the marketing *build* path was not re-observed live (only its skip was).
- **The rules reduce consumption; they cannot prevent exhaustion.** A run of genuine app changes can still
  exhaust the quota, and nothing in CI currently fails when a production build is skipped. That residual is
  registered under R-019.
