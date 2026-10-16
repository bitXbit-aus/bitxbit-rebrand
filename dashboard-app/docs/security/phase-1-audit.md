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
- Adds `users.wallet_verified` and `users.wallet_verified_at`, backfills existing addresses as `FALSE`, and protects these columns via RLS (members cannot write them directly).
- Provides `public.consume_wallet_verification_challenge(UUID, TEXT, TEXT)` as a SECURITY DEFINER function that atomically locks, validates, and consumes a challenge exactly once.
- Adds `sync_wallet_verification_status()` trigger that resets `wallet_verified` whenever `wallet_address` changes, preventing an unverified substitution from inheriting a previous verified flag.

Application changes:

- New server-only `lib/wallet-crypto.ts` builds a SIWS-compatible message and verifies Ed25519 detached signatures using `tweetnacl` and `@solana/web3.js`.
- New server-only `lib/wallet-verification.ts` exposes:
  - `requestWalletVerificationChallenge(walletAddress)` — creates a 5-minute, single-use challenge after `requireActiveUser()`.
  - `verifyWalletSignature(walletAddress, signatureBase58, nonce)` — validates the challenge, verifies the signature, consumes the nonce atomically, and persists the verified wallet.
  - `getWalletVerificationStatus()` — returns the member's current saved/verified state.
- `saveWalletAddress()` in `lib/actions.ts` now rejects address changes; it only permits idempotent re-saving of the currently verified address. All payout-address changes must go through `verifyWalletSignature`.
- `/dashboard/wallet/page.tsx` no longer treats connection as verification. It displays verification status, shows a "Verify Ownership" button when the connected wallet differs from the saved address or is unverified, and signs the SIWS message with the wallet adapter before submitting it server-side.
- Unit tests in `lib/wallet-crypto.test.ts` cover message construction, valid signatures, attacker keypairs, and message-replay attacks.

### Acceptance test

A member cannot register another user's wallet as their payout destination by knowing only the public address. They must produce a valid Ed25519 signature over a domain-bound, single-use, time-bound challenge generated for their authenticated account.

## Remaining work

- Apply and verify the migration in a non-production Supabase environment before production rollout. The repository replay test uses an isolated local PostgreSQL compatibility fixture; it is not production verification.
- Regenerate Supabase TypeScript database types after the migration is applied to a linked project.
- Migrate admin user-management reads and UI filtering from compatibility `users.role/status` to an authorized server-side join/view when convenient.
- Add an explicit capability-management UI/action if delegated capability editing is required; any such action must use `manage_security` plus AAL2 and must retain the last-security-admin safeguards.
- Review every remaining server action for a named capability rather than relying only on protected admin RLS.
- Decide whether deactivated accounts should be retained indefinitely or mapped to an Auth ban/delete lifecycle; no deletion policy is introduced here.
- Validate legacy rows and mark the remaining `NOT VALID` constraints valid in a later forward migration.
- Application audit writes for user/profile/storage/wallet operations are currently separate from their underlying service-role mutation or external side effect. A process failure between mutation and audit can leave an unaudited success; use transactional database RPCs/outbox records for full atomicity in a later phase. Trusted click ingestion itself is transactionally deduplicated in the database.
- Bulk last-security-admin checks are enforced immediately before mutation but are not serialized across concurrent admin requests; move these mutations into a locking database RPC if concurrent security administration becomes common.
- Review the existing dependency audit separately; package installation reported inherited vulnerabilities that were not automatically changed in this security migration.
