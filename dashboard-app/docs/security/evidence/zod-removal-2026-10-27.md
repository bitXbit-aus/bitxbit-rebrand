# Removal of the unused `zod` dependency — 2026-10-27

**Register item:** R-018 (the entry that surfaced it). **Scope:** `dashboard-app/package.json` and the
lockfile. No application code changed.

## Why

R-018 recorded `zod` as a **direct runtime dependency** carrying a **high** advisory — *"Zod can exhaust
memory while validating oversized constrained collections"* — while being **imported nowhere**. `npm
audit`'s suggested fix was `zod@4.6.7`, a semver-major. Removing the dependency is strictly better than
upgrading it: it deletes the advisory *and* an unused supply-chain edge.

## Evidence that it was genuinely unused

Checked before removal, across every text file in the app (not just the extensions that would hold a
typical import):

| Check | Result |
| --- | --- |
| `grep -rn "zod"` over the whole tree, excluding `node_modules`/`.next`/`.test-dist` | matches only in `package.json`, `deno.lock`, and the register/evidence documents describing it |
| Dynamic import forms (`import("zod")`, `require('zod')`) | none |
| Packages in the lockfile **depending** on `zod` | **none** |
| Packages in the lockfile **peer-depending** on `zod` | **none** |

So it was neither imported by the app nor required transitively. Nothing could break by its absence.

## Change and lock discipline

1. Removed `"zod": "^3.22.4"` from `dependencies` (it was the last entry, so the preceding line's
   trailing comma was removed with it — JSON verified parseable afterwards).
2. Regenerated the lock with **`npm install`** (deliberately **without** `--legacy-peer-deps`, per this
   project's rule that the committed lock must resolve under CI's plain resolver).
3. Audited the lock diff for silent upgrades by comparing `packages[*].version` against the previous
   revision:

```
added:   0
removed: 1   node_modules/zod@3.25.76
VERSION CHANGES among persisting packages: 0
```

The only change is the removal. No transitive version moved.
4. Proved the committed lock with plain **`npm ci`** → exit 0, and `node_modules/zod` absent.

## Outcome

`npm audit`, before → after:

| | Before | After |
| --- | --- | --- |
| total | 28 | **27** |
| high | 7 | **6** |
| critical | 1 | 1 (unchanged — `tar`, dev-only) |
| `zod` present | yes | **no** |

## Local gate

`tsc` 0 · `npm test` **255/255** · `npm run test:migration` 0 · `npm run build` 0 · `npm ci` 0.

## `deno.lock` — flagged, deliberately not edited

`dashboard-app/deno.lock` is **tracked** and still lists `npm:zod@^3.22.4`. It is not a source of truth:

- it is a **generated artifact** of the Netlify CLI's edge bundler (it records `https://edge.netlify.com/`
  bootstrap modules alongside a mirror of `package.json` dependencies),
- **nothing in the repository runs Deno** — no `deno.json`/`deno.jsonc`, no `deno` script in
  `package.json`, no Deno source importing `zod`,
- it is **already stale**: it does not list `@playwright/test`, added 2026-10-27.

Hand-editing a generated lockfile to remove one line would produce a file that is *still* stale but now
also hand-modified. Left as-is, and recorded here so the mismatch is not mistaken for an oversight. If
this file should not be committed at all, that is a separate repository-hygiene decision.

## Not verified

- Nothing outstanding. The removal is total: no importer, no dependent, no peer, no version drift, and
  the lock resolves under the same resolver CI uses.
