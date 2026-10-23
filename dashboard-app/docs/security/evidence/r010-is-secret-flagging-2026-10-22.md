# R-010 — `is_secret` flagging applied, and why the CLI silently failed (2026-10-22)

**Status:** both high-value secrets flagged secret; values now masked. **Verified in deployment** —
the masked value reaches the function runtime and service-role routes work, in a preview first and
then in production (§5).

---

## 1. The CLI path silently no-ops — root cause found

`netlify env:set KEY --secret` reported **success** twice:

```
Set environment variable SUPABASE_SERVICE_ROLE_KEY as a secret in the deploy-preview branch
```

But the authoritative `getEnvVars` metadata kept `is_secret = False` and the value stayed
readable. Attempting the same update through the API surfaced the reason the CLI hides:

```
HTTP 422
{"code":422,"message":"Secrets are not allowed to run in 'post_processing' scopes."}
```

This is exactly the constraint R-010 predicted. The CLI prints a success message and swallows the
422 — so the flag appears to apply and does not.

**The working path:** `PUT /accounts/{account_id}/env/{key}?site_id={site_id}` with the full body
(`key`, `values`, `is_secret: true`) and **`post_processing` removed from `scopes`**.

`AIRDROP_WALLET_PRIVATE_KEY` already had `scopes: ['builds','functions','runtime']` — i.e. someone
had already removed `post_processing` from it, which is why it was flagged successfully and why its
value read back masked.

## 2. State before and after

| Variable | Before | After |
|---|---|---|
| `AIRDROP_WALLET_PRIVATE_KEY` | `is_secret=True`, no `post_processing` | **already correct — unchanged** |
| `SUPABASE_SERVICE_ROLE_KEY` | `is_secret=False`, `post_processing` present | **`is_secret=True`**, `post_processing` dropped |

All four contexts (`dev`, `branch-deploy`, `deploy-preview`, `production`) were preserved with their
values intact — the update sent each value back with its existing `id`.

Readback confirms the effect: `env:get SUPABASE_SERVICE_ROLE_KEY --context production` now returns
`****************a2t2` (20 chars, masked) instead of the 41-char key.

**Every other variable remains `is_secret=False`**, which is correct: `NEXT_PUBLIC_*` values are
compiled into the client bundle by design and must never be flagged.

## 3. R-010's original statement was outdated

R-010 records "`is_secret` is false on every variable". That is no longer true —
`AIRDROP_WALLET_PRIVATE_KEY` was **already** flagged secret (with `post_processing` already
dropped), so the register was describing a state that had since changed. Only the service-role key
actually needed work.

## 4. Branch deploys never build — R-010's stated risk is largely moot

Across the last **100** deploys: `production` **58**, `deploy-preview` **42**, **`branch-deploy` 0**.

Pushing a branch does not produce a branch-deploy build on this site. R-010's warning that secrets
"can be masked inside functions on **branch deploys**" therefore does not apply here — the live
contexts are `production` and `deploy-preview`. This also narrows R-009's exposure surface: the
"arbitrary branch code" path is **PR previews**, not branch deploys.

## 5. Deployed verification — PASSED (preview, then production)

The flag resolves at **deploy time**, so nothing already deployed was affected. Verified in the
intended order — preview first, so a masking failure would break a preview rather than production.

**Preview — `deploy-preview-39`:**

| Check | Result |
|---|---|
| `/api/public/offers` | **200** |
| `/api/public/transparency` | **200** |
| `/api/token-stats` | **200** |
| `/api/health/rate-limit` | **200** — `shared: true, backend: supabase` |
| D4 harness | **all 6 checks pass** |

**Production — deploy `6d8ea981`:**

| Check | Result |
|---|---|
| `/auth/login` | **200** (15,241 bytes) |
| `/api/public/offers` | **200** — **786 bytes of real data** |
| `/api/public/transparency` | **200** |
| `/api/token-stats` | **200** |
| `/api/health/rate-limit` | **200** — `shared: true, backend: supabase` |

**The decisive signal is `/api/health/rate-limit` reporting `backend: supabase, shared: true`.**
That route reads a Postgres table through `createServiceClient()`, so a healthy response proves the
**masked** service-role secret reaches the function runtime and authenticates. `/api/public/offers`
returning 786 bytes of real data independently confirms a service-role query succeeded.

**R-010's masking concern did not materialise.** A secret being masked at rest does not prevent it
from being injected into functions at runtime — the flag controls read-back through the API/UI, not
delivery to the runtime. That distinction is why the change is safe.

## 6. Incident — the service-role key entered the session transcript

`netlify env:list --json` prints **unflagged** values in full. Because
`SUPABASE_SERVICE_ROLE_KEY` was not flagged, its value was written into this session's transcript
several times before the flag was applied. **Rotation is recommended**, and the owner has approved
it. This is a recurrence of an incident the register already records once ("rotated a second time
after the first value was partially exposed in a transcript").

Note the ordering consequence: rotating the key will require setting a **new** value, and the flag
is already in place, so the replacement must be written with the secret flag retained — otherwise
the exposure is simply recreated.

## 7. Reproduce / recover

```bash
# read authoritative flags
netlify api getEnvVars --data '{"account_id":"689a9cd8d8b1feb66fe3d07d","site_id":"9617719a-40f4-4743-8b85-770c2fe61f63"}'

# flag a variable (CLI path DOES NOT WORK — use the API with post_processing removed)
curl -X PUT -H "Authorization: Bearer $NF_TOKEN" -H "Content-Type: application/json" \
  --data @body.json \
  "https://api.netlify.com/api/v1/accounts/$ACCT/env/$KEY?site_id=$SITE"
# body.json = {key, scopes:[builds,functions,runtime], values:[{id,value,context}...], is_secret:true}
```

**The flag is irreversible** — it cannot be removed once set.
