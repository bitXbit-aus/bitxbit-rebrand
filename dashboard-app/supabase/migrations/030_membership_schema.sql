-- Phase 2: membership schema (One Good Turn).
--
-- The membership system the One Good Turn readiness report designs
-- (`docs/security/one-good-turn-readiness.md`), as a schema first and nothing
-- else. Four tables: the plan catalogue, a member's subscription, the merchant
-- offers that are member benefits, and the record that one was redeemed.
--
-- FORWARD-ONLY and DORMANT. Nothing in the application reads or writes these
-- tables yet, and nothing here grants a client role any access. That is
-- deliberate: `main` auto-deploys, so the schema must be able to reach
-- production BEFORE the code that queries it merges. Until then this migration
-- is inert — it cannot be reached by any endpoint, so it is safe to apply ahead
-- of its code. The same reasoning as 028/029: service_role only, and the server
-- authorizes with `lib/authz.ts` before it constructs a service client.
--
-- TWO design choices deviate from the readiness sketch. Both are recorded here
-- rather than left for a reader to notice:
--
--   1. Prices are INTEGER MINOR UNITS (`price_aud_cents`), not a decimal
--      `price_aud`. Integer cents are exact everywhere, carry no rounding
--      decision, and match Stripe's own API, which takes amounts in the
--      smallest currency unit. Same figure, no float or decimal in the path.
--
--   2. `promotional_draws` is NOT created. The readiness report defers it
--      behind independent legal review, and a table nobody may populate is not
--      a head start — it is a thing a later session finds and enables. It gets
--      its own migration on the far side of that review.
--
-- The launch constraint is expressed as a CHECK, not as a comment: a plan that
-- costs money carries `requires_payment = TRUE`, so 'the paid tier is not
-- enabled' is a property the database enforces rather than a sentence everyone
-- must remember. See § 1.

-- -----------------------------------------------------------------------------
-- 1. The plan catalogue.
--
-- `requires_payment` must agree with the price: TRUE exactly when it costs
-- something. One CHECK carries the whole invariant, so the catalogue cannot
-- contain the two states that would lie to a member — a '$5 plan' nobody can be
-- charged for, or a 'free' plan that quietly bills. It is also what keeps the
-- seeded paid plan unjoinable until payments exist.
--
-- `benefits_snapshot` is a LIST because it is rendered as a list; asserting
-- jsonb_typeof = 'array' stops an object or a bare string being stored where the
-- UI expects to iterate.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  name TEXT NOT NULL
    CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description TEXT,
  price_aud_cents INTEGER NOT NULL DEFAULT 0
    CHECK (price_aud_cents >= 0),
  billing_interval TEXT NOT NULL DEFAULT 'month'
    CHECK (billing_interval IN ('month', 'year')),
  benefits_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(benefits_snapshot) = 'array'),
  requires_payment BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT membership_plans_payment_flag_matches_price
    CHECK (requires_payment = (price_aud_cents > 0))
);

CREATE INDEX IF NOT EXISTS idx_membership_plans_active_order
  ON public.membership_plans (sort_order, slug)
  WHERE active IS TRUE;

-- The catalogue starts populated: the free plan members join today, and the
-- paid plan seeded but unjoinable (see the CHECK above). ON CONFLICT DO NOTHING
-- keeps the replay idempotent AND stops a re-apply from overwriting a plan the
-- owner has edited in production — a forward-only migration must never reset
-- live data.
INSERT INTO public.membership_plans
  (slug, name, description, price_aud_cents, billing_interval,
   benefits_snapshot, requires_payment, sort_order)
VALUES
  (
    'community',
    'bitXbit Community',
    'Free membership: referrals, rewards and transparency reporting.',
    0, 'month',
    '["Referral rewards", "Airdrop eligibility", "Transparency reporting"]'::jsonb,
    FALSE, 0
  ),
  (
    'rewards',
    'bitXbit Rewards',
    'Paid membership with member-only merchant offers. Not yet available.',
    500, 'month',
    '["Everything in Community", "Member-only merchant offers"]'::jsonb,
    TRUE, 10
  )
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. A member's subscription.
--
-- One ACTIVE subscription per member, enforced by a partial unique index rather
-- than by the application. Partial so history accumulates freely — a member may
-- have many cancelled and expired rows over time, and exactly one live row.
-- Without it, two concurrent 'join' requests both insert and the member holds two
-- memberships, which is how entitlement checks start disagreeing with billing.
--
-- `ended_at` is required for every non-active status: a row that has stopped
-- being live must say when. A subscription that is 'cancelled' with no end date
-- is indistinguishable from one that is still running, and the difference is
-- what a member is owed.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.membership_plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled', 'expired')),
  payment_method TEXT NOT NULL DEFAULT 'none'
    CHECK (payment_method IN ('none', 'stripe')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT member_subscriptions_end_after_start
    CHECK (expires_at IS NULL OR expires_at > started_at),
  CONSTRAINT member_subscriptions_non_active_has_ended_at
    CHECK (status = 'active' OR ended_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS member_subscriptions_one_active_per_member
  ON public.member_subscriptions (user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_member_subscriptions_user_history
  ON public.member_subscriptions (user_id, started_at DESC);

-- ON DELETE RESTRICT on the plan: a plan that has ever been subscribed cannot be
-- deleted, because doing so would erase what a member was sold. Retire a plan
-- with `active = FALSE` instead.
CREATE INDEX IF NOT EXISTS idx_member_subscriptions_plan
  ON public.member_subscriptions (plan_id);

-- NOTE left to the service layer, deliberately: the database cannot CHECK that a
-- subscription to a plan requiring payment carries payment_method = 'stripe' —
-- the fact lives on the other table. Until payments exist, the only way in is a
-- plan with requires_payment = FALSE, which is enforced here.

-- -----------------------------------------------------------------------------
-- 3. Merchant offers — member benefits, NOT affiliate revenue.
--
-- Distinct from `affiliate_offers` (which earns the platform money). These are
-- things a member receives, so the two must never be folded together: the
-- accounting, the disclosure and the audience are all different.
--
-- The validity window is a closed/open pair, and the CHECK refuses an inverted
-- one. NULL means 'no bound', which is why the comparison guards each side
-- rather than assuming both are set.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_name TEXT NOT NULL
    CHECK (length(btrim(merchant_name)) BETWEEN 1 AND 120),
  discount_description TEXT NOT NULL
    CHECK (length(btrim(discount_description)) BETWEEN 1 AND 500),
  redemption_instructions TEXT NOT NULL
    CHECK (length(btrim(redemption_instructions)) BETWEEN 1 AND 2000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT merchant_offers_valid_window
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);

-- Serves the only question asked of this table: which offers are on offer NOW.
CREATE INDEX IF NOT EXISTS idx_merchant_offers_live
  ON public.merchant_offers (active, valid_from, valid_until);

-- -----------------------------------------------------------------------------
-- 4. Redemptions.
--
-- The unique index is the schema half of idempotency: one member may redeem a
-- given offer once. It is what makes a double-tap, a retried request or two
-- concurrent requests unable to consume a benefit twice — the readiness report
-- requires idempotent redemption codes, and this is the constraint that gives
-- that guarantee regardless of what the application does.
--
-- APPEND-ONLY for UPDATE, deliberately not for DELETE:
--   * A redemption is a record that a member received a benefit, so its columns
--     are facts and are never edited. A trigger refuses every UPDATE with 42501.
--   * DELETE is left permitted, because a member's own deletion cascades here
--     (`user_id ... ON DELETE CASCADE`, matching every other member-owned table
--     in `001`/`002`). Guarding DELETE would make the existing, supported
--     'delete member' path fail the moment that member had ever redeemed an
--     offer — an outage introduced by a hardening measure, which is the opposite
--     of the intent. The delete grant is service_role-only and every deletion
--     path in the app is audited.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offer_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  merchant_offer_id UUID NOT NULL REFERENCES public.merchant_offers(id) ON DELETE RESTRICT,
  redemption_code TEXT NOT NULL
    CHECK (length(btrim(redemption_code)) BETWEEN 4 AND 64),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS offer_redemptions_one_per_member_per_offer
  ON public.offer_redemptions (user_id, merchant_offer_id);

CREATE INDEX IF NOT EXISTS idx_offer_redemptions_offer
  ON public.offer_redemptions (merchant_offer_id, redeemed_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_offer_redemption_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'offer redemptions are append-only; a redemption records that a benefit was received'
    USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION public.prevent_offer_redemption_update() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_offer_redemption_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS offer_redemptions_no_update ON public.offer_redemptions;
CREATE TRIGGER offer_redemptions_no_update
  BEFORE UPDATE ON public.offer_redemptions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_offer_redemption_update();

-- -----------------------------------------------------------------------------
-- 5. No client role reaches any of these.
--
-- RLS plus an explicit REVOKE, because they are two independent gates: a policy
-- that permits a row does not grant the table. On a real Supabase project new
-- tables in `public` inherit a default GRANT to anon/authenticated, so the
-- REVOKE is load-bearing rather than decorative — removing one of these lines
-- would open the table, and the replay harness mirrors that default privilege
-- precisely so a missing REVOKE is detectable.
--
-- There is deliberately no member-facing read policy. The app's single
-- authorization path is `requireActiveUser`/`requireCapability` and then a
-- service client; a direct member-read policy would be a second gate that no
-- request exercises, and an unexercised gate is a claim rather than a control.
-- If direct member reads are ever wanted, that is a new forward migration with a
-- policy AND column-level grants, tested as its own change.
-- -----------------------------------------------------------------------------
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_redemptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.membership_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.merchant_offers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.offer_redemptions FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.membership_plans TO service_role;
GRANT ALL ON TABLE public.member_subscriptions TO service_role;
GRANT ALL ON TABLE public.merchant_offers TO service_role;
GRANT ALL ON TABLE public.offer_redemptions TO service_role;
