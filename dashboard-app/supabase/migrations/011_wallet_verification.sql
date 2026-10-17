-- Phase 1 Task 3: cryptographic wallet ownership verification.
-- Forward-only, data-preserving. Existing wallet addresses are preserved and
-- marked as unverified until the member completes a signed challenge.

-- -----------------------------------------------------------------------------
-- Wallet verification challenges (single-use, time-bound, nonce-based)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallet_verification_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_challenges_user_wallet
  ON public.wallet_verification_challenges (user_id, wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_challenges_nonce
  ON public.wallet_verification_challenges (nonce);

ALTER TABLE public.wallet_verification_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_verification_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.wallet_verification_challenges TO service_role;

-- Only service-role/admin systems can read challenges. Members never need to read
-- these rows directly; the application validates signatures server-side.

-- -----------------------------------------------------------------------------
-- Wallet verification status on the compatibility profile table
-- -----------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS wallet_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wallet_verified_at TIMESTAMPTZ;

-- Backfill existing wallets as unverified (preserved, but require re-verification
-- before any future payout-address change is accepted). This is intentionally
-- one-time: it only touches rows where wallet_verified has never been set, so a
-- replay of the migration cannot reset wallets that members have already verified.
UPDATE public.users
SET wallet_verified = FALSE,
    wallet_verified_at = NULL
WHERE wallet_address IS NOT NULL
  AND wallet_verified IS NULL;

-- -----------------------------------------------------------------------------
-- Helper to atomically consume a challenge and mark the wallet verified.
-- Returns TRUE only when a matching, unused, unexpired challenge exists and is
-- consumed by this call. Raises on invalid/expired/used challenges so callers
-- cannot silently ignore verification failures.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_wallet_verification_challenge(
  p_user_id UUID,
  p_wallet_address TEXT,
  p_nonce TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  challenge_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_wallet_address IS NULL OR p_nonce IS NULL THEN
    RAISE EXCEPTION 'invalid verification challenge parameters';
  END IF;

  -- Serialize same-wallet verification attempts for this user.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT || ':' || p_wallet_address, 0));

  SELECT id INTO challenge_id
  FROM public.wallet_verification_challenges
  WHERE user_id = p_user_id
    AND wallet_address = p_wallet_address
    AND nonce = p_nonce
    AND used_at IS NULL
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF challenge_id IS NULL THEN
    RAISE EXCEPTION 'verification challenge is invalid, expired, or already used';
  END IF;

  UPDATE public.wallet_verification_challenges
  SET used_at = NOW(),
      verified_at = NOW()
  WHERE id = challenge_id;

  RETURN TRUE;
END;
$$;

ALTER FUNCTION public.consume_wallet_verification_challenge(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.consume_wallet_verification_challenge(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_wallet_verification_challenge(UUID, TEXT, TEXT)
  TO service_role;

-- -----------------------------------------------------------------------------
-- Atomic wallet verification: consume a signed challenge and update the
-- verified payout address in a single database operation.
-- This is the only code path that is allowed to set wallet_verified = TRUE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_wallet_challenge(
  p_user_id UUID,
  p_wallet_address TEXT,
  p_nonce TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  consumed BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR p_wallet_address IS NULL OR p_nonce IS NULL THEN
    RAISE EXCEPTION 'invalid wallet verification parameters';
  END IF;

  -- Consume the challenge first; raises on invalid/expired/reused challenge.
  consumed := public.consume_wallet_verification_challenge(p_user_id, p_wallet_address, p_nonce);

  IF consumed IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'wallet challenge could not be consumed';
  END IF;

  -- Atomic verification: the address change resets wallet_verified via trigger,
  -- then the second UPDATE sets it TRUE inside the same transaction. This is the
  -- only database path that can end with wallet_verified = TRUE for a new address.
  UPDATE public.users
  SET wallet_address = p_wallet_address
  WHERE id = p_user_id;

  UPDATE public.users
  SET wallet_verified = TRUE,
      wallet_verified_at = NOW()
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$$;

ALTER FUNCTION public.verify_wallet_challenge(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_wallet_challenge(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_wallet_challenge(UUID, TEXT, TEXT)
  TO service_role;

-- -----------------------------------------------------------------------------
-- Trigger to keep wallet_verified in sync when wallet_address changes.
-- If the wallet address is cleared or changed without a verified challenge,
-- verification is reset. The only authoritative source of wallet_verified = TRUE
-- is verify_wallet_challenge(), which performs the address update and the
-- verification update as two statements inside a single atomic transaction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_wallet_verification_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.wallet_address IS DISTINCT FROM OLD.wallet_address THEN
    NEW.wallet_verified := FALSE;
    NEW.wallet_verified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_wallet_verification_status() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_wallet_verification_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_wallet_verification_status ON public.users;
CREATE TRIGGER sync_wallet_verification_status
  BEFORE UPDATE OF wallet_address ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_wallet_verification_status();
