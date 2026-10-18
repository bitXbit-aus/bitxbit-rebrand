# Dependency Vulnerability Impact Assessment

**Date:** October 19, 2026
**Scope:** `dashboard-app` production dependency tree (`npm audit --omit=dev`)
**Evidence level:** Live audit of the installed tree on this branch. Raw snapshot:
`docs/security/evidence/npm-audit-snapshot-2026-10-19.json`.

A passing build and a green CI run say nothing about dependency risk. This
document is the required impact assessment for production readiness: what is
actually reachable, what is not, and what must be fixed before launch.

## Summary

| Severity | Packages affected |
|---|---|
| Critical | 3 |
| High | 41 |
| Moderate | 70 |
| Low | 20 |
| **Total** | **134** |

134 *packages* carry advisories, drawn from **85 distinct advisories**. The
package count overstates real exposure: the Solana wallet-adapter stack accounts
for most moderate/low entries through a small number of shared transitive issues.

**Provenance, stated precisely.** This branch adds two direct dependencies —
`tweetnacl` (wallet-signature verification) and `@upstash/redis` (shared
rate-limit backend) — and regenerates the lockfile. **Neither added package
carries an advisory.** Every finding below sits in the pre-existing tree that
`main` also carries.

---

## 1. Critical: Next.js middleware authorization bypass

**`next@14.1.0` is installed, and the application relies on middleware for route
authorization.** `middleware.ts` redirects unauthenticated users, rejects
inactive accounts, and blocks non-admins from `/admin/*`.

- Advisory: **GHSA-f82v-jwr5-mffw — Authorization Bypass in Next.js Middleware**
- CVSS: **9.1 (critical)** — vulnerable range `>=14.0.0 <14.2.25`
- Status: **live and applicable today.**

This is the one finding that is both critical *and* squarely reachable. It is the
strongest argument for remediating the Next.js version before production.

### The npm-suggested fix is not sufficient

`npm audit` proposes `next@14.2.35` and reports `isSemVerMajor: false`. That reads
like a safe in-range bump. It is not enough:

| Candidate version | Advisories remaining (of 34 on `next`) |
|---|---|
| 14.2.35 — npm's suggestion | **21** |
| 15.5.24 | 0 |

14.2.35 clears the middleware bypass and several older issues but leaves **2
criticals and 7 highs**. Full clearance requires **Next 15.5.24+** — a
**major-version migration** with genuine breaking changes (async request APIs,
caching semantics, changed defaults). It must be planned and regression-tested,
not applied as a patch bump.

---

## 2. Applicability review

Not every advisory is reachable in this deployment. Assessed against the actual
configuration (`next.config.mjs`, `middleware.ts`, Netlify/Linux hosting):

| Advisory | Severity | Applies? | Reasoning |
|---|---|---|---|
| Next.js middleware authorization bypass (GHSA-f82v-jwr5-mffw) | critical | **Yes** | Middleware performs real authorization gating |
| Next.js RCE on **Windows**-hosted servers (GHSA-p293-qw3h-jr36) | critical | **No** | Deployment is Netlify (Linux); CI is `ubuntu-latest` |
| Next.js RCE in **Image Optimization API**, AVIF (GHSA-2xp9-vwfh-vxw4) | critical | **No** | `images.unoptimized: true` disables the optimizer; `next/image` unused |
| Next.js Middleware/Proxy bypass, **Pages Router i18n** (GHSA-36qx-fr4f-26g5) | high | **No** | App Router only; no `pages/`; no `i18n` config |
| Next.js Server Actions DoS (GHSA-m99w-x7hq-7vfj) | high | **Yes** | Server Actions used extensively (`lib/actions.ts`) |
| Next.js RSC deserialization / Server Component DoS (several) | high | **Yes** | App Router + RSC in use |
| Next.js SSRF in rewrites (GHSA-p9j2-gv94-2wf4) | high | **Partial** | Reachable only via attacker-influenced `rewrites`; none configured |
| `@solana/spl-token` → `bigint-buffer` overflow (GHSA-3gc7-fjrx-p6mg) | high | **Low** | `bigint-buffer@1.1.5` is the latest release and has **no fix**; reachable only via decoding untrusted token accounts. The treasury mint is operator-controlled. |
| `tar` family (8 advisories) | critical/high | **Build-time only** | Transitive via the `supabase` **CLI** (devDependency); not in the runtime bundle |
| `protobufjs` (6 advisories) | critical/high | **Browser-side** | Transitive via Trezor/WalletConnect wallet adapters; not in the server runtime |
| `lodash`, `ws`, `minimatch`, `glob`, `braces`, `toml`, `source-map-js` | high | **Build/browser only** | Tooling or wallet-adapter machinery; no server-side untrusted-input path |
| `postcss` advisories | high | **No** | Installed `8.5.28` is above the vulnerable ranges; findings target nested older build-time copies |
| Wallet-adapter stack (~70 moderate/low) | moderate/low | **Browser-only** | Third-party wallet connectors; several have no upstream fix |

---

## 3. Remediation plan (controlled, phased)

**Do not run `npm audit fix --force`.** On this graph a forced fix downgrades
`@solana/spl-token` to `0.1.8` and `@solana/wallet-adapter-wallets` to `0.18.2` —
both major regressions that break the SPL-token transfer path.

**Phase A — Next.js security posture (highest value, standalone PR)**
1. Upgrade within 14.x to `14.2.35` as an interim step; this closes the live
   middleware authorization bypass immediately.
2. Plan and execute the `15.5.24+` major migration separately, with full
   regression: middleware authorization, Server Actions, admin routes, payout
   flow, wallet verification, and the dummy-env production build.
3. Re-run `npm audit --omit=dev` and confirm Next.js advisories reach zero.

**Phase B — browser wallet-adapter stack.** Upgrade `@solana/wallet-adapter-*` as
a group, or reduce surface by importing only the connectors the product actually
offers. The dashboard pulls in the full `@solana/wallet-adapter-wallets` bundle,
which drags in React Native and Trezor internals the web app never executes.

**Phase C — build/dev tooling.** Bump the `supabase` CLI, `eslint-config-next`,
and the Tailwind/TypeScript toolchain in devDependencies. These clear the
`tar`/`glob`/`eslint` findings with no runtime risk.

**Phase D — accepted risk.** Advisories with no upstream fix (`bigint-buffer`,
parts of the wallet-adapter and React Native trees) are documented, monitored, and
re-checked on each advisory refresh. Where a package is unused at runtime,
removal beats waiting.

---

## 4. Wallet adapters, build tooling, and React Native (prior assessment)

Retained from the earlier audit, still accurate:

- **Wallet adapters (critical/high).** The stack depends on older
  `@solana/web3.js`, `@solana/spl-token`, `bigint-buffer`, and React Native mobile
  internals. These run in the browser and sign messages/transactions, so a
  memory-corruption or prototype-pollution flaw could affect signing. Keep these
  current and test after each upgrade — major `@solana/web3.js` changes alter API
  signatures.
- **Build/dev tooling (high/moderate).** `braces`, `chokidar`, `micromatch`,
  `fast-glob`, `minimatch` carry DoS advisories via nested patterns. These are
  dev-time risks; production bundles do not run these matchers against user input.
- **React Native transitive deps.** `react-native`,
  `@react-native/virtualized-lists`, and `@react-native/community-cli-plugin`
  arrive via Solana mobile adapters even though this is a web app. Unused native
  code inflates attack surface and audit noise — pruning the adapter imports
  removes it at the source.

---

## 5. What this branch does about it

This branch **does not perform the upgrades.** Dependency upgrades are a distinct
change class needing the full regression suite; folding them into the Phase 1
hardening commit would obscure the security narrative and complicate rollback.
This assessment is the required impact analysis. Phases A–C are the authorised
follow-up work and should land as their own reviewed PRs.

## Reproduce

```bash
cd dashboard-app
npm audit --omit=dev          # human-readable
npm audit --omit=dev --json   # machine-readable, matches the snapshot
```

Run before each release and diff severity counts against the previous release.
Any increase in critical/high findings should block deployment until assessed.
