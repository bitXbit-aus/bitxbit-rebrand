#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="bitxbit_phase1_security_replay_test"
FIXTURE="$ROOT_DIR/supabase/tests/phase1_security_fixture.sql"
MIGRATION_010="$ROOT_DIR/supabase/migrations/010_phase1_security_foundation.sql"
MIGRATION_011="$ROOT_DIR/supabase/migrations/011_wallet_verification.sql"

cleanup() {
  dropdb --if-exists "$DB_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
psql -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres NOLOGIN SUPERUSER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;
SQL
createdb "$DB_NAME"

psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$FIXTURE" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_010" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_011" >/dev/null

# Simulate a later validation migration. Replay must preserve this state.
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c \
  "ALTER TABLE public.affiliate_income VALIDATE CONSTRAINT affiliate_income_amount_nonnegative" >/dev/null

psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_010" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_011" >/dev/null

psql -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  test_user UUID := '11111111-1111-4111-8111-111111111111';
  test_offer UUID := '22222222-2222-4222-8222-222222222222';
  test_wallet TEXT := 'DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5';
  challenge_nonce TEXT := 'nonce-11111111-1111-4111-8111-111111111111';
  first_click BOOLEAN;
  second_click BOOLEAN;
  preserved_actor UUID;
  consumed BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.affiliate_income'::regclass
      AND conname = 'affiliate_income_amount_nonnegative'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'validated constraint state was reset on replay';
  END IF;

  IF (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_activities' AND policyname = 'Activities protected read') <> 1 THEN
    RAISE EXCEPTION 'Activities protected read policy is not replay-safe';
  END IF;
  IF (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_rewards' AND policyname = 'Rewards protected read') <> 1 THEN
    RAISE EXCEPTION 'Rewards protected read policy is not replay-safe';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.security_audit_log'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.security_audit_log'::regclass AND attname = 'actor_id')]::SMALLINT[]
  ) THEN
    RAISE EXCEPTION 'security_audit_log.actor_id still has a foreign key';
  END IF;

  IF has_table_privilege('authenticated', 'public.user_activities', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated still has direct activity INSERT';
  END IF;
  IF has_function_privilege('authenticated', 'public.record_trusted_offer_click(uuid,uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute trusted click ingestion directly';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.record_trusted_offer_click(uuid,uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute trusted click ingestion';
  END IF;

  -- Wallet verification: existing users with a wallet are backfilled as unverified.
  INSERT INTO auth.users (id, email) VALUES (test_user, 'security-test@example.test');
  UPDATE public.users SET wallet_address = test_wallet WHERE id = test_user;
  IF (SELECT wallet_verified FROM public.users WHERE id = test_user) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'existing wallet was not backfilled as unverified';
  END IF;

  -- Challenge lifecycle: unused challenge can be consumed exactly once.
  INSERT INTO public.wallet_verification_challenges (
    user_id, wallet_address, nonce, message, expires_at
  ) VALUES (
    test_user, test_wallet, challenge_nonce, 'test-message', NOW() + INTERVAL '5 minutes'
  );

  SELECT public.consume_wallet_verification_challenge(test_user, test_wallet, challenge_nonce) INTO consumed;
  IF consumed IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'valid challenge was not consumed';
  END IF;

  BEGIN
    SELECT public.consume_wallet_verification_challenge(test_user, test_wallet, challenge_nonce) INTO consumed;
    RAISE EXCEPTION 'reused challenge was consumed twice';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'reused challenge was consumed twice' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    SELECT public.consume_wallet_verification_challenge(test_user, test_wallet, 'invalid-nonce') INTO consumed;
    RAISE EXCEPTION 'invalid challenge was consumed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid challenge was consumed' THEN
      RAISE;
    END IF;
  END;

  -- Updating wallet_address resets verification via trigger.
  UPDATE public.users SET wallet_verified = TRUE, wallet_verified_at = NOW() WHERE id = test_user;
  UPDATE public.users SET wallet_address = 'DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH6' WHERE id = test_user;
  IF (SELECT wallet_verified FROM public.users WHERE id = test_user) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'wallet address change did not reset verification status';
  END IF;

  -- Clean up test wallet state so later auth.users insert is not affected by trigger.
  UPDATE public.users SET wallet_address = NULL, wallet_verified = FALSE, wallet_verified_at = NULL WHERE id = test_user;

  INSERT INTO public.affiliate_offers (id, name, referral_url, active)
  VALUES (test_offer, 'Security Test Offer', 'https://example.test/offer', TRUE);

  SELECT public.record_trusted_offer_click(test_user, test_offer, 'https://example.test/offer', 30) INTO first_click;
  SELECT public.record_trusted_offer_click(test_user, test_offer, 'https://example.test/offer', 30) INTO second_click;
  IF first_click IS DISTINCT FROM TRUE OR second_click IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'trusted click dedupe returned unexpected results: %, %', first_click, second_click;
  END IF;
  IF (SELECT COUNT(*) FROM public.user_activities WHERE user_id = test_user AND offer_id = test_offer) <> 1 THEN
    RAISE EXCEPTION 'trusted click dedupe did not suppress duplicate row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_activities
    WHERE user_id = test_user AND offer_id = test_offer
      AND trusted_source = 'server_action' AND verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'trusted click source attribution missing';
  END IF;

  INSERT INTO public.security_audit_log (
    actor_id, actor_role, actor_status, action, target_table
  ) VALUES (
    test_user, 'member', 'active', 'test.actor_immutability', 'public.users'
  );
  DELETE FROM auth.users WHERE id = test_user;
  SELECT actor_id INTO preserved_actor
  FROM public.security_audit_log
  WHERE action = 'test.actor_immutability';
  IF preserved_actor IS DISTINCT FROM test_user THEN
    RAISE EXCEPTION 'deleting user changed historical actor attribution';
  END IF;

  BEGIN
    UPDATE public.security_audit_log SET action = 'mutated'
    WHERE action = 'test.actor_immutability';
    RAISE EXCEPTION 'audit update unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'audit update unexpectedly succeeded' THEN
      RAISE;
    END IF;
  END;
END $$;
SQL

printf 'migration replay verification passed (first apply + validated constraint + second apply)\n'
