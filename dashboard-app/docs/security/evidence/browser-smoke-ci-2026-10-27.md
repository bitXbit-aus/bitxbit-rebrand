# Browser smoke test in CI — evidence (2026-10-27)

**Branch:** `security/browser-smoke` (stacked on `security/password-reset` / PR #68)
**Register:** R-016

## Why

Nine wallet defects were found in one session and **not one was caught by `tsc`, `npm test`, the
build, or CI**. Every one surfaced only in a real browser:

- a CSP that blocked a wallet's connect iframe ("This content is blocked"),
- a service worker whose fetch handler threw,
- deploy/asset skew between a cached document and chunks the new build had deleted,
- a wallet handshake that only died once a real extension was involved.

Those gates verify the **server**. They are structurally blind to the browser. This is the dominant
defect class in this project, so the structural fix is a browser test that runs on every PR against
the PR's **actual deployment**, not a local build.

## What was built

| File | Purpose |
|---|---|
| `dashboard-app/playwright.config.ts` | Config; requires `E2E_BASE_URL` (fails loudly if unset) |
| `dashboard-app/e2e/browser-smoke.spec.ts` | 7 tests (below) |
| `.github/workflows/dashboard-browser-smoke.yml` | Waits for the head-SHA Netlify deploy preview, then runs the suite |
| `dashboard-app/package.json` | `test:e2e` script + `@playwright/test` dev dependency |
| `.gitignore` | Excludes Playwright output |

### The seven tests

1–3. `/auth/login`, `/auth/signup`, `/auth/forgot-password` each render with a **page-specific h1**,
no **Next global error shell** in the body, **no CSP violations**, and no console/page errors.
   - The error-shell check is the important one: a route can return **HTTP 200** while the document
     is actually Next's error page (a streamed Server Component failure). Status alone is not a pass.
4. **Asset-skew guard** — fetch the document, extract every `/_next/**` JS/CSS URL it references, then
   require each to return **200 on this deployment**. A cached document pointing at chunk names the
   new build deleted is the blank-page defect.
5. **Enumeration property** — submitting two different unknown addresses yields the **identical**
   message, and it contains no "not found / no account / does not exist". Asserts against the real
   constant imported from `lib/password-reset.ts`.
6. **Reset-page session guard** — with no session, `/auth/reset-password` redirects to
   `/auth/login?error=reset_required` and shows a legible reason.
7. **Wallet block + challenge API** — the wallet sign-in block is present, and a `POST
   /api/auth/wallet/challenge` issued **from the page context** returns JSON (not a 5xx, not an error
   page). This is the client→server half CI can reach without an extension.

### Deliberately not covered

- **The wallet signature step.** Driving the official wallet adapters (`@solana/wallet-adapter-*`)
  needs a real extension, which CI cannot install. Simulating an adapter well enough to be
  non-flaky is not worth the false confidence. That half stays with the documented manual procedure.

## Gate — local, on this branch

| Gate | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` (includes `e2e/` and `playwright.config.ts`) | **0** |
| `npm test` | **253 / 253** |
| `npm run build` (dummy env) | **0** |
| `npm ci` (plain, no `--legacy-peer-deps`) | **passes** — lockfile regenerated against the plain resolver |

### Dependency diff — audited for silent upgrades

`npm install -D @playwright/test@^1.49.0` added exactly three packages and changed nothing else:

```
ADDED (3):
  + node_modules/@playwright/test@1.64.1
  + node_modules/playwright@1.64.1
  + node_modules/playwright-core@1.64.1
CHANGED (0):
REMOVED (0):
```

No transitive version drift — the supply-chain check the lockfile rule requires.

## Suite executed against the live PR-68 deploy preview

`E2E_BASE_URL=https://deploy-preview-68--bitxbit-dashboard.netlify.app npx playwright test`

```
7 passed (15.2s)
```

### Negative control — the suite can actually fail

Run against `https://example.com` (a page with none of the expected content):

```
7 failed
```

Every test failed, including the chunk-integrity and enumeration tests. The suite is not a set of
assertions that pass regardless of what it is pointed at.

## What the first run caught

The initial run failed 4/7 with:

```
CSP violation: {"directive":"frame-src","blockedURI":"https://app.netlify.com"}
console error: Framing 'https://app.netlify.com/' violates ... frame-src ...
```

This is **Netlify's deploy-preview toolbar iframe**, blocked by our CSP. It is the control working,
not a defect, and the toolbar does not exist on production. It is filtered as benign **only when the
target host matches `*.netlify.app`** — the same URI on a production run still fails. Recorded here
because a smoke suite that hides a real `frame-src` regression on production would be worse than none.

## The workflow has run on GitHub — green

Netlify builds a deploy preview only for a PR whose base is the **production branch**. A stacked PR
(this one) therefore never receives one, and the automatic wait step cannot resolve a URL — it waits
and then fails with a clear message rather than passing silently.

Two fixes, both applied:

1. `workflow_dispatch` accepts an optional `base_url` that skips the wait.
2. The job is now **skipped (neutral)** on any PR whose base is not the default branch, instead of
   waiting 20 minutes to fail.

Using (1), the suite was run from GitHub Actions against `deploy-preview-68`:

| | |
|---|---|
| Run | `40445056002` (event `workflow_dispatch`, head `f8c4a92`) |
| Result | **success** — every step green, including "Run browser smoke suite" |

So the workflow is proven end-to-end in CI, not only locally.

## The automatic path is verified too

PR #68 targets `main`, so Netlify built a preview for the merged head `9ef5601e`, and the workflow's
**automatic** wait resolved that URL and ran the suite:

| | |
|---|---|
| Run | `40445727437` (event `pull_request`, head `9ef5601e`) |
| Netlify deploy-preview status at the time | `success` |
| Result | **success** |

Both branches of the URL-resolution logic — a supplied `base_url` and the deploy-preview wait — are
now proven green in CI.

## Not verified

- Nothing structural remains for this control. The coverage limits above still apply (the wallet
  signature step is not exercised).
- **Not a required status check.** Making it required is an owner decision, and it presumes a Netlify
  preview exists for every PR (fork PRs do not get one).
- The wallet **signature** step, as above.

## Stacking

This branch is based on `security/password-reset` because test 5 exercises the recovery route that
PR #68 introduces. Merge order is **#68 → main, then this branch → main**. Opening it against `main`
before #68 lands would fail test 5 (the route would not exist on the preview).
