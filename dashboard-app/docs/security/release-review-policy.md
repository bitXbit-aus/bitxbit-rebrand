# Release review policy (M8) — including the owner-authorised exception of 2026-10-24

This document states the review requirement for a production release, the **owner-authorised
exception** currently in force, the conditions attached to it, and its limits.

---

## 1. The requirement

M8 of `nextjs-15-migration-plan.md` requires, for a release:

| Element | State |
|---|---|
| A PR with attached evidence | required |
| **Independent human approval** | required |
| Production preflight re-run | required |

The register's division of authority is explicit that the implementing agent **cannot** supply the
approval: self-review is not independent review. GitHub enforces this mechanically as well — the
automation credential is the PR author (`bitXBit-aus`, id 226046989), so an `APPROVE` review returns
`422 "Review Can not approve your own pull request"` (verified 2026-10-24).

**Also measured 2026-10-24:** `main`'s branch protection sets `required_pull_request_reviews: None`
and the repo has no rulesets, so **nothing in the platform enforces the review**. It is a process
requirement, and `main` auto-deploys. Discipline, not tooling, is what holds this line.

---

## 2. Owner decision — 2026-10-24

- **Decision by:** Shri — founder and accountable risk owner of bitXbit.
- **Decision:** adopt a **two-model independent AI security review** process as a **documented
  exception** to the independent-human-review requirement.
- **Owner's recorded understanding:** AI reviews are **not equivalent** to independent human
  sign-off, and the owner **accepts accountability** for choosing this alternative.

> ### This is a waiver, not a satisfaction
>
> The independent-human-review condition of M8 remains **UNSATISFIED**. It is **waived, for the scope
> below, by the accountable owner, on the record**. Any statement that independent human review was
> obtained for a release covered by this exception is **false**. Register entries and PR bodies must
> say "waived under the owner-authorised exception of 2026-10-24", never "reviewed".

---

## 3. Conditions attached to the exception

1. **Two independent adversarial reviews** by **genuinely different underlying AI models** (different
   labs, not two configurations of one model). Both must examine the **exact** proposed release
   commit — identified by SHA, not by branch.
2. **Record each model's identity, findings, recommendations and outstanding concerns** verbatim
   enough to be auditable.
3. **Address all critical findings**, and **repeat the relevant reviews and tests after any material
   change** — a review of commit *A* does not cover commit *B*.
4. **Retain the mandatory test battery**, unchanged: CI (`Tests, migration replay, and build`),
   database integrity checks (migration replay + concurrency races), authentication testing
   (authorisation matrix), and Solana payout regression testing (devnet fault suite).
5. **Fix the middleware redirect-cookie defect in a separate, narrowly scoped PR** before production
   release.
6. **Record the exception** in the register and in this policy.
7. **Present the final release evidence and outstanding risks to the owner for explicit approval.**

---

## 4. Limits of the exception

- It covers the **review step only**. It does **not** authorise an immediate merge, a production
  deployment, or a database migration — each of those remains a separate owner decision.
- It **does not** weaken any other M8 element: evidence, production preflight, or the retained test
  battery.
- It **does not apply** where an AI reviewer is unavailable, or where a **critical** finding is
  unresolved.
- **Reviewed revision vs release commit.** The reviewed artifact is the **deployed application**:
  everything under `dashboard-app/` that ships — application code, dependencies
  (`package.json`/`package-lock.json`) and build configuration. A documentation-only commit after the
  review (`docs/**`) does **not** invalidate it. Neither does a change confined to a **verification
  harness** (`scripts/**`, which is not bundled), provided the change makes the gate *stricter* or
  repairs the harness itself and is recorded here. Any change to shipped code, dependencies or build
  configuration **does** re-trigger condition 3, including a change that only *looks* cosmetic.
- **Harness changes are recorded, not assumed.** The gate is part of the evidence, so a post-review
  harness change must be named in the review record with its reason, and the gate re-run against the
  reviewed revision afterwards.
- A **critical** finding cannot be waived by this exception; only the owner can accept it, separately
  and explicitly, with its impact recorded.
- **Reassessment:** this exception must be re-affirmed, or replaced by human review, at the next
  release review. It is not a standing policy change.

---

## 5. Review record — Next.js 15 migration (R-007)

| Field | Value |
|---|---|
| Reviewed commit | `294a1dc5d59e5873647696a2ba6449518466e0a7` (terminal PR #49 head; application tree byte-identical to `ba0c765a26054c4004d223c457b58002b958b0e3`) |
| Reviewers | OpenAI `openai/gpt-6.1-sol-pro` and Google `google/gemini-3-flash-preview`, different labs, separate calls, identical exact-SHA bundle |
| Method | Full diff plus key full files read from that SHA with `git show`; adversarial prompt; no shared model context; preflight secret scan 0 hits |
| Findings | See `evidence/r007-independent-review-2026-10-24.md` for historical leads and `evidence/r007-ai-review-2026-10-24.md` for the final review of record |
| Status | No critical findings in the terminal round. Substantive findings were independently measured; false findings and residual verification limits are recorded rather than silently discarded. Exact-head CI, the 21/21 authenticated matrix and the Solana devnet fault suite passed on `294a1dc`. Explicit owner approval remains outstanding. |

**The human-review condition for this release is waived under §2, not satisfied.**
