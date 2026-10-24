# NA-6 residual — CI for stacked PRs: closed and verified by use (2026-10-24)

**Status: CLOSED.** Verified by use, not by reasoning.

---

## 1. The residual, as recorded when NA-6 was resolved (2026-10-23)

`pull_request.branches` matches the **base** branch, so `branches: [main]` covered every PR *to main*
— but **no stacked PR** (base = another branch). The register recorded:

> *Residual (not a gap today): PRs targeting a non-`main` base (stacked PRs) would be uncovered; **none
> exist** — all 41 target `main`.*

## 2. It stopped being theoretical the next day

PR #45 (the `getTokenBalanceAction` authorization guard) was **stacked** on the docs PR branch, so its
base was `security/register-docs-2026-10-23`, not `main`. Measured: **0 check runs** on its head — the
PR carrying a *code* change ran no CI at all. The workaround was to retarget #45 to `main` once #44
merged, which is precisely the manual step this residual described.

## 3. The fix

```diff
   pull_request:
     branches:
       - main
+      - "security/**"
```

**Deliberately not added to `push`.** A push to a security branch that already has a PR triggers CI via
the `pull_request` event, so a `push` filter would **double every run**. This is the reasoning recorded
when NA-6 closed: the originally-proposed `push` half was counterproductive. `push` stays minimal —
post-merge verification on the default branch, plus the one legacy long-lived branch.

**Why it was actionable now.** NA-6's stated blocker was that the automation token "lacks `workflow`
scope". It carries `repo` **and** `workflow`, so the change was pushable with **no credential
expansion**. YAML validated with an independent parser before merging (trigger block and all 7 steps
intact).

PR **#46** (base `main`) — required check **success** — merged as `a123def6`.

## 4. Verified by use

Reasoning about a GitHub trigger is not evidence — the original NA-6 diagnosis was wrong *because* it
reasoned instead of measuring. So this was measured:

| Step | Result |
|---|---|
| Base branch `security/stack-test-base` created from `main` (so it carries the new trigger) | — |
| Head branch `security/stack-test-head` = base + one trivial **root-level** file (outside `dashboard-app`, so no Netlify build) | — |
| Probe PR opened with **base = `security/stack-test-base`** (a `security/*` branch) | PR #47 |
| Required check on the probe head | **`Tests, migration replay, and build` → completed / success** |
| Pre-fix comparison — structurally identical PR #45 | **0 check runs** |

The probe PR was **closed**, and both probe branches **deleted**. Nothing was merged from the probe.

## 5. Also recorded — stale branch debt

The repository carries **39 stale `security/*` branches** (40 branches total: `main` + 39
`security/*`), almost all merged and never deleted. That is why the `push` trigger names the specific
long-lived `security/phase-1-hardening` rather than a glob.

**Not cleaned up here** — this is the owner's call, and it is repository hygiene rather than a security
control. But it is worth a sweep: a long-lived stale branch is a minor surface for anyone with push
access, and it makes the branch list hard to read when you are trying to find what is actually live.
