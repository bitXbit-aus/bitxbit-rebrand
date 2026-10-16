# One Good Turn Integration Readiness Report

**Date:** October 16, 2026  
**Scope:** bitXbit dashboard-app Phase 1 security foundation as a platform for the future One Good Turn membership and promotional system.  
**Constraint:** No paid lottery entries, promotional draws, new tokens, or token-economy changes are introduced in Phase 1.

## Executive summary

The Phase 1 hardening leaves bitXbit with a reusable identity, authorization, wallet-verification, audit, and payout infrastructure that One Good Turn can extend. The main extension points are new database tables and service boundaries; the core security controls do not need to be rebuilt.

## Existing systems that can be reused

| One Good Turn need | Existing bitXbit system | Readiness |
|---|---|---|
| Member identity | `public.users` + Supabase Auth | Ready. Sign-up/login, referral codes, and profile management exist. |
| Authorization and capabilities | `public.user_authorizations` | Ready. New One Good Turn capabilities (e.g., `manage_subscriptions`, `manage_offers`) can be added as columns. |
| Wallet verification | `wallet_verification_challenges`, `users.wallet_verified` | Ready. Reuse the SIWS challenge flow for any wallet-gated membership. |
| Secure payouts | `payout_operations` + `lib/payout.ts` | Ready. Membership rewards, refunds, or merchant settlements can be recorded as payout operations. |
| Audit trail | `security_audit_log` | Ready. All financial/admin actions should write here. |
| Public marketing content | `/api/public/*` routes | Ready. New public endpoints can follow the same rate-limited, cached pattern. |
| Admin UI scaffolding | `/admin/*` pages + capability checks | Ready. New admin tools can reuse `requireCapability` and `FormWithToast`. |
| Transparency reporting | `transparency_reports` | Ready. Charity and community reporting can extend the snapshot model. |

## Proposed new database tables

A future migration should add:

### `public.membership_plans`

- `id`, `slug`, `name`, `price_aud`, `interval` (month/year), `benefits_snapshot JSONB`, `active`, `created_at`.
- Seed the existing free plan and the optional $5/month rewards plan without enabling payment flows.

### `public.member_subscriptions`

- `id`, `user_id` → `public.users(id)`, `plan_id`, `status` (active/paused/cancelled/expired), `started_at`, `expires_at`, `payment_method` (none/stripe), `created_at`, `updated_at`.
- RLS: members read own; service-role writes after capability check.

### `public.merchant_offers`

- `id`, `merchant_name`, `discount_description`, `redemption_instructions`, `active`, `valid_from`, `valid_until`, `created_at`.
- Distinct from `affiliate_offers` because these are member benefits, not affiliate revenue.

### `public.offer_redemptions`

- `id`, `user_id`, `merchant_offer_id`, `redeemed_at`, `redemption_code`.
- Prevents duplicate redemptions and supports accounting.

### `public.promotional_draws` (future, post-regulatory review)

- `id`, `name`, `entry_period_start`, `entry_period_end`, `draw_date`, `legal_basis`, `regulatory_approval_ref`, `status`.
- Do not populate or enable until regulatory review is complete.

## Proposed service boundaries

| Service | Responsibility | Reuse / build |
|---|---|---|
| Membership service | Plan catalog, subscription lifecycle, free/paid status | Build on top of `user_authorizations` and new subscription tables. |
| Wallet service | Ownership verification, payout addresses | Reuse `lib/wallet-verification.ts` and `lib/wallet-crypto.ts`. |
| Payout service | On-chain rewards, settlements | Reuse `lib/payout.ts` and `payout_operations`. |
| Offer/redemption service | Merchant discounts, redemption tracking | New service; reuse audit logging. |
| Promotional draw service | Entry tracking, verifiable draw | Future service; do not build now. |

## Security prerequisites before One Good Turn launch

1. **Payment processor integration** must be PCI-scoped correctly. Use Stripe Checkout/Elements and never handle raw card data.
2. **Subscription entitlements** must be checked server-side; do not rely on client-side flags.
3. **Promotional draws** require independent legal/regulatory review, age/location gating, and a verifiable randomness mechanism before any code is enabled.
4. **Merchant offer redemptions** need idempotent redemption codes and fraud monitoring.
5. **Privacy policy** must be updated to cover subscription data, offer redemptions, and any draw entries.
6. **Rate limiting and abuse prevention** must be extended to subscription signup, redemption, and draw entry endpoints.
7. **Audit logging** must cover every subscription state change, redemption, and payout.

## What Phase 1 deliberately does not do

- No paid lottery entries or draw mechanisms.
- No new token mints or changes to bitXbit token economics.
- No requirement to buy tokens for promotional eligibility.
- No new financial promises or token-holder entitlements.
- No production deployment of Phase 1 security migrations.

## Recommended next steps

1. Review and merge the `security/phase-1-hardening` branch to `main` after human review.
2. Apply migrations `010`, `011`, and `012` to a staging Supabase project and run end-to-end smoke tests.
3. Begin One Good Turn schema design as a separate migration series (`013_*`, `014_*`, etc.) that builds on the hardened foundation.
4. Obtain legal/regulatory sign-off before designing any promotional draw module.
