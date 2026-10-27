# CSP consolidation — 2026-10-27

**Status:** fixed in **PR #71** (branch `security/csp-consolidation`), awaiting merge — not released.
**Scope:** `dashboard-app`. **Register item:** R-017.

## What was wrong

The Content-Security-Policy was emitted by **two independent sources**:

- `netlify.toml` — a CDN header rule, `for = "/*"`
- `middleware.ts` — `applySecurityHeaders()`, set per response

The test in place (`lib/csp-policy.test.ts`) extracted both literals and asserted they *agreed*.
That is the weaker invariant: it documents the duplication and tolerates it, so a fix applied to one
emitter passes on that emitter's path and ships broken on the other. It is the same class of defect as
the wallet-iframe breakage that produced a white "This content is blocked." screen with a healthy
server and a *succeeded* audit entry.

## Measurement before the change

| Probe | Result | What it proved |
| --- | --- | --- |
| `GET /auth/login` (production) | exactly **1** CSP header | one policy is served — but both emitters produce an identical string, so this could **not** identify which one won |
| `GET /favicon.ico` (production) | **1** CSP header | the CDN rule is live on static paths, which middleware does not match |

**Recorded honestly: which emitter was authoritative on documents was never established by
measurement.** Rather than assume it, the change removes the second emitter, which makes the question
moot and the answer observable.

## Change

1. **`lib/csp.ts`** — the single definition. `middleware.ts` imports `CSP_HEADER` and
   `CONTENT_SECURITY_POLICY`; its inline literal is gone.
2. **`netlify.toml`** — CSP removed from the `[[headers]]` rule; the other security headers
   (`X-Frame-Options`, `HSTS`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) are unchanged. A
   test fails if a second definition reappears.
3. **`api.devnet.solana.com` removed from `connect-src`** — in **every** context, not just production.
   Justification: `components/providers/wallet-provider.tsx` pins
   `WalletAdapterNetwork.Mainnet`, so the browser resolves `api.mainnet-beta.solana.com`; a grep for
   `devnet` in `app/`, `components/` and `lib/` finds only a server-side comment in `lib/actions.ts`.
   Server-side RPC is `SOLANA_RPC_URL` (`lib/payout.ts`, `lib/solana.ts`) and is not subject to CSP.
   R-011 governs that separately.

## Verification — deploy preview, SHA `eba9344`

`https://deploy-preview-71--bitxbit-dashboard.netlify.app`

| Check | Result |
| --- | --- |
| `/auth/login` CSP header count | **1** |
| devnet occurrences in the served policy | **0** |
| `api.mainnet-beta.solana.com` present | yes |
| `frame-src` names `connect.solflare.com` + `keys.coinbase.com` | yes |
| `frame-ancestors 'none'` | yes |
| `/favicon.ico` CSP headers | **0** — accepted tradeoff (below) |
| CI "Browser smoke against the deploy preview" | **success** — no `securitypolicyviolation`, no console/page errors, no error shell, referenced chunks 200 |

The first row is the question the change raised: with the CDN rule gone, **middleware still applies
the header to documents**. Proven, not assumed.

**Accepted tradeoff:** static assets (images, `_next/static`, `favicon.ico`) no longer carry a CSP. A
CSP constrains document behaviour, not asset delivery, so this costs nothing real; the alternative was
keeping two definitions alive to cover responses where the header means nothing.

## Mutation tests

| Mutation | Result |
| --- | --- |
| Re-add a `Content-Security-Policy` to `netlify.toml` | **8 pass / 1 fail** |
| Re-add `api.devnet.solana.com` to `lib/csp.ts` | **8 pass / 1 fail** |
| Restore both | **9 pass / 0 fail** |

Both guards can fail, and fail for the right reason.

## Local gate

`tsc` 0 · `npm test` 255/255 · `npm run test:migration` 0 · `npm run build` 0.

## Not verified — stated explicitly

- **Production has not been observed under the new policy.** A merge is the release. The preview
  proves the mechanism; the same `curl` must be repeated against production after merge.
- **Static assets carry no CSP** (deliberate, above). If a document is ever served outside middleware
  — a static export, for instance — it needs the header added deliberately rather than inheriting it.
- **`'unsafe-eval'` remains in `script-src` in every context, including production.** Untouched here.
  Removing it is separate hardening and must be proven by hydration in a real browser, not by a build.
