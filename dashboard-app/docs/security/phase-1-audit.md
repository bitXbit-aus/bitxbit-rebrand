# Phase 1 Security Audit

**Date:** October 16, 2026  
**Scope:** `dashboard-app` source code and versioned Supabase migrations  
**Evidence level:** Confirmed from repository source only. No production database, Supabase project, deployed application, or live policy catalog was accessed.

## Confirmed source findings

1. **Admin authorization trusted mutable profile data.** Existing RLS policies, middleware, and layouts treated `public.users.role = 'admin'` as the authorization source. The original self-update policy allowed a member to update their entire own row, and table-level grants were not narrowed by column.
2. **Suspension was not enforced at the route or policy boundary.** Dashboard routes required a valid auth session but did not reject `users.status = 'suspended'`. Existing admin predicates checked role only.
3. **Admin policy predicates queried `public.users` from policies on `public.users`.** This pattern risks recursive RLS evaluation and coupled every administrative policy to a member-visible compatibility table.
4. **Reward-bearing activity inserts were client-authorized.** `Activities insert own` allowed authenticated clients to create rows used by reward calculations.
5. **Storage writes were open to every authenticated account.** The assets bucket had authenticated INSERT, UPDATE, and DELETE policies without an admin or ownership boundary.
6. **Service-role server actions lacked a shared authorization guard.** User-management and storage helpers instantiated the service client without first proving the caller's session and protected authorization.
7. **No append-only security audit relation existed.** Administrative and financial mutations had no common actor/action/before/after/request-id record.
8. **Several state and amount fields lacked safe forward integrity checks.** Date ordering and non-negative financial constraints were absent on reward periods, income, rewards, projects, and transparency totals.
9. **Security-definer signup functions did not set a fixed search path.** Existing trigger functions relied on ambient name resolution.
10. **Compatibility-sensitive fields were used broadly.** Application code still reads `users.role` and `users.status`, so removing those columns in this phase would break the current UI and reports.

## Initial fixes implemented

Migration `010_phase1_security_foundation.sql`:

- Adds protected `public.user_authorizations`, keyed one-to-one to `public.users`, and backfills every current profile while preserving role and status.
- Gives existing admins the initial management capabilities and provisions new auth users with active member authorization.
- Keeps `users.role/status` as synchronized compatibility fields, while revoking broad authenticated UPDATE and granting only `UPDATE(display_name)`. Admin promotion/demotion is now gated in server actions by `manage_security` plus AAL2; `manage_users` alone can only perform ordinary profile/status administration.
- Adds fixed-search-path, owner-controlled `SECURITY DEFINER` helpers for active-user, active-admin, capability, and caller-scoped authorization RPC checks.
- Replaces all source-defined admin RLS predicates with the protected helper and applies active-account checks to member-scoped policies.
- Removes authenticated activity insertion and authenticated storage mutation policies/grants while retaining public storage reads. Offer clicks are restored through a service-role-only `record_trusted_offer_click` RPC called after `requireActiveUser`; the RPC validates the active offer and exact URL, serializes same-user/same-offer ingestion, and suppresses duplicates inside a 30-second window.
- Adds append-only `security_audit_log`, active-admin read policy, immutable actor UUID attribution without a deleting-user foreign key, actor role/status/capability snapshots, service-role insert access, indexes, and database audit triggers on authorization, profile, income, reward-period, and reward records.
- Adds data-preserving `NOT VALID` constraints for non-negative amounts and reward-period date ordering, plus supporting indexes.

Application foundation:

- Adds server-only `requireActiveUser`, `requireActiveAdmin`, and `requireCapability` helpers. They verify the auth session before creating a service client, reject missing/inactive authorization, and expose AAL scaffolding.
- Adds a server-only application audit writer requiring a previously authorized context.
- Changes middleware to use the caller-scoped authorization RPC; no service-role credential is instantiated at the edge.
- Changes admin/dashboard layouts to enforce protected active authorization.
- Restores member offer-click tracking through trusted server ingestion. Navigation is opened before analytics is awaited, so an audit or ingestion failure does not block the outbound offer.
- Protects service-role user management, storage mutation, wallet mutation, treasury reads, and airdrop entry points with capability/session checks and actor-attributed success/failure audits. `writeSecurityAudit` rejects fabricated contexts at runtime.
- Enforces bounded unique UUID batches, valid role/status values, no caller self-demotion/disable/delete, and preservation of at least one active security-capable admin where the affected rows can remove one.
- Makes migration `010` replay-safe for replacement policies and new objects; existing constraints are added only when absent, so a later `VALIDATE CONSTRAINT` state is not reset by replay.
- Limits the ordinary profile form to `display_name`; wallet updates remain in the separately validated wallet flow.

## Task 3 — Wallet ownership verification

### Confirmed source finding

The previous `saveWalletAddress()` action accepted any syntactically valid Solana public key from the connected wallet adapter. Connection was treated as proof of ownership, so a member could register another party's public key as their payout destination.

### Implemented fixes

Migration `011_wallet_verification.sql`:

- Adds `public.wallet_verification_challenges` with a unique nonce, the exact message to sign, expiry, and used/verified timestamps.
- Adds `users.wallet_verified` and `users.wallet_verified_at`, backfills existing addresses as `FALSE` **only once** (only rows where `wallet_verified IS NULL` are touched), and protects these columns via RLS (members cannot write them directly). The one-time backfill ensures a migration replay cannot reset wallets that members have already verified.
- Provides `public.consume_wallet_verification_challenge(UUID, TEXT, TEXT)` as a SECURITY DEFINER function that atomically locks, validates, and consumes a challenge exactly once.
- Provides `public.verify_wallet_challenge(UUID, TEXT, TEXT)` as a SECURITY DEFINER function that consumes the signed challenge and updates the payout address + verified flag together inside a single database transaction.
- Adds `sync_wallet_verification_status()` trigger that resets `wallet_verified` whenever `wallet_address` changes, preventing an unverified substitution from inheriting a previous verified flag. The verification function performs the address update and the verification update as two statements within the same transaction, so the final state is verified even though the trigger resets on the first statement.

Application changes:

- New server-only `lib/wallet-crypto.ts` builds a SIWS-compatible message and verifies Ed25519 detached signatures using `tweetnacl` and `@solana/web3.js`.
- New server-only `lib/wallet-verification.ts` exposes:
  - `requestWalletVerificationChallenge(walletAddress)` — creates a 5-minute, single-use challenge after `requireActiveUser()`.
  - `verifyWalletSignature()` in `lib/wallet-verification.ts` validates the challenge, verifies the signature, and calls `public.verify_wallet_challenge()` so the nonce consumption, address update, and verified-flag update happen atomically inside the database.
  - `getWalletVerificationStatus()` — returns the member's current saved/verified state.
- `saveWalletAddress()` in `lib/actions.ts` now rejects address changes; it only permits idempotent re-saving of the currently verified address. All payout-address changes must go through `verifyWalletSignature`.
- `/dashboard/wallet/page.tsx` no longer treats connection as verification. It displays verification status, shows a "Verify Ownership" button when the connected wallet differs from the saved address or is unverified, and signs the SIWS message with the wallet adapter before submitting it server-side.
- Unit tests in `lib/wallet-crypto.test.ts` cover message construction, valid signatures, attacker keypairs, and message-replay attacks.

### Acceptance test

A member cannot register another user's wallet as their payout destination by knowing only the public address. They must produce a valid Ed25519 signature over a domain-bound, single-use, time-bound challenge generated for their authenticated account.

## Task 4 — Secure token distribution and affiliate payouts

### Confirmed source finding

The previous `airdropRewards()` action updated `user_rewards` rows directly from an on-chain transfer result and offered a separate `distributeRewards()`/`distributeRewardsWithTx()` path that let an administrator mark rewards distributed by supplying a transaction hash. There was no durable record of each attempted payout, no cryptographic wallet-ownership gate before payout, and no on-chain reconciliation, so duplicate distributions, unverified destinations, or failed transfers could leave the database and ledger inconsistent.

### Implemented fixes

Migration `012_secure_token_distribution.sql`:

- Adds `public.payout_operations` as the durable, idempotent record for every token distribution. Columns include a unique `operation_id`, reward period/reward/user references, exact `token_amount_raw` (smallest token units), `token_decimals`, status (`pending` → `submitted` → `confirmed`/`failed`/`cancelled`), `transaction_hash`, on-chain confirmation metadata, submission/error timestamps, and the acting admin `actor_id`.
- Enforces `UNIQUE(operation_id)`, a status check constraint (`pending`, `submitting`, `submitted`, `confirmed`, `failed`, `cancelled`), and indexes on `(reward_period_id, status)`, `(reward_id, created_at DESC)`, and `(transaction_hash)`.
- Adds a `reward_periods_status_check` constraint limiting `reward_periods.status` to `pending`, `calculating`, `approved`, or `distributed`.
- Revokes direct authenticated access; read access is admin-only via `is_active_admin()`. Writes go through service-role Server Actions after capability checks.
- Adds `public.claim_payout_operation(TEXT, UUID)` — a `SECURITY DEFINER` function that atomically locks and moves a `pending`/`failed` operation to `submitting`, returning the operation ID only to the caller that wins the race. Concurrent callers receive `NULL`.
- Adds an audit trigger that writes every INSERT/UPDATE/DELETE on `payout_operations` to `security_audit_log`.
- Adds `prevent_confirmed_payout_mutation()` trigger that rejects **any** `UPDATE` to a `confirmed` operation. Once confirmed, the entire row is immutable, not just its status.

Application changes:

- New server-only `lib/payout.ts` owns all Solana transfer logic:
  - `getAirdropWalletBalances`, `amountToRaw`, `rawToAmount` for exact token-unit arithmetic.
  - `getAirdropWalletAddress()` exposes the expected treasury wallet public key for on-chain reconciliation.
  - `executePayoutTransfers(transfers[])` submits transfers sequentially with a single signer, returning per-operation results.
  - `confirmTokenTransfer(txHash, sourceWalletAddress, walletAddress, amountRaw)` waits for a finalized or confirmed signature status, parses the SPL-token `transfer` instruction, and verifies the program ID (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`), the source ATA, the destination ATA, the transfer authority, and the exact raw amount against the expected payout. Only transfers that match the expected treasury source, token mint (via deterministic ATAs), recipient, and amount are accepted as confirmed.
- `lib/solana.ts` is refactored to re-export payout helpers and keep only Solana-specific utilities (`isValidSolanaAddress`, `getTokenBalance`). The deprecated `distributeTokens()` wrapper was removed so there is no non-idempotent legacy distribution path.
- `calculateRewards()` in `lib/actions.ts` now refuses to recalculate a period whose status is `approved` or `distributed`, and refuses to recalculate any period that already has `payout_operations` rows. This prevents accidental overwriting of rewards after they have been approved or once payout activity has begun.
- `correctRewards(periodId, reason)` is a new explicit audited correction process. It requires `manage_rewards`, validates a non-empty reason, rejects distributed periods, rejects periods with confirmed payouts, deletes any pending/failed/submitted payout operations, resets the period to `pending`, deletes existing `user_rewards`, and recalculates. The reason is captured in the audit log.
- `approveRewards()` remains unchanged but now operates on a period that has been locked into the `calculating` state by `calculateRewards()` or `correctRewards()`.
- `airdropRewards()` in `lib/actions.ts` now:
  - Requires `manage_rewards` capability.
  - Verifies the reward period is `approved`.
  - Loads approved rewards joined to `users.wallet_address` and `users.wallet_verified`.
  - Skips unverified, missing, invalid, or zero-amount destinations.
  - Creates a deterministic `operation_id` (`payout:<periodId>:<rewardId>`) per reward. Existing `confirmed` operations are skipped; existing `submitted` operations are reconciled on-chain before any retry; existing `submitting` operations are left alone (no auto-retry); only `pending` or `failed` operations may be claimed.
  - Claims each eligible operation atomically via `public.claim_payout_operation()`. Only the winning caller may submit a blockchain transaction for that reward; concurrent callers receive `NULL` and skip the operation.
  - Checks the treasury wallet's token and SOL balances using exact raw amounts for the claimed operations only.
  - Submits transfers via `executePayoutTransfers` and immediately persists each returned transaction hash as `submitted`.
  - Reconciles each submitted transfer on-chain via `confirmTokenTransfer`, updating operations to `confirmed` and `user_rewards` to `distributed` only after on-chain verification. Operations that cannot be confirmed (network outage, unknown status) remain `submitted` and are **not** automatically re-submitted; they require explicit reconciliation or manual review.
  - Updates the reward period to `distributed` only when every reward has a confirmed operation.
- `sendTestAirdrop()` is now disabled unless `ENABLE_TEST_AIRDROP=true`, preventing accidental production outflows. It also confirms the test transfer on-chain before reporting success.
- The manual "Mark Distributed" form and `distributeRewards()`/`distributeRewardsWithTx()` have been removed from `lib/actions.ts` and `app/admin/rewards/page.tsx`.

### Acceptance test

An administrator cannot mark rewards distributed without an on-chain transfer. A reward cannot be paid twice for the same period because the deterministic `operation_id` is guarded by `claim_payout_operation()`: only one process can move an operation from `pending`/`failed` to `submitting`, and `submitted` operations are reconciled rather than re-submitted. A member whose wallet is unverified cannot receive a payout, and a transfer that reaches the blockchain but cannot be confirmed (network partition, dropped response) remains `submitted` and is never automatically retried as a new payment.

## Task 5 — Strengthen database security

### Confirmed source finding

Public API routes exposed some internal fields (`source_url` on activity, user IDs in referrer resolution), several routes accepted unbounded query parameters, and no consistent rate limiting or security headers were applied across the API surface.

### Implemented fixes

- Added `lib/rate-limit.ts` with a per-IP sliding-window rate limiter and `429 Too Many Requests` responses.
- Applied rate limiting to every public API route (`/api/public/*`), `/api/token-stats`, and the authenticated `/api/wallet/rewards` route.
- Added referral-code length validation (`≤ 64` characters) to `/api/public/resolve-referral` and UUID validation for the OAuth callback `ref` parameter.
- Ensured public routes return generic error messages; internal Supabase/RPC errors are logged server-side only.
- Added security headers via `middleware.ts` (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) and mirrored them in `netlify.toml` for static-file responses.

## Task 6 — Dependency and application security

### Confirmed source finding

`npm audit` reports inherited vulnerabilities, primarily in the Solana wallet-adapter transitive tree and build tooling. No direct application dependency is abandoned, but `npm audit fix --force` would install a breaking downgrade of `@solana/spl-token`.

### Implemented fixes

- Captured the full audit output to `docs/security/dependency-audit.md` with severity summary, risk categories, and explicit recommendation **not** to run `npm audit fix --force`.
- Documented a controlled upgrade plan for the Solana stack and a pruning strategy for unused React Native transitive dependencies.
- Hardened callback referrer validation and API input boundaries.

## Task 7 — Automated security testing

### Implemented tests

- `lib/authz-decision.test.ts` — active/suspended/deactivated account access, admin access, capability checks, AAL requirements.
- `lib/security-mutations.test.ts` — promotion/demotion classification, UUID/enum validation, bulk-id bounds, self-removal prevention, last-security-admin protection, trusted-click dedupe.
- `lib/wallet-crypto.test.ts` — SIWS message construction, valid signatures, attacker keypairs, message tampering.
- `lib/payout.test.ts` — exact token-unit conversion and round-trips.
- `lib/rate-limit.test.ts` — allow/block/reset behavior and per-client isolation.
- `scripts/test-phase1-migration-replay.sh` — replay-safe migration verification for `010`, `011`, and `012`.

### Test results

- `npm test` — 20/20 pass.
- `npm run test:migration` — pass.
- `npm run build` (dummy env) — pass.

## Task 8 — One Good Turn readiness

A separate architecture report, `docs/security/one-good-turn-readiness.md`, identifies reusable systems, proposed new tables (`membership_plans`, `member_subscriptions`, `merchant_offers`, `offer_redemptions`, and a future `promotional_draws` table), service boundaries, and the legal/regulatory prerequisites for any draw module.

## Deliverables

1. **Security Audit Report** — this document.
2. **Implemented Fixes** — working code on `security/phase-1-hardening` (commits `b087bad`, `af16085`, `66aab29`, `3cd8a64`, `ea0c301`).
3. **Supabase Security Migrations** — `010_phase1_security_foundation.sql`, `011_wallet_verification.sql`, `012_secure_token_distribution.sql`.
4. **Wallet Authentication Upgrade** — `lib/wallet-crypto.ts`, `lib/wallet-verification.ts`, `app/dashboard/wallet/page.tsx`.
5. **Token Distribution Improvements** — `lib/payout.ts`, hardened `airdropRewards()`, `payout_operations`.
6. **Automated Test Results** — 20 unit tests + migration replay test passing.
7. **Deployment and Recovery Guide** — `docs/security/database-migration-and-recovery.md`.
8. **Dependency Audit** — `docs/security/dependency-audit.md`.
9. **One Good Turn Integration Readiness Report** — `docs/security/one-good-turn-readiness.md`.

## Remaining work

- Apply and verify migrations `010`, `011`, and `012` in a non-production Supabase environment before production rollout. The repository replay test uses an isolated local PostgreSQL compatibility fixture; it is not production verification.
- Regenerate Supabase TypeScript database types after the migrations are applied to a linked project.
- Migrate admin user-management reads and UI filtering from compatibility `users.role/status` to an authorized server-side join/view when convenient.
- Add an explicit capability-management UI/action if delegated capability editing is required; any such action must use `manage_security` plus AAL2 and must retain the last-security-admin safeguards.
- Review every remaining Server Action for a named capability rather than relying only on protected admin RLS.
- Decide whether deactivated accounts should be retained indefinitely or mapped to an Auth ban/delete lifecycle; no deletion policy is introduced here.
- Validate legacy rows and mark the remaining `NOT VALID` constraints valid in a later forward migration.
- Application audit writes for user/profile/storage/wallet operations are currently separate from their underlying service-role mutation or external side effect. A process failure between mutation and audit can leave an unaudited success; use transactional database RPCs/outbox records for full atomicity in a later phase. Trusted click ingestion itself is transactionally deduplicated in the database.
- Bulk last-security-admin checks are enforced immediately before mutation but are not serialized across concurrent admin requests; move these mutations into a locking database RPC if concurrent security administration becomes common.
- Execute the controlled dependency upgrade plan in `docs/security/dependency-audit.md`; do not use `npm audit fix --force`.
- Replace the in-memory rate limiter with a shared store (Redis or Supabase-backed) if the app is deployed across multiple serverless functions.
- Conduct a staging end-to-end smoke test of wallet verification, airdrop idempotency, and admin capability enforcement before production.
- Obtain legal/regulatory sign-off before designing or enabling any One Good Turn promotional draw module.
