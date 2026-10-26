# Skew protection enabled — deploy/asset skew on the dashboard

**Date:** 2026-10-26
**Site:** `bitxbit-dashboard` (`9617719a-40f4-4743-8b85-770c2fe61f63`)
**App:** `dashboard-app` — Next.js 15.5.28, `@netlify/plugin-nextjs` (unpinned)
**Trigger:** two reports from the owner — a **blank** `/auth/login`, then **"no buttons are
working on Safari"**.

## Summary

A deploy that renamed a page's hashed JS chunk left any browser holding **pre-deploy
HTML** requesting a chunk that Netlify had purged from the live alias. The request
**404'd**, the page's JavaScript never booted, and **hydration never happened**.

The failure has two faces, which is why it took two reports to see it:

| stale asset | what the user sees |
|---|---|
| layout/entry chunk fails | **blank page** |
| route chunk fails, layout loads | page renders from server HTML but **every button is dead** |

The second is the nastier one: it looks healthy and produces **zero console errors**.

Fixed by enabling **Netlify skew protection**, which pins each page load to its build
and serves that build's assets from the CDN even after a newer deploy is live.

## Root cause — measured, not inferred

The previously-purged chunk, confirmed 404 on the live alias:

```
/_next/static/chunks/app/auth/login/page-3b253e65911f0aa1.js   -> 404
```

It was the login page's chunk in **every production deploy before `b8e1b4f`**
(`655a636`, `250a577`, `5e98059`). Proven by fetching each old deploy's HTML from its
own deploy host (`https://<deploy-id>--<site>.netlify.app/auth/login`), extracting the
chunk paths it referenced, and testing those paths against the live domain.

Three factors opened the window:

1. `netlify.toml` set security headers for `/*` but **no `Cache-Control` for HTML**.
2. `middleware.ts` sets `private, no-store` **only when a `Set-Cookie` is present**
   (`middleware.ts:24`) — so a logged-out visitor's HTML was publicly cacheable.
3. Next emits `x-nextjs-stale-time: 300`, and the edge served `fwd=stale` (observed
   directly in `cache-status`).

`NETLIFY_NEXT_SKEW_PROTECTION` was **unset in all three contexts** (production,
deploy-preview, branch-deploy).

## The change

`NETLIFY_NEXT_SKEW_PROTECTION=true`, set in:

- the **Netlify UI** for all three contexts, and
- `dashboard-app/netlify.toml` `[build.environment]`, so it is version-controlled and
  an accidental unset on either side is covered by the other.

No `next.config` flags: Netlify requires `useDeploymentId` /
`useDeploymentIdServerActions` only below Next **14.1.4**; this app is on **15.5.28**.
A **redeploy is required** for the change to take effect — the adapter wires the
identifier in at build time.

## Verification — falsifiable, before and after

The claim "skew protection works" is testable: request a chunk that is provably gone
from the live alias, once with a valid deployment identifier and once with a bogus one.

```
                                    BEFORE      AFTER
without ?dpl                         404         404    (still purged — unchanged)
with ?dpl=<old deploy id>            404         200    <- THE FIX
with ?dpl=<bogus id>                 n/a         404    (scoped, not a blanket allow)
/auth/login                          200         200
```

The bogus-id line matters: it shows the CDN resolves a **specific, known** deployment
rather than serving anything on request. The fix is pinning, not cache-bypass.

The newly served HTML carries the identifier on **49** asset URLs (`?dpl=...`), so
subsequent client requests are versioned.

### End-to-end in Safari's engine (Playwright WebKit)

```
1. clean load                                      -> HYDRATED: true  · control click WORKED · 0 errors
2. un-versioned chunk paths blocked (the old 404)  -> HYDRATED: true  · control click WORKED · 0 errors
```

Test 2 is the decisive one: under the **exact** condition that previously prevented
hydration, the page now boots. The identifier on the asset URL is what makes the
difference.

## A false negative worth recording

The first interactivity probe clicked the submit button with empty fields and reported
"NO REACTION (dead)" — on a page already proven to hydrate. A `required` input makes
the browser show a **native** validation bubble, which does not change `innerText`, so
a live app reads as broken. The working probe asserts React's `__reactFiber$` presence
and clicks a control that must mutate the DOM (the consent banner's Accept button).
Recorded in the skill so the next person does not repeat it.

## Residual risk and honest limits

- **Clients holding HTML from before this change are still broken until one hard
  reload.** Their HTML has no `?dpl`, so their chunk requests remain un-versioned and
  still 404. Skew protection protects **future** skews, not the past one. This is the
  single most important limitation of the fix.
- **Explicit `fetch()` calls are not covered.** Next does not add the identifier to
  hand-written client `fetch()`es; those always hit the current deployment. Netlify
  supports a header (`x-deployment-id`) or a Next 15.4+ experimental flag, which is
  **not production-ready** per their docs. Not used here.
- Netlify's max-age for a pinned deployment is a platform setting; a client older than
  that window falls back to current-deployment assets (i.e. the old behaviour). Not
  measured here.
- This does **not** address the HTML cacheability gap (factors 1–2 above). Skew
  protection makes staleness *safe* rather than *impossible*. Tightening HTML caching
  remains available as separate work if desired.
- **M8 human review remains WAIVED under D5 — not satisfied.**

## Follow-ups

- HTML `Cache-Control` policy (factors 1–2) — not addressed.
- `PR #60` (wallet sign-in UX) was green and verified but still unmerged at the time of
  this change.
