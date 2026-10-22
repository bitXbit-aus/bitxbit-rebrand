# R-005 and R-006 — verified in a deployment (2026-10-22)

**Target:** `deploy-preview-33--bitxbit-dashboard.netlify.app` — a staging-scoped preview
(devnet mint, staging Supabase, per the D4 verification). **Not production.**
**Session:** a purpose-built staging test user, authenticated without any password.

Both items move from *"implemented and tested, not verified in a deployment"* to
**verified in a deployment**.

---

## 0. Prerequisite — this was blocked until R-014 was fixed

Every preview deploy had **broken authentication**: the deployment shipped a legacy anon
JWT that Supabase disabled on 2026-10-19, so `getUser()` failed and every protected route
redirected to login. See `r014-legacy-anon-key-staging-auth-2026-10-22.md`. Fixing the
`deploy-preview`/`branch-deploy` anon key and rebuilding produced preview 33, which is what
these tests ran against.

## 1. Method

| Step | How |
|---|---|
| Session | Admin API `generate_link` (magiclink) → `/auth/v1/verify` token exchange. **No password was typed, printed, or passed anywhere.** |
| Cookie | `sb-luqrwhgjtiyfmeawbtmp-auth-token`, value = the session JSON, percent-encoded (2738 chars, single cookie — under the 3180 chunk limit) |
| Capabilities | `can_manage_rewards` + `can_manage_content` granted to the staging test user; `role` temporarily raised to `admin` so the `/admin` pages would render (the middleware gates `/admin/*` on role, the *actions* only check capabilities) |
| Action IDs | Read from the RSC flight payload in the rendered page (`{"id":"<40-hex>","bound":...}`) — the App Router serves no public build manifest |
| Wire format | Server Action `FormData` calls are multipart with fields prefixed **`1_`** plus **`0=["$K1"]`** — captured by instrumenting `window.fetch` in the live page |

## 2. R-005 — Server Action rate limiting

Target: `calculateRewards` (limit **6/60 s**), invoked with a **non-existent period id** so
the action errors harmlessly — the limiter still counts, and no staging data is mutated.

| Call | Result |
|---|---|
| #1–#6 | HTTP 500 (the bogus period id throws inside the action — no mutation) |
| **#7** | **HTTP 200** — `{"error":"Too many requests. This action is rate limited — please wait 48s and try again."}` |
| #8 | HTTP 200 — same message, `wait 45s` |

**Three things this establishes:**

1. **Enforcement at the configured budget.** Exactly 6 allowed, the 7th refused — matching
   `ACTION_RATE_LIMITS["reward.calculate"] = 6/60s`.
2. **The refusal is RETURNED, not thrown.** HTTP **200** carrying `{error}`, where the
   allowed calls returned 500. This is the R-005 design claim — a thrown error would have
   surfaced as a redacted 500, which is precisely what the design avoids.
3. **The message is legible and actionable**, with a live countdown (48 s → 45 s).

**Shared store confirmed.** The counter appears in staging's own table, keyed on the
authenticated user:

```
key: action:reward-calculate:user:22098cf0-a829-455a-8919-d0a6caf31e02
count: 8   window_ms: 60000
```

The key carries the **user id**, not a client address — consistent with R-005's design
(a Server Action has no `NextRequest`, and a header would reintroduce R-004's spoofing hole).

## 3. R-006 — request-size boundary

### 3.1 The client-side rule is live

The deployed `/admin/offers` page renders the file input with exactly the shared policy:

```
accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml"
hint:  "PNG, JPEG, WebP, GIF or SVG — up to 3 MB."
```

That is `ASSET_ACCEPT_ATTRIBUTE` and `formatBytes(MAX_ASSET_BYTES)` from
`lib/asset-policy.ts`, rendered by the deployed build.

### 3.2 Positive control — a valid upload completes end to end

A 2 KB PNG passed the client check, was accepted by the action, and **created the offer**,
with the asset stored at `…/storage/v1/object/public/assets/offers/small-<ts>.png`. So the
path works, and a refusal below is a real refusal rather than a broken form.

### 3.3 The SERVER check — refusals returned, not thrown

The client-side check would block an over-limit file before submission, so the file was
**swapped inside the FormData at submit time** by overriding `window.fetch` in the page —
after the client check had already passed, and through the genuine wire path. Captured
evidence:

| Case | Swap confirmed | HTTP | Response body |
|---|---|---|---|
| 4 MB PNG | `big4mb.png 4194304 image/png` | **200** | `{"error":"File must be smaller than 3 MB. This file is 4 MB."}` |
| 1 KB PDF | `doc.pdf application/pdf` | **200** | `{"error":"File type not allowed: application/pdf"}` |

Both refusals are **HTTP 200 with a returned `{error}`**, rendered by `FormWithToast` as a
legible error toast — **not** an opaque 500. The size message names **both the limit and the
actual size**, which is the legibility property `lib/asset-policy.ts` exists to provide.

## 4. Verification

- Enforcement boundary exact in both items (6 allowed / #7 refused; 4 MB refused at a 3 MB limit)
- Refusals returned as `{error}` with HTTP 200 in all three refusal cases
- Positive controls present in both: the 500→200 transition distinguishes allowed from
  refused calls, and a valid upload completed end to end
- Counter observed in the shared store, keyed on the user

## 5. Limitations — stated, not glossed

- **Verified on a staging-scoped preview, not production.** The code is the same build
  lineage, but this is not a production observation.
- **Only one of R-005's five limited actions was exercised** (`calculateRewards`). The other
  four share the same `checkActionRateLimit` call path and the same tested module, but were
  not driven in a deployment.
- **The `role=admin` grant was temporary.** It existed only so `/admin` pages would render;
  the authorization row has been restored to its original state (`role=member`, all
  capabilities false). The capabilities were granted only for this test.
- **Test residue was cleaned up:** the created offer and its storage object were deleted, and
  the `rate_limit_counters` rows for the test user were removed.
- The direct `Next-Action` POST attempt with hand-built multipart **did not work** — React's
  decoder is stricter than the captured field naming suggests. The browser-driven method is
  what produced the evidence; the hand-built attempt is recorded here as a dead end so it is
  not repeated.
