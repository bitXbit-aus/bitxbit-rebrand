# NA-6 — CI trigger: already satisfied, and the recorded diagnosis was wrong (2026-10-23)

**Status: CLOSED — satisfied. No workflow change required.** Verified by measurement against the
live repository and GitHub Actions, not from the register's own prose.

---

## 1. What NA-6 claimed

> *"The workflow triggers only on `main` and `security/phase-1-hardening`, so PR #2 and PR #3
> get **no CI**. The fix is a two-line change to `.github/workflows/` …"* — propose adding
> `security/**` to both the `push` and `pull_request` branch lists.

## 2. What is actually true (measured 2026-10-23)

**Every PR to `main` already runs CI on its merge candidate — including PR #2 and PR #3.**

- Checked **all 41 PRs** (`/pulls?state=all`), each one via `/commits/{head_sha}/check-runs`.
  **Every PR carries the `Tests, migration replay, and build` check.** None missing.
  - **PR #2** (`security/dependency-next-14-2-35` → `main`): head `be6e486c56` — check
    **present**, `completed/success`; the branch has **2 `pull_request` runs**, both success.
  - **PR #3** (`security/nextjs-15-migration` → `main`): **2 `pull_request` runs**.
  - **PR #41** (`security/service-role-key-rotation`): **1 `pull_request` run**, success.
- **`pull_request.branches` filters on the BASE branch.** Since every PR targets `main`,
  `branches: [main]` already covers all of them regardless of the head branch. Proven by the
  data: 40+ `pull_request` runs exist whose head branches are `security/*`.
  → The proposed **`pull_request` addition is a no-op** for these PRs.
- The proposed **`push` addition (`security/**`) would ADD a duplicate run** for every push to a
  security branch — the opposite of "without unnecessarily expanding".
- **The required check is enforced.** `main` branch protection: `required_status_checks`
  `strict: true`, contexts `['Tests, migration replay, and build']` (app_id `15368` = Actions).
  So the check must pass on the merge candidate before a merge is allowed.

## 3. Why the premise was stale — the real cause

The blocker was **never the `on:` trigger**. It was that the workflow file existed **only on PR
#1's branch**:

- `.github/workflows/dashboard-ci.yml` was created in commit `3419f2e` on
  `security/phase-1-hardening` (PR #1's head). It was not on `main`.
- For a `pull_request` event GitHub runs the workflow present in the PR's **merge ref**
  (head merged into base):
  - **PR #1** — its own head contained the file → runs began at the PR's creation
    (`2026-10-18T22:40:07Z`, run #26).
  - **PR #2** (created `2026-10-19T00:24Z`) and **PR #3** — neither head nor base contained the
    file → **no runs**.
- **PR #1 merged to `main` at `2026-10-20T06:10:53Z`**, landing the file on `main`. **PR #2's
  first `pull_request` run is `2026-10-20T06:16:02Z` — five minutes later.** From that moment
  every PR to `main` has run CI.

So the register was observing a **true symptom** (PRs #2/#3 had no CI on 2026-10-19) with a
**wrong diagnosis** (the `on:` block). The proposed two-line diff **would not have fixed it** —
the trigger was already correct; the file simply was not on `main` yet. This is the same
recorded-prose defect class as the R-009/R-013 summary contradictions and the R-010 `a2t2`
misattribution.

## 4. Conclusion

**NA-6 is CLOSED as satisfied.** No workflow change was made; the proposed diff is unnecessary,
and its `push` half is counterproductive. Resolution required no credential expansion at all,
because no change was needed.

## 5. Residual — not a gap today

- **PRs targeting a non-`main` base** (i.e. stacked PRs) would *not* be covered by
  `pull_request.branches: [main]`. No such PR exists — **all 41 target `main`**. If stacked PRs
  are ever used, add the base branch to `pull_request.branches` (one line, no credential
  expansion). Not done now, deliberately, to avoid expanding CI runs on a need that does not
  exist.
- The stale `push.branches` entry `security/phase-1-hardening` is harmless leftover; changing it
  to `security/**` would only add duplicate runs, so it was left alone.
- **Also stale:** the register's claim that the automation token "**lacks `workflow` scope**".
  Measured 2026-10-23, the token carries **`repo` and `workflow`** (`GET /user` →
  `x-oauth-scopes: repo, workflow`). So even the credential-expansion concern in NA-6's options
  1–3 no longer binds — though no change was needed, so this is noted only for accuracy.
