# Next.js 14.2.35 released to production (R-001 interim hardening)

**Date:** 2026-10-20
**PR:** #8 — "Bump Next.js to 14.2.35 (interim security hardening, R-001)"
**Branch:** `security/nextjs-14-2-35` @ `468b3ff300c8e67122c803debaec4fba88cbc620`
**Merge commit:** `f31c7a97e7b6a7951577cd30c5fbc9e395399c3e`
**Deploy:** `6ad715a924d6d64146cb47c1` — `commit_ref f31c7a97`, published `2026-10-20T07:19:57.840Z`, 115 s build
**Evidence level:** repository-inspectable + live HTTP probes.

---

## 1. Provenance — why this PR is 3 files and not 28

This is the dependency half of PR #2, which was titled as a bump but carried **28 commits**:
one bump plus **27 documentation commits** forming the Phase 1 security record. Those are two
change classes — a dependency upgrade needs its own regression pass — so they were separated.

| Content | Landed as |
|---|---|
| The 27 documentation commits | **PR #7** → `main` `92d358d` (security docs on `main` 10 → 20; `risk-register.md` present for the first time) |
| The Next.js bump (3 files) | **this PR**, `main` `f31c7a97` |
| PR #2 itself | closed as superseded, original description preserved |

Before PR #7, `main` did **not** contain `risk-register.md` — the register and the evidence for a
release already live in production existed only on an unmerged branch.

## 2. Pre-merge gates

| Gate | Result |
|---|---|
| Head SHA | `468b3ff300c8` — checks bound to that exact SHA |
| `Tests, migration replay, and build` | **success** on `468b3ff300c8` |
| Mergeability | `clean` |
| Up to date | `main` (`92d358d`) is an ancestor of the head — required, because branch protection sets `strict: true` |
| Branch protection (live) | `strict: true`, required check present; **`required_pull_request_reviews: null`** — the review gate is absent, not satisfied (§5) |

**Schema dependencies: none.** No migration files, no `package.json`/lockfile interaction with
in-flight work, no application-source change beyond `next-env.d.ts` (a comment URL Next writes
itself). Contents: `package.json`, `package-lock.json`, `next-env.d.ts` — `next` and
`eslint-config-next` `14.1.0` → `14.2.35`.

**Regression pass.** CI runs `npm ci` → `npm test` → migration replay → `npm run build`. The
lockfile blob in this PR is **byte-identical** (`9d59e8671a673499e176a1ad5c4f6e72dd7934dd`) to the
one CI validated on the original bump commit — verified by hash, not assumed — so `npm ci` is
known to accept it rather than merely expected to.

## 3. Deployed and verified

Deploy `6ad715a924d6d64146cb47c1` reached `ready` on `commit_ref f31c7a97`. Secret scan:
**132,849 files / 0 matches**. Six assets changed, consistent with a Next.js runtime bump.

| Smoke test | Expected | Observed |
|---|---|---|
| `GET /` | 302 → `/dashboard` | **302** |
| `GET /auth/login` (cache-busted) | 200 | **200** |
| `GET /dashboard` unauthenticated | redirect to login | **307 → `/auth/login`** |
| Deploy-preview host `6ad715a9…--bitxbit-dashboard.netlify.app` | 302 | **302** |
| Security headers | CSP, HSTS, `X-Frame-Options`, `nosniff` present | **present** |

The `/dashboard` redirect is the load-bearing one: it exercises the **middleware auth path** under
14.2.35, so the bump did not break the request pipeline that R-003's control also sits in.

## 4. What this bump does and does not do

This is the **interim** step, not the resolution. R-001 records **23 advisories still matching
`next@14.2.35`**, ruled individually in the register. The two criticals are neutralised by
deployment **configuration**, not by this bump:

- GHSA-p293-qw3h-jr36 — RCE on Windows-hosted servers → N/A (Netlify/Linux)
- GHSA-2xp9-vwfh-vxw4 — RCE in the Image Optimization API → N/A (`images.unoptimized: true`, no
  `next/image` usage)

**Those neutralisations are properties of the hosting and config.** If the app is self-hosted,
moved off Netlify, or image optimisation is re-enabled, both criticals apply immediately and the
exception is void. The actual remediation is the Next.js 15 migration (PR #3 is the plan).

## 5. R-001 status — released, still conditional

R-001 remains **ACCEPTED — conditional**, expiring **2026-11-18**. This release does not change the
acceptance and does not close the risk; only the owner can do either.

**Condition 3** (host validation, request limits, shared rate limiting, server-side access
controls) is **still not met**, though one of its two outstanding controls is now satisfied:

| Control | State after this release |
|---|---|
| Host-header validation | ✅ **Satisfied** — implemented and released (PR #4, deploy `6ad70e11`), verified in production. See `phase-1-host-origin-validation-released-2026-10-20.md` |
| Shared rate limiting | ❌ **Still not satisfied in production.** Production's migration ledger is at **`026`**; migration `027_shared_rate_limit_counter.sql` exists only on the unmerged PR #5. Rate limiting remains per-instance in production |
| Request limits | ⚠️ Default only (Next's 1 MB). R-006 |
| Server-side access controls | ✅ Strong, unchanged |

**Recorded because it is easy to misread:** the register's NA-2 row reads "✅ DONE", which is
accurate about *implementation and local/staging proof* but must not be read as "live". The
migration that makes the store shared is **unmerged and unapplied** in production.

**Independent review remains waived, not satisfied.** `required_pull_request_reviews` is `null`;
this release was merged on CI alone. That is a dated accepted risk naming the owner and is not
converted into a pass by this document.
