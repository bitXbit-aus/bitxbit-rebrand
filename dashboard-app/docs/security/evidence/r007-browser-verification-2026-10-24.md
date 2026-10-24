# R-007 — real-browser verification of the client paths (2026-10-24)

**Narrows — but does not close — the browser-path residual.** This proves the React 19 client render,
the nested React 18 wallet subtree's page mount, and browser acceptance of an injected SSR-format
session cookie. It does **not** prove application sign-in/PKCE cookie writing or wallet
connect/sign/disconnect. Measured against the staging-scoped deploy preview of the release candidate.

---

## 1. Method

The gate cannot exercise a browser, so this was run in a **real Chromium** driven over CDP:

1. a unique ephemeral staging fixture user was created through the Supabase admin API;
2. a session was **minted** server-side and the auth cookie encoded with the app's own
   `@supabase/ssr@0.12.7` encoder — the same approach the HTTP gate uses;
3. the cookie was installed into the browser with `Network.setCookie`;
4. console errors, uncaught exceptions and unhandled rejections were captured across navigations via
   an injected collector;
5. the fixture was deleted afterwards and the session payload shredded.

**No password, one-time code, or magic-link URL was ever handled in the browser** — the session is
minted, never typed.

## 2. Results

| Page | Final path | Rendered | Console errors |
|---|---|---|---|
| `/dashboard` | `/dashboard` (authenticated) | fixture display name present: `Welcome back, browser-probe-…` | **none** |
| `/dashboard/wallet` | `/dashboard/wallet` | wallet UI mounted: *"Connect and verify your Solana wallet to receive bitxbit rewards"* | **none** |
| `/admin` (as member) | `/dashboard` | correctly denied and redirected | **none** |
| `/auth/login` (authenticated) | `/dashboard` | correctly bounced | **none** |

**Clean run, fresh browser session, single instrumentation pass:**

```
wallet console errors: NONE
dashboard console err: NONE
hook errors          : NONE
hydration errors     : NONE
```

A first pass showed one console error — `Identifier '_oe' has already been declared` — which was
**this probe's own collector being injected twice**, not the application. Re-running in a fresh
browser session with a single guarded injection produced **zero** errors, which is the result
recorded above.

## 3. What this establishes

- **The React 19 client renders in a real browser** with no "Invalid hook call" and no hydration
  mismatch.
- **The nested React 18 copy under the Fractal wallet adapter does not break rendering.** The wallet
  page mounts and paints its UI under React 19 — the specific failure mode reviewers flagged
  (a dual-React subtree throwing at runtime) is **not present on this page**.
- **A real browser accepts and uses the SSR session cookie** written in the `@supabase/ssr@0.12.7`
  format, and the middleware authorises correctly from it.
- **Client-side authorisation behaves correctly in a browser**: member → `/admin` denied,
  authenticated → `/auth/login` bounced.

## 4. Honest limits — what this does NOT establish

- **Actual wallet connection was not exercised.** No wallet extension was present, so
  connect / sign / disconnect against a real provider is still untested. Only the wallet page's
  render and mount are proven.
- **The PKCE magic-link flow through the browser was not exercised.** The redirect-path safety and
  resulting injected-cookie authentication are separately tested, but the full
  click-link → `/auth/callback?code=` → exchange sequence in a browser was not run, because that
  would require handling a one-time code in the browser tool.
- Chromium only; no other engine was tested.
- The browser used a fresh profile (the user's own default is not a supported Chromium for
  real-profile mode), which is the correct choice here — no production credentials or logins were
  involved.

**These two limits remain open and are recorded as residuals, not closed.**
