# Staging Smoke Test Guide

This guide describes how to validate the Phase 1 security hardening against a non-production Supabase project and deployed dashboard app.

## Prerequisites

1. A staging Supabase project with migrations `010` through `024` applied.
2. A deployed staging dashboard app (e.g., a Netlify deploy preview or branch deploy).
3. The service-role key for the staging project. **Do not use production credentials.**
4. Optional: the public URL of the staging dashboard app for HTTP-level checks.

## Environment variables

```bash
export STAGING_SUPABASE_URL="https://<staging-project>.supabase.co"
export STAGING_SUPABASE_SERVICE_ROLE_KEY="<staging-service-role-key>"
export BITXBIT_TOKEN_MINT="<devnet-token-mint>"
export BITXBIT_TOKEN_DECIMALS=6
export AIRDROP_WALLET_PRIVATE_KEY="<devnet-treasury-private-key>"
export STAGING_RECIPIENT_WALLET="<on-curve-devnet-test-wallet>"
export SOLANA_RPC_URL="https://api.devnet.solana.com"
export STAGING_APP_URL="https://<staging-app>.netlify.app"   # optional
```

## Automated schema and safeguard checks

From `dashboard-app/`:

```bash
npm run test:staging
```

This script:

- Creates a disposable test user in Auth.
- Verifies `approve_reward_period()` atomically approves all active rewards and the period, and rejects re-approval from an invalid state.
- Verifies the wallet-verification flow end-to-end:
  - `verify_wallet_challenge()` consumes a challenge and marks the wallet verified.
  - Reused nonces are rejected.
  - Changing the wallet address resets `wallet_verified`.
- Verifies trusted offer-click deduplication via `record_trusted_offer_click()`.
- Verifies payout operation atomic creation/claiming and finalization:
  - `create_or_claim_payout_operation()` creates or claims only an eligible operation.
  - Duplicate submission attempts are rejected.
  - `finalize_payout_confirmation()` commits the confirmed operation, exact distributed reward, transaction identity, and complete-period state atomically.
  - Confirmed operations reject status and field mutations.
- Checks every Supabase fixture mutation for resolved `{ error }` results instead of assuming the promise rejected.
- Cleans up transient test data. The confirmed payout fixture and its referenced user/reward/period/allocation history are intentionally retained because finalised financial records are immutable; the script prints the retained operation ID explicitly.

If `STAGING_APP_URL` is set, it also performs lightweight HTTP health checks on public API endpoints.

## Manual staging checklist

Use disposable test accounts only. Never use production identities or wallets.

### Authentication and authorization

1. Create a new member account and confirm the email.
2. Sign in and confirm the dashboard loads.
3. Suspend the account in the staging database (`UPDATE public.users SET status = 'suspended' WHERE id = ...`) and confirm the member cannot access dashboard routes after token refresh.
4. Reactivate the account and confirm access is restored.

### Profile boundaries

5. As a member, update only `display_name` in the profile form.
6. Attempt to set `role`, `status`, `wallet_address`, or `referral_code` directly via the Supabase anon client and confirm it is rejected by RLS.

### Wallet ownership verification

7. Connect a Solana wallet on `/dashboard/wallet`.
8. Without signing, confirm the wallet is saved but shown as **unverified**.
9. Click **Verify Ownership**, sign the SIWS message, and confirm the wallet shows **verified**.
10. Connect a different wallet and confirm the saved address does not change until the new wallet is signed.
11. Disconnect and reconnect the original wallet; confirm it remains verified.

### Trusted offer clicks

12. Visit `/dashboard/offers`, click an active offer, and confirm only one `user_activities` row is created per user/offer within 30 seconds.
13. Confirm direct authenticated `INSERT` into `user_activities` is rejected.

### Reward period lifecycle

14. As an admin, create or select an approved reward period.
15. Run **Calculate Rewards** and confirm `user_rewards` rows are created.
16. Run **Approve Rewards** and confirm the period status moves to `approved`.
17. Attempt to run **Calculate Rewards** again and confirm it is rejected.
18. Use **Correct Rewards** with a reason, confirm the period returns to `calculating`, rewards are recalculated, and the reason appears in the audit log.

### Payout idempotency and immutability

19. Ensure at least one approved reward has a verified wallet address.
20. Run **Distribute Rewards** and confirm `payout_operations` rows are created with deterministic `operation_id` values.
21. Run **Distribute Rewards** a second time and confirm no duplicate payments are submitted. `confirmed` rows are skipped; `submitted` rows are reconciled, not re-submitted.
22. Manually update a `confirmed` `payout_operations` row in SQL and confirm the trigger rejects the mutation.

### Audit logging

23. Perform an admin user-management action (role change, status change) and confirm a row appears in `security_audit_log` with actor attribution, before/after snapshots, and a capability snapshot.
24. Verify `security_audit_log` rows cannot be updated or deleted by any role.

### Rate limiting and security headers

25. Make more than 100 requests within 60 seconds to a public API route from the same IP and confirm a `429 Too Many Requests` response with a `Retry-After` header.
26. Confirm response headers include:
    - `X-Frame-Options: DENY`
    - `X-Content-Type-Options: nosniff`
    - `Referrer-Policy: strict-origin-when-cross-origin`
    - A `Content-Security-Policy` header.

### Test airdrop guard

27. Confirm `sendTestAirdrop` fails unless `ENABLE_TEST_AIRDROP=true` is set in the deployment environment.

## Cleanup

- Delete transient test offers, activities, wallet challenges, and any non-finalised payout fixtures created during testing.
- Do **not** delete or mutate confirmed/incident payout history. The automated smoke test prints the immutable operation ID and retains the referenced user, reward period, reward, and allocation model as an auditable staging fixture.
- Verify no service-role keys or private keys were logged.
