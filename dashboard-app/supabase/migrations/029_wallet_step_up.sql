-- Phase 2 (R-021 prevention): device-trusted wallet sign-in, with a step-up for
-- unrecognised devices.
--
-- WHY THIS EXISTS
--
-- Wallet sign-in accepts a signature that a victim can be talked into producing on
-- an attacker's site (docs/security/wallet-signin-threat-model.md). Nothing inside
-- the challenge/verify handshake can stop that: the attacker requests the
-- challenge, so they receive whatever binding is issued. The only thing that closes
-- it is an independent factor, and the only thing that makes that factor
-- un-relayable is that it must be *presented by the browser that is signing in*.
--
-- This migration is the persistence for that gate. It does not itself decide
-- anything: it makes three facts durable and race-free.
--
--   1. Which devices an account has already proved itself on  (wallet_trusted_devices)
--   2. A single live step-up per (account, device), single-use and attempt-bounded
--      (wallet_signin_stepups)
--   3. That a new step-up invalidates the previous one, so a code seen earlier
--      cannot be replayed later
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
--   * No plaintext code is stored. The application generates the code, emails it,
--     and stores only an HMAC. A database read therefore yields nothing usable —
--     and a bare hash would not be enough either, because 10^6 candidate codes is
--     a lookup table; the HMAC key is what makes the stored value opaque.
--   * No raw device cookie is stored, only its SHA-256, so a database read cannot
--     be replayed as a device.
--   * The code comparison inside complete_wallet_stepup uses SQL equality rather
--     than a timing-safe compare. That is a deliberate, bounded choice: the
--     attacker is limited to max_attempts (5) against a code that lives 10 minutes
--     and is replaced on every new request, and the factor's actual security rests
--     on possession of the account's mailbox, not on the secrecy of a string
--     comparison. Recorded here so it is a decision, not an oversight.
--
-- Forward-only and data-preserving: creates two new tables and their functions.
-- Nothing existing is altered.

-- -----------------------------------------------------------------------------
-- 1. Trusted devices.
--
-- Primary key is (device_hash, user_id), not device_hash alone: a shared machine
-- signed into two members yields two rows, and one member's trust must never
-- authorise the other. Revocation is a column, not a delete, so that "this device
-- was removed on <date>" survives as a fact.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallet_trusted_devices (
  device_hash   TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  label         TEXT,
  last_ip       TEXT,
  -- Reserved for the device-bound key (design §4). NULL until a device registers
  -- one, so this migration does not require that half to exist.
  public_key    TEXT,
  revoked_at    TIMESTAMPTZ,
  PRIMARY KEY (device_hash, user_id)
);

-- Serves the "my devices" list and the per-device revoke action.
CREATE INDEX IF NOT EXISTS idx_wallet_trusted_devices_user
  ON public.wallet_trusted_devices (user_id, last_seen_at DESC);

ALTER TABLE public.wallet_trusted_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_trusted_devices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.wallet_trusted_devices TO service_role;

-- -----------------------------------------------------------------------------
-- 2. Pending step-ups.
--
-- One live row per (account, device): begin_wallet_stepup supersedes any earlier
-- pending, so codes cannot accumulate as parallel valid credentials.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallet_signin_stepups (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_hash    TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  code_hmac      TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 5,
  expires_at     TIMESTAMPTZ NOT NULL,
  consumed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_signin_stepups_lookup
  ON public.wallet_signin_stepups (user_id, device_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_signin_stepups_created
  ON public.wallet_signin_stepups (created_at DESC);

ALTER TABLE public.wallet_signin_stepups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_signin_stepups FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.wallet_signin_stepups TO service_role;

-- -----------------------------------------------------------------------------
-- 3. begin_wallet_stepup — issue one live code per (account, device).
--
-- Supersedes rather than refuses: a member who mistypes their email, reloads, or
-- asks again should get a working code, and the previous one must stop working the
-- moment a new one is issued — otherwise every earlier code stays a valid
-- credential for its full lifetime.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.begin_wallet_stepup(
  p_user_id        UUID,
  p_device_hash    TEXT,
  p_wallet_address TEXT,
  p_code_hmac      TEXT,
  p_ttl_seconds    INTEGER DEFAULT 600
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  stepup_id UUID;
BEGIN
  IF p_user_id IS NULL
     OR p_device_hash IS NULL OR length(p_device_hash) = 0
     OR p_code_hmac IS NULL OR length(p_code_hmac) = 0
     OR p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid wallet step-up parameters';
  END IF;

  -- Serialise concurrent requests for the same account + device, so two racing
  -- requests cannot both leave a live pending row behind.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT || ':' || p_device_hash, 0));

  UPDATE public.wallet_signin_stepups
  SET consumed_at = NOW()
  WHERE user_id = p_user_id
    AND device_hash = p_device_hash
    AND consumed_at IS NULL;

  INSERT INTO public.wallet_signin_stepups (
    user_id, device_hash, wallet_address, code_hmac, expires_at
  ) VALUES (
    p_user_id, p_device_hash, p_wallet_address, p_code_hmac,
    NOW() + make_interval(secs => p_ttl_seconds)
  )
  RETURNING id INTO stepup_id;

  RETURN stepup_id;
END;
$$;

ALTER FUNCTION public.begin_wallet_stepup(UUID, TEXT, TEXT, TEXT, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.begin_wallet_stepup(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_wallet_stepup(UUID, TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. complete_wallet_stepup — the gate, atomically.
--
-- Consumes on EVERY outcome, and returns a STATUS rather than raising one.
--
-- WHY A STATUS AND NOT AN EXCEPTION — this was a real defect, caught by the
-- migration gate before it could ship:
--
-- The first version of this function RAISEd on a wrong code. The caller catches
-- that inside a `BEGIN ... EXCEPTION` block, which in PL/pgSQL opens a
-- subtransaction — and a caught exception rolls that subtransaction back. So the
-- `attempts = attempts + 1` written immediately before the RAISE was undone, the
-- counter stayed at 0 forever, and a 6-digit code had no attempt limit at all.
-- An exception raised AFTER a write discards the write.
--
-- The failure paths therefore return, and only parameter validation raises
-- (before any write, so nothing can be lost). Callers map the status to an audit
-- reason while still returning one generic message over HTTP.
--
--   not_found     no such pending (unknown, or pruned)
--   consumed      already used — a code is single-use
--   expired       past its TTL; the row is consumed as it is refused
--   exhausted     the attempt budget is spent; consumed as it is refused
--   invalid_code  wrong code; attempts incremented, consumed if that was the last
--   ok            user_id is present; the row is consumed
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_wallet_stepup(
  p_id        UUID,
  p_code_hmac TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  pending public.wallet_signin_stepups%ROWTYPE;
BEGIN
  IF p_id IS NULL OR p_code_hmac IS NULL OR length(p_code_hmac) = 0 THEN
    RAISE EXCEPTION 'invalid wallet step-up parameters';
  END IF;

  SELECT * INTO pending
  FROM public.wallet_signin_stepups
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Attempt budget FIRST. A pending consumed by exhaustion is then reported as
  -- `exhausted` rather than as generically `consumed`. The security outcome is
  -- identical — no code completes — but the audit reason is the useful one, and an
  -- audit reason that cannot distinguish "someone kept guessing" from "a code was
  -- already used" is the kind of log that gets ignored.
  IF pending.attempts >= pending.max_attempts THEN
    UPDATE public.wallet_signin_stepups SET consumed_at = NOW() WHERE id = pending.id;
    RETURN jsonb_build_object('status', 'exhausted');
  END IF;

  IF pending.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'consumed');
  END IF;

  IF pending.expires_at <= NOW() THEN
    UPDATE public.wallet_signin_stepups SET consumed_at = NOW() WHERE id = pending.id;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF pending.code_hmac IS DISTINCT FROM p_code_hmac THEN
    -- Consume when this was the last attempt, so the row cannot be left in a state
    -- where further guesses are possible. Both writes persist: nothing raises here.
    UPDATE public.wallet_signin_stepups
    SET attempts = attempts + 1,
        consumed_at = CASE WHEN attempts + 1 >= max_attempts THEN NOW() ELSE consumed_at END
    WHERE id = pending.id;
    RETURN jsonb_build_object('status', 'invalid_code');
  END IF;

  UPDATE public.wallet_signin_stepups SET consumed_at = NOW() WHERE id = pending.id;

  RETURN jsonb_build_object('status', 'ok', 'user_id', pending.user_id::TEXT);
END;
$$;

ALTER FUNCTION public.complete_wallet_stepup(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_wallet_stepup(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_wallet_stepup(UUID, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- 5. trust_wallet_device / revoke_wallet_device.
--
-- Trust is only ever granted by the application AFTER a completed step-up, so
-- re-trusting a previously revoked device (a member signing in again on it) is
-- correct and clears revoked_at: revocation is a state, not a blocklist.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trust_wallet_device(
  p_device_hash TEXT,
  p_user_id     UUID,
  p_label       TEXT DEFAULT NULL,
  p_last_ip     TEXT DEFAULT NULL,
  p_public_key  TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_device_hash IS NULL OR length(p_device_hash) = 0 OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid wallet device parameters';
  END IF;

  INSERT INTO public.wallet_trusted_devices (
    device_hash, user_id, label, last_ip, public_key, last_seen_at
  ) VALUES (
    p_device_hash, p_user_id, p_label, p_last_ip, p_public_key, NOW()
  )
  ON CONFLICT (device_hash, user_id) DO UPDATE
    SET last_seen_at = NOW(),
        label        = COALESCE(EXCLUDED.label, public.wallet_trusted_devices.label),
        last_ip      = COALESCE(EXCLUDED.last_ip, public.wallet_trusted_devices.last_ip),
        public_key   = COALESCE(EXCLUDED.public_key, public.wallet_trusted_devices.public_key),
        revoked_at   = NULL;

  RETURN TRUE;
END;
$$;

ALTER FUNCTION public.trust_wallet_device(TEXT, UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.trust_wallet_device(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trust_wallet_device(TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_wallet_device(
  p_device_hash TEXT,
  p_user_id     UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  updated INTEGER;
BEGIN
  IF p_device_hash IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid wallet device parameters';
  END IF;

  UPDATE public.wallet_trusted_devices
  SET revoked_at = NOW()
  WHERE device_hash = p_device_hash
    AND user_id = p_user_id
    AND revoked_at IS NULL;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

ALTER FUNCTION public.revoke_wallet_device(TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_wallet_device(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_wallet_device(TEXT, UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- 6. Housekeeping. Pending rows are short-lived and single-use; this keeps the
-- table bounded without removing anything still usable. Mirrors
-- prune_wallet_signin_challenges.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_wallet_stepups(p_older_than INTERVAL DEFAULT '1 day')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM public.wallet_signin_stepups
  WHERE consumed_at IS NOT NULL
     OR expires_at < NOW() - p_older_than;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

ALTER FUNCTION public.prune_wallet_stepups(INTERVAL) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prune_wallet_stepups(INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_wallet_stepups(INTERVAL) TO service_role;
