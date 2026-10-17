#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="bitxbit_phase1_security_replay_test"
FIXTURE="$ROOT_DIR/supabase/tests/phase1_security_fixture.sql"
MIGRATION_010="$ROOT_DIR/supabase/migrations/010_phase1_security_foundation.sql"
MIGRATION_011="$ROOT_DIR/supabase/migrations/011_wallet_verification.sql"
MIGRATION_012="$ROOT_DIR/supabase/migrations/012_secure_token_distribution.sql"
MIGRATION_013="$ROOT_DIR/supabase/migrations/013_payout_hardening.sql"
MIGRATION_014="$ROOT_DIR/supabase/migrations/014_reward_correction_history.sql"
MIGRATION_015="$ROOT_DIR/supabase/migrations/015_payout_incident_state.sql"
MIGRATION_016="$ROOT_DIR/supabase/migrations/016_reward_calculation_history_safe.sql"
MIGRATION_017="$ROOT_DIR/supabase/migrations/017_fix_user_rewards_active_uniqueness.sql"
MIGRATION_018="$ROOT_DIR/supabase/migrations/018_coordinate_reward_correction_and_claim.sql"
MIGRATION_019="$ROOT_DIR/supabase/migrations/019_prevent_finalised_payout_deletion.sql"
MIGRATION_020="$ROOT_DIR/supabase/migrations/020_create_or_claim_payout_operation.sql"

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
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_012" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_013" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_014" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_015" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_016" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_017" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_018" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_019" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_020" >/dev/null

# Simulate a later validation migration. Replay must preserve this state.
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c \
  "ALTER TABLE public.affiliate_income VALIDATE CONSTRAINT affiliate_income_amount_nonnegative" >/dev/null

psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_010" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_011" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_012" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_013" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_014" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_015" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_016" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_017" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_018" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_019" >/dev/null
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$MIGRATION_020" >/dev/null

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
  test_period UUID := '33333333-3333-4333-8333-333333333333';
  test_reward UUID := '44444444-4444-4444-8444-444444444444';
  test_op TEXT := 'payout:test-period:test-reward';
  op_count INT;
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

  -- Atomic wallet verification via verify_wallet_challenge consumes the signed
  -- challenge and updates the address + verified flag together. The trigger
  -- must preserve wallet_verified = TRUE, not reset it.
  UPDATE public.users SET wallet_address = NULL, wallet_verified = FALSE, wallet_verified_at = NULL WHERE id = test_user;

  INSERT INTO public.wallet_verification_challenges (
    user_id, wallet_address, nonce, message, expires_at
  ) VALUES (
    test_user, test_wallet, 'verify-wallet-challenge-nonce', 'test-message', NOW() + INTERVAL '5 minutes'
  );

  SELECT public.verify_wallet_challenge(test_user, test_wallet, 'verify-wallet-challenge-nonce') INTO consumed;
  IF consumed IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'verify_wallet_challenge did not return TRUE';
  END IF;

  IF (SELECT wallet_address FROM public.users WHERE id = test_user) IS DISTINCT FROM test_wallet THEN
    RAISE EXCEPTION 'verify_wallet_challenge did not update wallet_address';
  END IF;

  IF (SELECT wallet_verified FROM public.users WHERE id = test_user) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'verify_wallet_challenge did not preserve wallet_verified=true (trigger bug)';
  END IF;

  IF (SELECT wallet_verified_at FROM public.users WHERE id = test_user) IS NULL THEN
    RAISE EXCEPTION 'verify_wallet_challenge did not set wallet_verified_at';
  END IF;

  -- A reused nonce must fail after verify_wallet_challenge consumed it.
  BEGIN
    SELECT public.verify_wallet_challenge(test_user, test_wallet, 'verify-wallet-challenge-nonce') INTO consumed;
    RAISE EXCEPTION 'verify_wallet_challenge accepted a reused nonce';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'verify_wallet_challenge accepted a reused nonce' THEN
      RAISE;
    END IF;
  END;

  -- Migration backfill is one-time: a wallet that is already verified must not
  -- be reset if migration 011 is replayed.
  UPDATE public.users
  SET wallet_verified = TRUE, wallet_verified_at = NOW()
  WHERE id = test_user;

  UPDATE public.users
  SET wallet_verified = FALSE, wallet_verified_at = NULL
  WHERE wallet_address IS NOT NULL
    AND wallet_verified IS NULL;

  IF (SELECT wallet_verified FROM public.users WHERE id = test_user) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'replay of migration 011 backfill reset an already verified wallet';
  END IF;

  -- Updating wallet_address resets verification via trigger.
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

  -- Payout operations: durable, idempotent, auditable token distribution records.
  INSERT INTO public.allocation_models (id, name, community_rewards_pct, liquidity_pct, buybacks_pct, projects_pct, operations_pct, effective_date)
  VALUES ('55555555-5555-4555-8555-555555555555', 'Test Model', 50, 10, 10, 20, 10, '2026-01-01');
  INSERT INTO public.reward_periods (id, start_date, end_date, allocation_model_id, status)
  VALUES (test_period, '2026-01-01', '2026-01-31', '55555555-5555-4555-8555-555555555555', 'approved');
  INSERT INTO public.user_rewards (id, user_id, reward_period_id, bitxbit_amount, status)
  VALUES (test_reward, test_user, test_period, 1.5, 'approved');

  INSERT INTO public.payout_operations (
    operation_id, reward_period_id, reward_id, user_id, wallet_address, token_amount_raw, token_decimals, status, actor_id
  ) VALUES (test_op, test_period, test_reward, test_user, test_wallet, 1500000000, 9, 'pending', test_user);

  BEGIN
    INSERT INTO public.payout_operations (
      operation_id, reward_period_id, reward_id, user_id, wallet_address, token_amount_raw, token_decimals, status, actor_id
    ) VALUES (test_op, test_period, test_reward, test_user, test_wallet, 1500000000, 9, 'pending', test_user);
    RAISE EXCEPTION 'duplicate operation_id was inserted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  WHEN OTHERS THEN
    IF SQLERRM = 'duplicate operation_id was inserted' THEN
      RAISE;
    END IF;
  END;

  -- Atomic claiming: only one caller can claim a pending operation.
  DECLARE
    claimed_id UUID;
    second_claim UUID;
  BEGIN
    SELECT public.claim_payout_operation(test_op, test_user) INTO claimed_id;
    IF claimed_id IS NULL THEN
      RAISE EXCEPTION 'claim_payout_operation did not claim the pending operation';
    END IF;

    SELECT public.claim_payout_operation(test_op, test_user) INTO second_claim;
    IF second_claim IS NOT NULL THEN
      RAISE EXCEPTION 'claim_payout_operation allowed double-claim of the same operation';
    END IF;

    IF (SELECT status FROM public.payout_operations WHERE operation_id = test_op) IS DISTINCT FROM 'submitting' THEN
      RAISE EXCEPTION 'claimed operation was not moved to submitting';
    END IF;
  END;

  -- A submitted operation with a fake transaction hash must not be auto-retryable
  -- without reconciliation. Move the claimed op to submitted and verify a second
  -- claim returns NULL.
  UPDATE public.payout_operations
  SET status = 'submitted', transaction_hash = 'txhash123', submitted_at = NOW(), updated_at = NOW()
  WHERE operation_id = test_op;

  DECLARE
    resubmitted_claim UUID;
  BEGIN
    SELECT public.claim_payout_operation(test_op, test_user) INTO resubmitted_claim;
    IF resubmitted_claim IS NOT NULL THEN
      RAISE EXCEPTION 'submitted operation was allowed to be claimed again';
    END IF;
  END;

  -- An uncertain operation is also non-retryable through claiming. Move the op
  -- to uncertain and verify a claim returns NULL. Reconciliation may still
  -- update it to another status (the next statement moves it back to submitted
  -- to prove mutability, then to confirmed for the immutability test).
  UPDATE public.payout_operations
  SET status = 'uncertain', uncertain_at = NOW(), updated_at = NOW()
  WHERE operation_id = test_op;

  DECLARE
    uncertain_claim UUID;
  BEGIN
    SELECT public.claim_payout_operation(test_op, test_user) INTO uncertain_claim;
    IF uncertain_claim IS NOT NULL THEN
      RAISE EXCEPTION 'uncertain operation was allowed to be claimed again';
    END IF;
  END;

  -- Move to confirmed and verify immutability.
  UPDATE public.payout_operations SET status = 'confirmed', transaction_hash = 'txhash123', confirmed_at = NOW() WHERE operation_id = test_op;
  SELECT COUNT(*) INTO op_count FROM public.security_audit_log WHERE target_table = 'public.payout_operations' AND target_id = (SELECT id::TEXT FROM public.payout_operations WHERE operation_id = test_op);
  IF op_count < 3 THEN
    RAISE EXCEPTION 'payout operation state changes were not audited';
  END IF;

  BEGIN
    UPDATE public.payout_operations SET status = 'failed' WHERE operation_id = test_op;
    RAISE EXCEPTION 'confirmed payout operation status was mutated';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'confirmed payout operation status was mutated' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    UPDATE public.payout_operations SET wallet_address = 'DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH6' WHERE operation_id = test_op;
    RAISE EXCEPTION 'confirmed payout operation field was mutated';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'confirmed payout operation field was mutated' THEN
      RAISE;
    END IF;
  END;

  -- Reward period status guard prevents invalid statuses.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reward_periods'::regclass
      AND conname = 'reward_periods_status_check'
  ) THEN
    RAISE EXCEPTION 'reward_periods status check constraint is missing';
  END IF;

  BEGIN
    UPDATE public.reward_periods SET status = 'invalid_status' WHERE id = test_period;
    RAISE EXCEPTION 'invalid reward period status was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  WHEN OTHERS THEN
    IF SQLERRM = 'invalid reward period status was accepted' THEN
      RAISE;
    END IF;
  END;

  -- Cancelled payouts preserve historical financial records. A pending/failed
  -- payout can be cancelled with a reason and must not be claimable afterwards.
  INSERT INTO public.payout_operations (
    operation_id, reward_period_id, reward_id, user_id, wallet_address, token_amount_raw, token_decimals, status, actor_id
  ) VALUES ('payout:test-period:cancelled-reward', test_period, test_reward, test_user, test_wallet, 1500000000, 9, 'pending', test_user);

  UPDATE public.payout_operations
  SET status = 'cancelled', cancellation_reason = 'Reward correction superseded this payout', updated_at = NOW()
  WHERE operation_id = 'payout:test-period:cancelled-reward';

  IF (SELECT status FROM public.payout_operations WHERE operation_id = 'payout:test-period:cancelled-reward') IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'cancelled status was not accepted';
  END IF;

  IF (SELECT cancellation_reason FROM public.payout_operations WHERE operation_id = 'payout:test-period:cancelled-reward') IS DISTINCT FROM 'Reward correction superseded this payout' THEN
    RAISE EXCEPTION 'cancellation_reason was not preserved';
  END IF;

  DECLARE
    cancelled_claim UUID;
  BEGIN
    SELECT public.claim_payout_operation('payout:test-period:cancelled-reward', test_user) INTO cancelled_claim;
    IF cancelled_claim IS NOT NULL THEN
      RAISE EXCEPTION 'cancelled operation was allowed to be claimed';
    END IF;
  END;

  -- Incident payouts are non-retryable. A confirmed on-chain mismatch must not
  -- be claimable for retry and must be immutable. Use a separate user/period so
  -- the immutable record does not block final cleanup.
  DECLARE
    v_incident_user UUID := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    v_incident_period UUID := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    v_incident_reward UUID := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
    incident_claim UUID;
  BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_incident_user, 'incident-test@example.test');
    INSERT INTO public.reward_periods (id, start_date, end_date, allocation_model_id, status)
    VALUES (v_incident_period, '2026-03-01', '2026-03-31', '55555555-5555-4555-8555-555555555555', 'approved');
    INSERT INTO public.user_rewards (id, user_id, reward_period_id, bitxbit_amount, status)
    VALUES (v_incident_reward, v_incident_user, v_incident_period, 1.0, 'approved');
    INSERT INTO public.payout_operations (
      operation_id, reward_period_id, reward_id, user_id, wallet_address, token_amount_raw, token_decimals, status, actor_id, incident_at
    ) VALUES ('payout:incident-test:incident-reward', v_incident_period, v_incident_reward, v_incident_user, test_wallet, 1500000000, 9, 'incident', v_incident_user, NOW());

    SELECT public.claim_payout_operation('payout:incident-test:incident-reward', v_incident_user) INTO incident_claim;
    IF incident_claim IS NOT NULL THEN
      RAISE EXCEPTION 'incident operation was allowed to be claimed';
    END IF;

    BEGIN
      UPDATE public.payout_operations SET status = 'failed' WHERE operation_id = 'payout:incident-test:incident-reward';
      RAISE EXCEPTION 'incident payout operation status was mutated';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'incident payout operation status was mutated' THEN
        RAISE;
      END IF;
    END;

    BEGIN
      DELETE FROM public.payout_operations WHERE operation_id = 'payout:incident-test:incident-reward';
      RAISE EXCEPTION 'incident payout operation was deleted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'incident payout operation was deleted' THEN
        RAISE;
      END IF;
    END;
  END;

  -- Confirmed payout records also cannot be deleted. Use a separate user/period
  -- so the immutable record does not block the final test cleanup.
  DECLARE
    v_delete_user UUID := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    v_delete_period UUID := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
    v_delete_reward UUID := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
  BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_delete_user, 'delete-test@example.test');
    INSERT INTO public.reward_periods (id, start_date, end_date, allocation_model_id, status)
    VALUES (v_delete_period, '2026-06-01', '2026-06-30', '55555555-5555-4555-8555-555555555555', 'approved');
    INSERT INTO public.user_rewards (id, user_id, reward_period_id, bitxbit_amount, status)
    VALUES (v_delete_reward, v_delete_user, v_delete_period, 1.0, 'approved');
    INSERT INTO public.payout_operations (
      operation_id, reward_period_id, reward_id, user_id, wallet_address, token_amount_raw, token_decimals, status, actor_id
    ) VALUES ('payout:delete-test:confirmed', v_delete_period, v_delete_reward, v_delete_user, test_wallet, 1500000000, 9, 'confirmed', v_delete_user);

    BEGIN
      DELETE FROM public.payout_operations WHERE operation_id = 'payout:delete-test:confirmed';
      RAISE EXCEPTION 'confirmed payout operation was deleted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'confirmed payout operation was deleted' THEN
        RAISE;
      END IF;
    END;
  END;

  -- Test payout operations may omit reward_period_id/reward_id; non-test
  -- operations must still reference both.
  INSERT INTO public.payout_operations (
    operation_id, is_test, user_id, wallet_address, token_amount_raw, token_decimals, status
  ) VALUES ('payout:test-operation:test-only', true, test_user, test_wallet, 1000000000, 9, 'pending');

  BEGIN
    INSERT INTO public.payout_operations (
      operation_id, is_test, user_id, wallet_address, token_amount_raw, token_decimals, status
    ) VALUES ('payout:test-operation:missing-period', false, test_user, test_wallet, 1000000000, 9, 'pending');
    RAISE EXCEPTION 'non-test payout without period/reward was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  WHEN OTHERS THEN
    IF SQLERRM = 'non-test payout without period/reward was accepted' THEN
      RAISE;
    END IF;
  END;

  -- create_or_claim_payout_operation must verify the reward is active and
  -- approved before creating or claiming an operation.
  DECLARE
    v_cc_user UUID := '11111111-1111-4111-8111-111111111112';
    v_cc_period UUID := '33333333-3333-4333-8333-333333333334';
    v_cc_reward UUID := '44444444-4444-4444-8444-444444444445';
    v_cc_op TEXT;
    v_cc_op_status TEXT;
  BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_cc_user, 'create-claim-test@example.test');
    INSERT INTO public.reward_periods (id, start_date, end_date, allocation_model_id, status)
    VALUES (v_cc_period, '2026-07-01', '2026-07-31', '55555555-5555-4555-8555-555555555555', 'approved');
    INSERT INTO public.user_rewards (id, user_id, reward_period_id, bitxbit_amount, status)
    VALUES (v_cc_reward, v_cc_user, v_cc_period, 1.5, 'approved');

    -- Creates and claims a new operation when none exists.
    SELECT public.create_or_claim_payout_operation(
      v_cc_period, v_cc_reward, v_cc_user, test_wallet, 1500000000, v_cc_user
    ) INTO v_cc_op;

    IF v_cc_op IS NULL THEN
      RAISE EXCEPTION 'create_or_claim_payout_operation did not return an operation id';
    END IF;

    SELECT status INTO v_cc_op_status
    FROM public.payout_operations
    WHERE operation_id = v_cc_op;

    IF v_cc_op_status IS DISTINCT FROM 'submitting' THEN
      RAISE EXCEPTION 'newly created operation is not submitting (got %)', v_cc_op_status;
    END IF;

    -- Claims an existing pending operation.
    UPDATE public.payout_operations
    SET status = 'pending'
    WHERE operation_id = v_cc_op;

    SELECT public.create_or_claim_payout_operation(
      v_cc_period, v_cc_reward, v_cc_user, test_wallet, 1500000000, v_cc_user
    ) INTO v_cc_op;

    SELECT status INTO v_cc_op_status
    FROM public.payout_operations
    WHERE operation_id = v_cc_op;

    IF v_cc_op_status IS DISTINCT FROM 'submitting' THEN
      RAISE EXCEPTION 'existing pending operation was not claimed (got %)', v_cc_op_status;
    END IF;

    -- Rejects a superseded reward.
    UPDATE public.user_rewards
    SET status = 'superseded', superseded_at = NOW()
    WHERE id = v_cc_reward;

    BEGIN
      SELECT public.create_or_claim_payout_operation(
        v_cc_period, v_cc_reward, v_cc_user, test_wallet, 1500000000, v_cc_user
      ) INTO v_cc_op;
      RAISE EXCEPTION 'superseded reward was accepted for payout';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'superseded reward was accepted for payout' THEN
        RAISE;
      END IF;
    END;

    -- Rejects an amount mismatch.
    UPDATE public.user_rewards
    SET status = 'approved', superseded_at = NULL
    WHERE id = v_cc_reward;

    BEGIN
      SELECT public.create_or_claim_payout_operation(
        v_cc_period, v_cc_reward, v_cc_user, test_wallet, 999999999, v_cc_user
      ) INTO v_cc_op;
      RAISE EXCEPTION 'amount mismatch was accepted for payout';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'amount mismatch was accepted for payout' THEN
        RAISE;
      END IF;
    END;

    -- Rejects a non-approved reward.
    UPDATE public.user_rewards
    SET status = 'pending'
    WHERE id = v_cc_reward;

    BEGIN
      SELECT public.create_or_claim_payout_operation(
        v_cc_period, v_cc_reward, v_cc_user, test_wallet, 1500000000, v_cc_user
      ) INTO v_cc_op;
      RAISE EXCEPTION 'non-approved reward was accepted for payout';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'non-approved reward was accepted for payout' THEN
        RAISE;
      END IF;
    END;
  END;

  -- Reward correction preserves history. Create an active reward and a payout
  -- operation referencing it, then apply a correction. The old reward must be
  -- superseded (not deleted) so the payout FK remains valid, and a new versioned
  -- reward record must be created.
  DECLARE
    v_correction_user UUID := '77777777-7777-4111-8111-111111111111';
    v_correction_period UUID := '88888888-8888-4888-8888-888888888888';
    v_original_reward UUID;
    v_new_reward UUID;
    v_correction_result JSONB;
  BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_correction_user, 'correction-test@example.test');

    INSERT INTO public.reward_periods (id, start_date, end_date, allocation_model_id, status)
    VALUES (v_correction_period, '2026-02-01', '2026-02-28', '55555555-5555-4555-8555-555555555555', 'approved');

    INSERT INTO public.user_rewards (
      id, user_id, reward_period_id, bitxbit_amount, status
    ) VALUES (
      '77777777-7777-4777-8777-777777777777', v_correction_user, v_correction_period, 1.5, 'approved'
    ) RETURNING id INTO v_original_reward;

    INSERT INTO public.payout_operations (
      operation_id, reward_period_id, reward_id, user_id, wallet_address, token_amount_raw, token_decimals, status, actor_id
    ) VALUES (
      'payout:test-period:corrected-reward', v_correction_period, v_original_reward, v_correction_user, test_wallet, 1500000000, 9, 'pending', v_correction_user
    );

    SELECT public.apply_reward_correction(
      v_correction_period,
      'Test correction preserving history',
      jsonb_build_array(
        jsonb_build_object(
          'user_id', v_correction_user,
          'estimated_aud_value', 2.00,
          'bitxbit_amount', 2.0000
        )
      )
    ) INTO v_correction_result;

    IF (v_correction_result->>'superseded_rewards')::INT IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'apply_reward_correction did not supersede exactly one reward (got %)', v_correction_result;
    END IF;

    IF (v_correction_result->>'inserted_rewards')::INT IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'apply_reward_correction did not insert exactly one new reward (got %)', v_correction_result;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.user_rewards
      WHERE id = v_original_reward AND status = 'superseded' AND superseded_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'original reward was not superseded and preserved';
    END IF;

    SELECT id INTO v_new_reward
    FROM public.user_rewards
    WHERE reward_period_id = v_correction_period AND user_id = v_correction_user AND superseded_at IS NULL;

    IF v_new_reward IS NULL THEN
      RAISE EXCEPTION 'new active reward was not created';
    END IF;

    IF v_new_reward = v_original_reward THEN
      RAISE EXCEPTION 'new reward id matches original reward id';
    END IF;

    IF (SELECT version FROM public.user_rewards WHERE id = v_new_reward) IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'new reward did not receive version 2';
    END IF;

    -- The payout operation must still reference the original (now superseded) reward.
    IF (SELECT reward_id FROM public.payout_operations WHERE operation_id = 'payout:test-period:corrected-reward') IS DISTINCT FROM v_original_reward THEN
      RAISE EXCEPTION 'payout operation no longer references the preserved original reward';
    END IF;

    -- After correction the payout operation should be cancelled, not claimable.
    IF (SELECT status FROM public.payout_operations WHERE operation_id = 'payout:test-period:corrected-reward') IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'pending payout was not cancelled during correction';
    END IF;

  END;

  -- Recalculating after a correction must preserve the superseded historical
  -- record. apply_reward_calculation deletes only active records.
  DECLARE
    v_recalc_user UUID := '99999999-9999-4999-8999-999999999999';
    v_recalc_period UUID := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    v_original_recalc_reward UUID;
    v_recalc_result JSONB;
    v_recalc_reward UUID;
    v_superseded_count INT;
  BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_recalc_user, 'recalc-test@example.test');

    INSERT INTO public.reward_periods (id, start_date, end_date, allocation_model_id, status)
    VALUES (v_recalc_period, '2026-03-01', '2026-03-31', '55555555-5555-4555-8555-555555555555', 'approved');

    INSERT INTO public.user_rewards (
      id, user_id, reward_period_id, bitxbit_amount, status
    ) VALUES (
      '99999999-9999-4999-9999-999999999999', v_recalc_user, v_recalc_period, 1.5, 'approved'
    ) RETURNING id INTO v_original_recalc_reward;

    -- Apply a correction (no payout operations, so correction is allowed).
    SELECT public.apply_reward_correction(
      v_recalc_period,
      'Test correction before recalculation',
      jsonb_build_array(
        jsonb_build_object(
          'user_id', v_recalc_user,
          'estimated_aud_value', 2.00,
          'bitxbit_amount', 2.0000
        )
      )
    ) INTO v_recalc_result;

    IF (v_recalc_result->>'superseded_rewards')::INT IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'apply_reward_correction did not supersede exactly one reward (got %)', v_recalc_result;
    END IF;

    -- Recalculate. The superseded record must remain; a new active record is created.
    SELECT public.apply_reward_calculation(
      v_recalc_period,
      100.00,
      jsonb_build_array(
        jsonb_build_object(
          'user_id', v_recalc_user,
          'estimated_aud_value', 3.00,
          'bitxbit_amount', 3.0000
        )
      )
    ) INTO v_recalc_result;

    IF (v_recalc_result->>'inserted_rewards')::INT IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'apply_reward_calculation did not insert exactly one reward (got %)', v_recalc_result;
    END IF;

    SELECT COUNT(*) INTO v_superseded_count
    FROM public.user_rewards
    WHERE reward_period_id = v_recalc_period AND user_id = v_recalc_user AND status = 'superseded';

    IF v_superseded_count <> 1 THEN
      RAISE EXCEPTION 'recalculation deleted the superseded historical reward (count=%)', v_superseded_count;
    END IF;

    SELECT id INTO v_recalc_reward
    FROM public.user_rewards
    WHERE reward_period_id = v_recalc_period AND user_id = v_recalc_user AND superseded_at IS NULL;

    IF v_recalc_reward IS NULL THEN
      RAISE EXCEPTION 'recalculation did not create a new active reward';
    END IF;

    -- The new active record should be version 2: v1 was superseded by the
    -- correction, v2 was the active record deleted by recalculation, and the
    -- new record continues the sequence.
    IF (SELECT version FROM public.user_rewards WHERE id = v_recalc_reward) IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'new recalculated reward did not receive version 2 (got %)',
        (SELECT version FROM public.user_rewards WHERE id = v_recalc_reward);
    END IF;
  END;

  -- Recalculating a period with zero rewards must retire all active rewards and
  -- preserve any superseded historical records.
  DECLARE
    v_empty_period UUID := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
    v_empty_user UUID := '33333333-3333-4333-8333-333333333331';
    v_empty_result JSONB;
    v_empty_active_count INT;
  BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_empty_user, 'empty-recalc-test@example.test');
    INSERT INTO public.reward_periods (id, start_date, end_date, allocation_model_id, status)
    VALUES (v_empty_period, '2026-08-01', '2026-08-31', '55555555-5555-4555-8555-555555555555', 'calculating');

    INSERT INTO public.user_rewards (
      id, user_id, reward_period_id, bitxbit_amount, status
    ) VALUES (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', v_empty_user, v_empty_period, 2.5, 'pending'
    );

    -- Recalculate with an empty reward array.
    SELECT public.apply_reward_calculation(
      v_empty_period,
      0.00,
      '[]'::jsonb
    ) INTO v_empty_result;

    IF (v_empty_result->>'inserted_rewards')::INT IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'empty recalculation inserted unexpected rewards (got %)', v_empty_result;
    END IF;

    SELECT COUNT(*) INTO v_empty_active_count
    FROM public.user_rewards
    WHERE reward_period_id = v_empty_period AND superseded_at IS NULL;

    IF v_empty_active_count IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'empty recalculation left active rewards behind (count=%)', v_empty_active_count;
    END IF;

    IF (SELECT total_income FROM public.reward_periods WHERE id = v_empty_period) IS DISTINCT FROM 0.00 THEN
      RAISE EXCEPTION 'empty recalculation did not update period total_income to zero';
    END IF;
  END;

  -- The active-reward uniqueness index must prevent two active records for the
  -- same member and period, regardless of version.
  DECLARE
    v_unique_user UUID := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    v_unique_period UUID := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_unique_user, 'unique-test@example.test');
    INSERT INTO public.reward_periods (id, start_date, end_date, allocation_model_id, status)
    VALUES (v_unique_period, '2026-04-01', '2026-04-30', '55555555-5555-4555-8555-555555555555', 'approved');

    INSERT INTO public.user_rewards (id, user_id, reward_period_id, bitxbit_amount, status, version)
    VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', v_unique_user, v_unique_period, 1.0, 'pending', 1);

    BEGIN
      INSERT INTO public.user_rewards (id, user_id, reward_period_id, bitxbit_amount, status, version)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', v_unique_user, v_unique_period, 2.0, 'pending', 2);
      RAISE EXCEPTION 'duplicate active reward was inserted';
    EXCEPTION WHEN unique_violation THEN
      NULL;
    WHEN OTHERS THEN
      IF SQLERRM = 'duplicate active reward was inserted' THEN
        RAISE;
      END IF;
    END;
  END;

  -- Clean up deletable payout operations for the main test period. Confirmed and
  -- incident records are intentionally immutable and cannot be removed.
  DELETE FROM public.payout_operations WHERE reward_period_id = test_period AND status NOT IN ('confirmed', 'incident');
  DELETE FROM public.payout_operations WHERE operation_id = 'payout:test-operation:test-only';

  -- Verify that deleting a user does not change historical actor attribution in
  -- the audit log, using a dedicated user so immutable payout records do not
  -- block the deletion.
  DECLARE
    v_actor_test_user UUID := '77777777-7777-4777-8777-777777777778';
  BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_actor_test_user, 'actor-test@example.test');
    INSERT INTO public.security_audit_log (
      actor_id, actor_role, actor_status, action, target_table
    ) VALUES (
      v_actor_test_user, 'member', 'active', 'test.actor_immutability', 'public.users'
    );
    DELETE FROM auth.users WHERE id = v_actor_test_user;
    SELECT actor_id INTO preserved_actor
    FROM public.security_audit_log
    WHERE action = 'test.actor_immutability';
    IF preserved_actor IS DISTINCT FROM v_actor_test_user THEN
      RAISE EXCEPTION 'deleting user changed historical actor attribution';
    END IF;
  END;

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

# ------------------------------------------------------------------------------
# Concurrent correction-vs-claim race test
# Verifies that apply_reward_correction() and claim_payout_operation() serialize
# on the same period lock. A correction that starts first must cancel all pending
# payouts before a concurrent claim can proceed; the claim then sees no eligible
# operation and returns NULL.
# ------------------------------------------------------------------------------
RACE_USER='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
RACE_PERIOD='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
RACE_REWARD='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
RACE_OP='race-op-1'
RACE_DONE=$(mktemp)
RACE_RESULT=$(mktemp)

psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "
  INSERT INTO auth.users (id, email) VALUES ('$RACE_USER', 'race@example.test');
  INSERT INTO public.reward_periods (id, start_date, end_date, allocation_model_id, status)
  VALUES ('$RACE_PERIOD', '2026-05-01', '2026-05-31', '55555555-5555-4555-8555-555555555555', 'calculating');
  INSERT INTO public.user_rewards (id, user_id, reward_period_id, bitxbit_amount, status, version)
  VALUES ('$RACE_REWARD', '$RACE_USER', '$RACE_PERIOD', 10.0, 'pending', 1);
  INSERT INTO public.payout_operations (operation_id, reward_period_id, reward_id, user_id, wallet_address, token_amount_raw, status)
  VALUES ('$RACE_OP', '$RACE_PERIOD', '$RACE_REWARD', '$RACE_USER', 'DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5', 1000000000, 'pending');
" >/dev/null

# Background correction acquires the period lock, signals, sleeps, then cancels.
(
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "
    BEGIN;
    SELECT pg_advisory_xact_lock(0, hashtext('$RACE_PERIOD'::text));
    SELECT pg_sleep(1.5);
    SELECT apply_reward_correction('$RACE_PERIOD'::UUID, 'race correction', '[{\"user_id\":\"$RACE_USER\",\"estimated_aud_value\":5.00,\"bitxbit_amount\":5.0}]'::jsonb);
    COMMIT;
  " >/dev/null
  echo done > "$RACE_DONE"
) &

# Wait until the background session confirms it holds the period lock.
for i in {1..50}; do
  if psql -d "$DB_NAME" -t -A -c "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = hashtext('$RACE_PERIOD'::text) AND granted" 2>/dev/null | grep -q '^1$'; then
    break
  fi
  sleep 0.1
done

# Foreground claim should block until the correction commits, then return NULL.
START_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
psql -d "$DB_NAME" -t -A -c "SELECT claim_payout_operation('$RACE_OP', '$RACE_USER'::UUID);" > "$RACE_RESULT" 2>/dev/null
END_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
DURATION=$((END_MS - START_MS))

# Wait for background correction to finish.
wait

RESULT=$(cat "$RACE_RESULT" | tr -d '[:space:]')
rm -f "$RACE_DONE" "$RACE_RESULT"

if [ "$DURATION" -lt 1000 ]; then
  echo "race test failed: claim did not block on period lock (duration ${DURATION}ms)" >&2
  exit 1
fi

if [ -n "$RESULT" ]; then
  echo "race test failed: claim returned '$RESULT' after correction cancelled the payout" >&2
  exit 1
fi

psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "
  DO \$\$
  BEGIN
    IF (SELECT status FROM public.payout_operations WHERE operation_id = '$RACE_OP') IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'race test failed: payout was not cancelled by correction';
    END IF;
  END \$\$;
" >/dev/null

printf 'concurrent correction-vs-claim race test passed (blocked %sms, claim returned NULL, payout cancelled)\n' "$DURATION"

# ------------------------------------------------------------------------------
# Concurrent create_or_claim_payout_operation vs correction race test
# Verifies that a correction cannot supersede a reward after the application has
# read it but before create_or_claim_payout_operation() authorises submission.
# The creation RPC must acquire the period lock and recheck the reward status;
# when the correction wins the race, creation fails and no payout operation is
# inserted.
# ------------------------------------------------------------------------------
RACE2_USER='11111111-2222-4222-8222-222222222222'
RACE2_PERIOD='22222222-3333-4333-8333-333333333333'
RACE2_REWARD='22222222-3333-4333-8333-333333333331'
RACE2_RESULT=$(mktemp)

psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "
  INSERT INTO auth.users (id, email) VALUES ('$RACE2_USER', 'race2@example.test');
  INSERT INTO public.reward_periods (id, start_date, end_date, allocation_model_id, status)
  VALUES ('$RACE2_PERIOD', '2026-06-01', '2026-06-30', '55555555-5555-4555-8555-555555555555', 'approved');
  INSERT INTO public.user_rewards (id, user_id, reward_period_id, bitxbit_amount, status, version)
  VALUES ('$RACE2_REWARD', '$RACE2_USER', '$RACE2_PERIOD', 7.0, 'approved', 1);
" >/dev/null

# Background correction acquires the period lock, signals, then supersedes the reward.
(
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "
    BEGIN;
    SELECT pg_advisory_xact_lock(0, hashtext('$RACE2_PERIOD'::text));
    SELECT pg_sleep(1.5);
    SELECT apply_reward_correction('$RACE2_PERIOD'::UUID, 'race2 correction', '[{\"user_id\":\"$RACE2_USER\",\"estimated_aud_value\":3.00,\"bitxbit_amount\":3.0}]'::jsonb);
    COMMIT;
  " >/dev/null
) &

# Wait until the background session holds the period lock.
for i in {1..50}; do
  if psql -d "$DB_NAME" -t -A -c "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = hashtext('$RACE2_PERIOD'::text) AND granted" 2>/dev/null | grep -q '^1$'; then
    break
  fi
  sleep 0.1
done

# Foreground create+claim should block until the correction commits, then fail.
START2_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
# The RPC is expected to raise; psql exits non-zero. Capture stdout and allow the
# non-zero exit so we can verify no operation id was returned.
psql -d "$DB_NAME" -t -A -c "SELECT create_or_claim_payout_operation('$RACE2_PERIOD'::UUID, '$RACE2_REWARD'::UUID, '$RACE2_USER'::UUID, 'DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5', 7000000000, '$RACE2_USER'::UUID);" > "$RACE2_RESULT" 2>/dev/null || true
END2_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
DURATION2=$((END2_MS - START2_MS))

# Wait for background correction to finish.
wait

RESULT2=$(cat "$RACE2_RESULT" | tr -d '[:space:]')
rm -f "$RACE2_RESULT"

if [ "$DURATION2" -lt 1000 ]; then
  echo "race2 test failed: create_or_claim_payout_operation did not block on period lock (duration ${DURATION2}ms)" >&2
  exit 1
fi

# The RPC should raise an exception, producing no output rather than an id.
if [ -n "$RESULT2" ]; then
  echo "race2 test failed: create_or_claim_payout_operation returned '$RESULT2' after reward was superseded" >&2
  exit 1
fi

psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "
  DO \$\$
  BEGIN
    IF (SELECT superseded_at IS NOT NULL FROM public.user_rewards WHERE id = '$RACE2_REWARD') IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'race2 test failed: reward was not superseded by correction';
    END IF;
    IF EXISTS (SELECT 1 FROM public.payout_operations WHERE reward_period_id = '$RACE2_PERIOD') THEN
      RAISE EXCEPTION 'race2 test failed: a payout operation was created for a superseded reward';
    END IF;
  END \$\$;
" >/dev/null

printf 'concurrent create_or_claim vs correction race test passed (blocked %sms, creation failed, no operation inserted)\n' "$DURATION2"
