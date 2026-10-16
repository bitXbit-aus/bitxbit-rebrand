# Dependency Security Audit

**Date:** October 16, 2026  
**Scope:** `dashboard-app/package-lock.json` and installed `node_modules`  
**Evidence level:** Repository-only. No live system, dependency tree, or build environment beyond the local workspace was accessed.

## Summary

`npm audit` reports **3 critical**, **41 high**, **70 moderate**, and **20 low** severity findings across **134 affected packages**. The majority originate from transitive dependencies pulled in by Solana wallet-adapter libraries (`@solana/wallet-adapter-react`, `@solana-mobile/*`) and development/build tooling (Tailwind CSS, ESLint/TypeScript toolchain, React Native internals). No direct dependency of the application code appears to be abandoned or unsupported, but several transitive packages are outdated and carry known advisories.

## Notable categories

### Solana wallet adapters (critical / high)

The wallet adapter stack depends on older versions of `@solana/web3.js`, `@solana/spl-token`, `bigint-buffer`, and React Native mobile adapter internals. Advisories include:

- `bigint-buffer` — buffer overflow via `toBigIntLE()`.
- `@solana/web3.js` — multiple inherited vulnerabilities in older releases.
- `@solana/spl-token` — depends on vulnerable `@solana/buffer-layout-utils` and metadata/group packages.

**Risk:** These packages run in the browser and sign messages/transactions. A memory-corruption or prototype-pollution vulnerability in the wallet stack could affect transaction signing or signature verification.

**Mitigation:** Keep wallet adapter packages current. Test thoroughly after each Solana package upgrade because major-version changes in `@solana/web3.js` change API signatures. Do not run `npm audit fix --force` blindly — the suggested `npm audit fix` wants to install `@solana/spl-token@0.1.8`, which is a breaking downgrade and could break SPL-token transfers.

### Build / dev tooling (high / moderate)

`braces`, `chokidar`, `micromatch`, `fast-glob`, and `minimatch` carry denial-of-service advisories via deeply nested patterns. These are used by Tailwind CSS, TypeScript/ESLint, and Next.js file watching.

**Risk:** Mostly development-time DoS (stack exhaustion). Production bundles do not execute these pattern matchers in response to user input.

**Mitigation:** Update Tailwind CSS and the TypeScript/ESLint toolchain when compatible versions are available. These are dev-time-only risks for this codebase.

### React Native transitive deps

`react-native`, `@react-native/virtualized-lists`, and `@react-native/community-cli-plugin` are pulled in by Solana mobile wallet adapters even though the dashboard is a web Next.js app.

**Risk:** Unused native code increases the dependency attack surface and audit noise.

**Mitigation:** Verify whether the mobile wallet adapters are required. If the web app only needs Phantom/Solflare/Coinbase browser wallets, consider importing only the browser adapters to prune React Native from the tree.

## Recommendations

1. **Do not run `npm audit fix --force`.** It proposes a breaking downgrade of `@solana/spl-token` that would break token transfers.
2. **Schedule a controlled Solana stack upgrade.** Target the latest compatible `@solana/web3.js` 1.x and matching `@solana/spl-token` and wallet-adapter versions. Run the full test suite and a devnet airdrop after each upgrade.
3. **Review wallet-adapter imports.** If mobile wallets are not required, replace `@solana/wallet-adapter-wallets` with individual browser-only adapters to remove React Native transitive dependencies.
4. **Update dev tooling independently.** Tailwind CSS, TypeScript, and ESLint can usually be upgraded without touching Solana packages.
5. **Monitor advisories weekly** during active development, especially for packages used in signing paths (`@solana/web3.js`, `tweetnacl`, `bs58`).
6. **Pin critical security patches** in `package.json` and verify the lockfile changes in review.

## Automated testing

Run `npm audit --json > /tmp/audit.json` before each release and diff the severity counts against the previous release. Any increase in critical/high findings should block deployment until assessed.
