# R-009 / NA-8 — Production Supabase service-role key rotation (zero-outage cutover) — 2026-10-23

**Status:** COMPLETE and **verified in production after revocation** — the cutover is proven, not merely
configured. Closes the rotation item carried by R-009/NA-8 and the R-010 transcript-exposure incident.

**Method:** zero-outage cutover (Option 1, new-format `sb_secret_` key). The old key was kept valid until
the very last step, giving rollback; it was revoked only after the new key was verified live in a
deployment. **No user was signed out** — the anon key is untouched.

---

## 1. Why

`netlify env:list --json` prints **unflagged** values in full. Before `SUPABASE_SERVICE_ROLE_KEY` was
flagged secret (R-010), its value entered a previous session's transcript. Rotation was approved. This is
the second time a value has been exposed this way (the register records an earlier partial exposure).

## 2. Measured key identities — and a correction to the record

Three distinct production/staging service keys were in play. Identified by **measurement**, not by the
recorded prose:

| Key | Tail | sha256[:10] of the value | Probe (see §3) | Role |
|---|---|---|---|---|
| staging service key (previews + local fixture) | `a2t2` | `14eaa80ac7` | **staging 200 / production 401** | **staging** |
| **old production key** (leaked) | **`3Sit`** | value never available | — (masked) | **revoked 2026-10-23** |
| new production key | `3hY1` | `1672f1da5f` | **production 200 / staging 401** | live |

**CORRECTION — the recorded "production" masked readback was a misattribution.** The brief and R-010 §2/§6
record `env:get SUPABASE_SERVICE_ROLE_KEY --context production` returning `****************a2t2`. That is
**the staging key's mask, not production's**. Proof, deterministic:

- `sha256("****************a2t2")[:10] = e79dc94d5e` — which is exactly the **preview** contexts'
  recorded mask hash (`branch-deploy` *and* `deploy-preview`), **not** the production context's.
- The production context's pre-change mask hashed to `d4871bb859`. Because a mask is a fixed-shape
  20-char string, equal masks hash equal; different hashes ⇒ different masks ⇒ different tails. Enumerating
  the 4-char tail space (`[A-Za-z0-9_-]^4`) against `d4871bb859` yields **`3Sit`**.

So `a2t2` is the **staging** key (it probes staging 200 / production 401), and the production key tailed
`3Sit`. This is a further instance of the register's recurring defect class: recorded prose outliving its
evidence. The staging key with tail `a2t2` **must not be revoked** — it backs the preview contexts and the
local staging fixture.

The old key's `sha256[:10]` recorded in the brief as `459ae3dc9f` could **not** be re-derived: the value was
already masked by the time of this session, and it matches neither the staging key (`14eaa80ac7`) nor the
new key (`1672f1da5f`). Carried as a claim, not a measurement.

## 3. Validation probe (candidate + controls) — PASSED

`GET https://<ref>.supabase.co/rest/v1/users?select=id&limit=1` with the key in the **`apikey` header only**
(new-format `sb_secret_` keys are never sent as Bearer). Result:

| Test | Expected | Observed |
|---|---|---|
| candidate (new key) → production | 200 | **200** ✅ |
| candidate (new key) → staging | 401 (project-scoped) | **401** ✅ |
| control: staging key → staging | 200 (probe works) | **200** ✅ |
| control: invalid key → production | 401 | **401** ✅ |

**Formatting trap hit and cleared.** The key as supplied arrived **line-wrapped**: 42 bytes with an internal
`\n` at index 15, which curl rejects as an illegal header character (**HTTP 000** — the key never reached the
server). Removing the wrap yields exactly **41 characters**, valid charset and `sb_secret_` prefix. Length
and format say nothing about which project a key belongs to or whether it is live — the probe is the arbiter
(runbook §B, "two false starts"). Normalized to a single 41-char line before use; the raw 42-byte file was
not reused.

## 4. Netlify production context update — via API, one value only

The variable is now `is_secret: true`, so `getEnvVars` returns **masked** values for `production`,
`deploy-preview` and `branch-deploy` (only `dev` is readable). A full-variable `PUT` would therefore have
written those masked strings back and **clobbered the other contexts**. The correct instrument is the
single-value endpoint:

```
PATCH /api/v1/accounts/{account_id}/env/SUPABASE_SERVICE_ROLE_KEY?site_id={site_id}
body: {"context":"production","value":"<new key>"}     # read from a file; never printed
```

Result — **HTTP 200**, and:

| Field | Before | After |
|---|---|---|
| `is_secret` | `true` | **`true` — retained** (exposure not recreated) |
| `scopes` | `['builds','functions','runtime']` | **unchanged** (`post_processing` still absent) |
| `production` mask hash | `d4871bb859` | **`f2c8a17069`** (tail `****************3hY1` = the file's tail) |
| `dev` / `branch-deploy` / `deploy-preview` | `bca980ce73` / `e79dc94d5e` / `e79dc94d5e` | **byte-identical (untouched)** |

## 5. Deploy — same commit, fresh environment

Environment variables resolve at **deploy time**, so a rebuild was required. `POST /sites/{site_id}/builds`
with `{"clear_cache": true}` → deploy `6adae4cb7acc263b2e6c9595`, commit **`bc34a017`** (the `main` HEAD that
was already deployed — **no code change**), state `ready` 2026-10-23T04:38:35Z.

## 6. Verification

**Pre-revoke (step 5).** `/api/health/rate-limit` → 200 `shared:true, backend:supabase`; `/api/public/offers`
→ 200, 786 bytes of real data (`KAST`); `/api/public/transparency` → 200; `/auth/login` → 200.
*Stated plainly: this passes with **either** key while both are valid — it proves the runtime reached a
working key, not which one.*

**Revocation (step 6).** The owner deleted the **`3Sit`** key in the **production** project
(`flasgvendiiasuixeqzu`) → **OPERATOR OBSERVATION**. The owner also reported two further production secret
keys present: **`xvxk`** and a default **`TLo1`** (recorded, not acted on; see §8).

**Post-revoke (step 7 — the decisive step).** With `3Sit` gone, the live deploy `6adae4cb`
(`bc34a017`, built after the env change) returned:

| Route | Result |
|---|---|
| `/api/health/rate-limit` | **200** — `shared:true, backend:supabase` (fresh process; `since` advanced) |
| `/api/public/offers` | **200** — 786 bytes real data |
| `/api/public/transparency` | **200** |
| `/auth/login` | **200** |
| `/api/token-stats` | **200** |

`/api/health/rate-limit` reads Postgres through `createServiceClient()`. Had the deployment baked the old
key, revoking `3Sit` would now break every service-role route. It did not — therefore the **new** key is
authenticating in production, independently of the revoked key. **This is the check that proves the cutover.**

## 7. Cleanup

`~/nf-new-key.txt` and the four intermediate Netlify JSON captures were **shredded** (4× random overwrite,
then unlink) and confirmed absent. The key file never entered this session's transcript.

## 8. Residual, stated rather than glossed

- **Additional production secret keys `xvxk` and `TLo1`** exist and remain **valid** — deleting one secret
  key does not revoke the others. Per the runbook's consumer enumeration the only place a production
  service-role key was held was the Netlify production context, so these are most likely unused leftovers,
  but that is **not verified here**. Recommend the owner confirm whether either is referenced anywhere and,
  if not, revoke them: unused production service-role keys are standing surface of the same kind this
  rotation just closed. This is an owner decision, not an agent action.
- The **staging** key (tail `a2t2`) is deliberately **untouched** — it is correct for the preview contexts
  and the local staging fixture.
- The old key's value was never available to the agent, so it could not be probed before revocation; the
  revocation rests on the operator's action **corroborated by** the post-revoke verification, which is not a
  substitute for it.
- `git` history of this file is not a deployment: **no merge to `main` is implied or performed here.**

## 9. Reproduce / recover

```bash
# identities (metadata only; never print secret values)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.netlify.com/api/v1/accounts/$ACCT/env?site_id=$SITE" \
  | python3 -c 'import sys,json,hashlib
for v in json.load(sys.stdin):
  if v["key"]=="SUPABASE_SERVICE_ROLE_KEY":
    print(v["is_secret"], v["scopes"])
    for x in v["values"]:
      val=x.get("value") or ""
      print(" ", x["context"], len(val), hashlib.sha256(val.encode()).hexdigest()[:10])'

# swap one context's value (secret-safe: build the body from a file, then delete the file)
python3 -c 'import json,os;open("/tmp/b.json","w").write(json.dumps({"context":"production","value":open(os.path.expanduser("~/nf-new-key.txt")).read()}))'
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data @/tmp/b.json "https://api.netlify.com/api/v1/accounts/$ACCT/env/SUPABASE_SERVICE_ROLE_KEY?site_id=$SITE"
rm -P /tmp/b.json

# deploy (same commit, fresh env) and verify
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"clear_cache":true}' "https://api.netlify.com/api/v1/sites/$SITE/builds"
curl -s https://app.bitxbit.com.au/api/health/rate-limit   # expect shared:true, backend:supabase
```
