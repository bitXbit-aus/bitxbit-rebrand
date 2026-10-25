-- Phase 2 (B3): wallet sign-in (link-only).
--
-- A member proves control of the wallet already linked to their account and is
-- signed in without a password or email round-trip. There are NO wallet-only
-- users: the account must already exist and its wallet must be verified.
--
-- Forward-only and data-preserving. The only structural change to existing data
-- is a UNIQUE index, which fails loudly if it cannot be satisfied — see below.

-- -----------------------------------------------------------------------------
-- 1. A wallet must map to at most one account.
--
-- Sign-in is "given a wallet, find THE user". Nothing enforced this before, and
-- the column was plain TEXT with no index. The index is PARTIAL so the many rows
-- with no wallet (the common case) do not collide on NULL.
--
-- This deliberately raises on duplicate wallets rather than silently dropping
-- data: if it fails, reconcile the duplicates explicitly and re-run. Production
-- was measured clean before this was written; staging required reconciling 19
-- fixture rows that shared one address.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_address_unique
  ON public.users (wallet_address)
  WHERE wallet_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_wallet_address_lookup
  ON public.users (wallet_address)
  WHERE wallet_address IS NOT NULL AND wallet_verified IS TRUE;

-- -----------------------------------------------------------------------------
-- 2. Sign-in challenges.
--
-- These must exist BEFORE a session does, so the authenticated
-- `wallet_verification_challenges` table (user_id NOT NULL) cannot serve them.
-- The wallet address is the only key; no user is referenced, which also means a
-- challenge can be issued for an unregistered wallet without leaking whether it
-- is registered.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallet_signin_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_signin_challenges_lookup
  ON public.wallet_signin_challenges (wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_signin_challenges_nonce
  ON public.wallet_signin_challenges (nonce);
-- Supports rate-limit / abuse queries without scanning the table.
CREATE INDEX IF NOT EXISTS idx_wallet_signin_challenges_created
  ON public.wallet_signin_challenges (created_at DESC);

-- No member or anonymous client may read or write these rows: the application
-- validates signatures server-side with the service role.
ALTER TABLE public.wallet_signin_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_signin_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.wallet_signin_challenges TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Atomic consume + resolve.
--
-- Consumes a fresh, unused, unexpired challenge and returns the id of the
-- verified account that owns the wallet. Returns NULL when no verified account
-- owns it, so the caller can fail with a single generic message and not leak
-- whether the wallet is registered. Raises on an invalid/expired/used challenge
-- so a caller cannot mistake "no such challenge" for "no such user".
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_wallet_signin(
  p_wallet_address TEXT,
  p_nonce TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  challenge_id UUID;
  target_user UUID;
BEGIN
  IF p_wallet_address IS NULL OR p_nonce IS NULL THEN
    RAISE EXCEPTION 'invalid wallet sign-in parameters';
  END IF;

  -- Serialise concurrent sign-in attempts for the same wallet.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_wallet_address, 0));

  SELECT id INTO challenge_id
  FROM public.wallet_signin_challenges
  WHERE wallet_address = p_wallet_address
    AND nonce = p_nonce
    AND used_at IS NULL
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF challenge_id IS NULL THEN
    RAISE EXCEPTION 'sign-in challenge is invalid, expired, or already used';
  END IF;

  -- Consume first: a challenge is single-use regardless of the outcome below,
  -- so a failed lookup cannot be retried against the same nonce.
  UPDATE public.wallet_signin_challenges
  SET used_at = NOW()
  WHERE id = challenge_id;

  -- At most one row can match: users_wallet_address_unique guarantees it.
  SELECT id INTO target_user
  FROM public.users
  WHERE wallet_address = p_wallet_address
    AND wallet_verified IS TRUE
  LIMIT 1;

  RETURN target_user;
END;
$$;

ALTER FUNCTION public.verify_wallet_signin(TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_wallet_signin(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_wallet_signin(TEXT, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Housekeeping for expired challenges.
--
-- Challenges are single-use and short-lived; this keeps the table bounded
-- without deleting anything still usable. Safe to call at any time.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_wallet_signin_challenges(p_older_than INTERVAL DEFAULT '1 day')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM public.wallet_signin_challenges
  WHERE used_at IS NOT NULL
     OR expires_at < NOW() - p_older_than;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

ALTER FUNCTION public.prune_wallet_signin_challenges(INTERVAL) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prune_wallet_signin_challenges(INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_wallet_signin_challenges(INTERVAL) TO service_role;
