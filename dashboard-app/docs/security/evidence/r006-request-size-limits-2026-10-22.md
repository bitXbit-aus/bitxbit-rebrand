# R-006 — request-size limits, made explicit (2026-10-22)

**Status: IMPLEMENTED AND TESTED. Not yet verified in a deployment.**
**Risk:** R-006 · **Tracked as:** NA-4

---

## 1. The finding — implicit *and* incoherent

R-006 was recorded as "no explicit request-size limit; Next's 1 MB default applies".
Measuring it showed the boundary was not merely undocumented: **the two limits in
play disagreed, and the stricter one was the one the operator could not read.**

`lib/storage.ts` declared `MAX_FILE_SIZE = 5 MB` and refused larger files with a
legible message. But (a) the transport limit was Next's 1 MB default, and (b) the
**platform** ceiling is ~4.5 MB of binary. And the refusal was **thrown**, so in a
production build it became an opaque HTTP 500 with the message redacted.

## 2. Method

A local **production** build (`next build` + `next start`, Next 14.2.35) with a
temporary probe Server Action that logged the file and field sizes it actually
received. The action id was read from the rendered page's `$ACTION_ID_…` hidden
input, then the endpoint was driven directly with `curl`.

## 3. Measurements

| Test | Path | Payload | Action received | HTTP |
|---|---|---|---|---|
| T1 | plain-form multipart | 2 MB file | **2,097,152** (full) | 200 |
| T2 | plain-form multipart | 3 MB file | **3,145,728** (full) | 200 |
| T3 | plain-form multipart | **5 MB** file | **5,242,880** (full) | 200 |
| T6 | non-multipart (JSON) | 2 MB body | *action never ran* | **500** |

T6's server log: `Body exceeded 1 MB limit.` with `statusCode: 413` on the thrown
error — but the **client received 500**, an RSC error payload. So the only enforced
limit in the stack fails opaquely.

T4/T5 (fetch-action multipart, driven with a hand-built `Next-Action` request) both
returned 500 without reaching the action. That is **inconclusive**: the request
shape a hand-rolled `curl -F` produces may not match what Next expects on that
path, so no conclusion is drawn from them. The plain-form path (T1–T3) is the one a
browser uses before hydration and is conclusive on its own.

### What `bodySizeLimit` actually covers

Reading `next/dist/server/app-render/action-handler.js` explains the results:

- **Non-multipart (JSON/fetch) path** — `if (actionData.length > limit) throw new ApiError(413, …)`.
  Enforced. This is T6.
- **Multipart fetch path** — the value is passed to busboy as **`fieldSize`**, which
  limits *non-file* fields. It does not bound the file.
- **Plain-form multipart path** — no size check is applied at all.

**So `bodySizeLimit` does not bound file uploads.** A 5 MB file was received intact
with the 1 MB default in force. The app-level check is therefore the *only* guard on
upload size.

## 4. The defect this exposed

With `MAX_FILE_SIZE = 5 MB` sitting **above** the platform's ~4.5 MB effective
binary ceiling, a file in that band could never reach the app's legible refusal —
the platform rejected it first. The app advertised a limit it could not enforce,
and the operator got an opaque failure either way.

## 5. The fix

1. **`next.config.mjs`** — `experimental.serverActions.bodySizeLimit` is now set
   explicitly (`'1mb'`) with a comment stating exactly what it does and does not
   cover, so it is no longer inherited silently. 1 MB is deliberate: this check runs
   **before** any authorization, so raising it would enlarge what an unauthenticated
   caller can make the server buffer.
2. **`lib/asset-policy.ts`** (new) — one pure, client-safe module holding the size
   and type policy, unit-tested. `MAX_ASSET_BYTES` is now **3 MB**: below the
   platform ceiling with headroom for the multipart envelope and remaining fields,
   so the app's legible refusal fires before the platform's opaque rejection.
3. **`lib/storage.ts`** — uses the shared policy instead of its own constants.
4. **`lib/actions.ts`** — `resolveImageUrl` now **returns** `{ url, error }` instead
   of throwing, and the four upload call sites (createOffer, updateOffer,
   createProject, updateProject) return `{ error }`. The refusal now reaches the
   operator through the `lib/action-result.ts` contract that `FormWithToast`
   renders. The resolution was hoisted above `auditedAdminMutation` so a refused
   upload is not recorded as a mutation failure.
5. **`components/admin/image-upload-field.tsx`** — applies the same shared rule
   client-side, so the operator learns before the upload starts, and shows the
   accepted types and size limit. A courtesy, not a control: the server re-checks
   the received file.

## 6. Verification

- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npm test` — **158/158** (was 146; 12 new).
- `npm run test:migration` — replay + all concurrency races pass (unaffected).
- Dummy-env production build — compiles.
- **Mutation testing: 7/7 detected, 0 compile errors**, each failing the intended
  assertion:

| Mutation | Detected by |
|---|---|
| Boundary made exclusive (`>=`) | `accepts a file exactly at the limit` |
| Drop the finite-number check | `never throws on malformed input` |
| Drop the content-type check | `rejects a disallowed content type` |
| Raise the limit to 5 MB | `names both the limit and the actual size`, `keeps the app limit below the platform ceiling` |
| Message omits the actual size | `names both the limit and the actual size` |
| Revert the refusal to a `throw` | `returns upload refusals instead of throwing them` |
| Drop one call-site guard | `returns the upload refusal from every upload call site` |

**The harness found a real hole in the validator during development:** `NaN`
satisfies `typeof size === "number"` and passes both the `<= 0` and `> MAX`
comparisons, so a non-finite size was accepted. Fixed by an explicit
`Number.isFinite` check — caught by the test, not by review.

## 7. Limitations — what this does NOT establish

- **The platform ceiling is DOCUMENTED, not MEASURED.** Netlify's docs state a 6 MB
  buffered payload with ~30% base64 overhead for binary (≈4.5 MB effective). That is
  the basis for the 3 MB app limit, and it has not been verified in a deployed
  probe. If it is wrong, the app limit is simply conservative.
- **Not verified in a deployment.** No live upload has been exercised at the new
  boundary.
- **The `1mb` JSON limit is unchanged in effect** — it was the default already; it is
  now explicit and documented. It is not a new protection.
- **`bodySizeLimit` still does not bound uploads**, and cannot: the app check is the
  only guard. Any future upload path must call `validateAsset`.
