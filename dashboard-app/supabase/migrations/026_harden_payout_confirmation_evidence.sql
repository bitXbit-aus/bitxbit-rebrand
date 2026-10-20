-- Phase 1: strengthen payout finalization evidence validation.
--
-- Migration 024 required a non-null confirmation payload before marking a
-- submitted/uncertain operation confirmed, but it trusted the payload's
-- presence rather than its content. This forward migration re-states the
-- function with three additional safeguards:
--   1. The payload must be a JSON object that positively reports a confirmed
--      outcome and must not simultaneously report an uncertain or incident
--      outcome.
--   2. The payload must name the transaction it is evidence for, and that
--      signature must exactly match the immutable operation's transaction_hash.
--   3. An already-distributed reward whose recorded distribution_tx_hash
--      conflicts with the immutable operation signature is rejected rather than
--      silently overwritten, preserving historical financial evidence.
--
-- The already-confirmed repair path still accepts a NULL payload, because it
-- asserts no new on-chain outcome; it only repairs a missing reward/period
-- transition from the operation's own immutable signature.

CREATE OR REPLACE FUNCTION public.finalize_payout_confirmation(
  p_operation_id TEXT,
  p_blockchain_confirmation JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_period_id UUID;
  v_operation public.payout_operations%ROWTYPE;
  v_reward_update_count INT := 0;
  v_period_distributed BOOLEAN := FALSE;
BEGIN
  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' THEN
    RAISE EXCEPTION 'operation id is required';
  END IF;

  -- Read only the period key first, then re-read and lock the operation after
  -- acquiring the shared period advisory lock.
  SELECT reward_period_id INTO v_period_id
  FROM public.payout_operations
  WHERE operation_id = p_operation_id;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'normal payout operation not found';
  END IF;

  PERFORM pg_advisory_xact_lock(0, hashtext(v_period_id::text));

  SELECT * INTO v_operation
  FROM public.payout_operations
  WHERE operation_id = p_operation_id
  FOR UPDATE;

  IF v_operation.id IS NULL OR v_operation.reward_period_id IS DISTINCT FROM v_period_id THEN
    RAISE EXCEPTION 'payout operation changed during finalization';
  END IF;
  IF v_operation.is_test IS TRUE OR v_operation.reward_id IS NULL THEN
    RAISE EXCEPTION 'test payout operations require the test finalization path';
  END IF;
  IF v_operation.transaction_hash IS NULL OR btrim(v_operation.transaction_hash) = '' THEN
    RAISE EXCEPTION 'payout operation has no transaction hash';
  END IF;
  IF v_operation.status NOT IN ('submitted', 'uncertain', 'confirmed') THEN
    RAISE EXCEPTION 'payout operation is not finalizable (status %)', v_operation.status;
  END IF;

  IF v_operation.status IS DISTINCT FROM 'confirmed' THEN
    IF p_blockchain_confirmation IS NULL THEN
      RAISE EXCEPTION 'blockchain confirmation is required';
    END IF;
    IF jsonb_typeof(p_blockchain_confirmation) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'blockchain confirmation must be a JSON object';
    END IF;

    -- The payload must positively assert a confirmed outcome.
    IF NOT (p_blockchain_confirmation ? 'confirmed') THEN
      RAISE EXCEPTION 'blockchain confirmation is missing the confirmed flag';
    END IF;
    IF jsonb_typeof(p_blockchain_confirmation->'confirmed') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'blockchain confirmation confirmed flag must be a boolean';
    END IF;
    IF (p_blockchain_confirmation->>'confirmed')::BOOLEAN IS NOT TRUE THEN
      RAISE EXCEPTION 'blockchain confirmation does not report a confirmed outcome';
    END IF;

    -- A confirmed outcome must not also claim an inconclusive or mismatched one.
    IF p_blockchain_confirmation ? 'uncertain'
       AND jsonb_typeof(p_blockchain_confirmation->'uncertain') = 'boolean'
       AND (p_blockchain_confirmation->>'uncertain')::BOOLEAN THEN
      RAISE EXCEPTION 'blockchain confirmation reports an uncertain outcome';
    END IF;
    IF p_blockchain_confirmation ? 'incident'
       AND jsonb_typeof(p_blockchain_confirmation->'incident') = 'boolean'
       AND (p_blockchain_confirmation->>'incident')::BOOLEAN THEN
      RAISE EXCEPTION 'blockchain confirmation reports an incident outcome';
    END IF;

    -- The evidence must name the transaction it proves and match the immutable
    -- operation signature exactly.
    IF NOT (p_blockchain_confirmation ? 'txHash') THEN
      RAISE EXCEPTION 'blockchain confirmation is missing the transaction signature';
    END IF;
    IF jsonb_typeof(p_blockchain_confirmation->'txHash') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'blockchain confirmation transaction signature must be a string';
    END IF;
    IF btrim(p_blockchain_confirmation->>'txHash') = ''
       OR p_blockchain_confirmation->>'txHash' IS DISTINCT FROM v_operation.transaction_hash THEN
      RAISE EXCEPTION 'blockchain confirmation does not match the stored transaction signature';
    END IF;

    UPDATE public.payout_operations
    SET status = 'confirmed',
        confirmed_at = COALESCE(confirmed_at, NOW()),
        blockchain_confirmation = p_blockchain_confirmation,
        submission_error = NULL,
        updated_at = NOW()
    WHERE id = v_operation.id
      AND status IN ('submitted', 'uncertain');

    IF NOT FOUND THEN
      RAISE EXCEPTION 'payout operation confirmation transition failed';
    END IF;
  END IF;

  -- Refuse to overwrite a conflicting recorded distribution signature. This
  -- preserves immutable on-chain evidence if the reward was already distributed
  -- against a different transaction.
  IF EXISTS (
    SELECT 1
    FROM public.user_rewards
    WHERE id = v_operation.reward_id
      AND reward_period_id = v_period_id
      AND distribution_tx_hash IS NOT NULL
      AND distribution_tx_hash IS DISTINCT FROM v_operation.transaction_hash
  ) THEN
    RAISE EXCEPTION 'reward already distributed with a different transaction signature';
  END IF;

  -- Update the exact reward referenced by the immutable payout operation. The
  -- already-distributed case is idempotent; any other state is unsafe.
  UPDATE public.user_rewards
  SET status = 'distributed',
      distribution_tx_hash = v_operation.transaction_hash,
      distributed_at = COALESCE(distributed_at, NOW())
  WHERE id = v_operation.reward_id
    AND reward_period_id = v_period_id
    AND status IN ('approved', 'distributed');
  GET DIAGNOSTICS v_reward_update_count = ROW_COUNT;

  IF v_reward_update_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'exact payout reward is missing or not distributable';
  END IF;

  -- A period is complete only when it has at least one active reward, every
  -- active reward is distributed, and each active reward is backed by a
  -- confirmed payout operation.
  IF EXISTS (
    SELECT 1
    FROM public.user_rewards
    WHERE reward_period_id = v_period_id
      AND superseded_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_rewards r
    WHERE r.reward_period_id = v_period_id
      AND r.superseded_at IS NULL
      AND (
        r.status IS DISTINCT FROM 'distributed'
        OR NOT EXISTS (
          SELECT 1
          FROM public.payout_operations p
          WHERE p.reward_period_id = v_period_id
            AND p.reward_id = r.id
            AND p.status = 'confirmed'
        )
      )
  ) THEN
    UPDATE public.reward_periods
    SET status = 'distributed'
    WHERE id = v_period_id
      AND status = 'approved';
  END IF;

  SELECT status = 'distributed' INTO v_period_distributed
  FROM public.reward_periods
  WHERE id = v_period_id;

  RETURN jsonb_build_object(
    'operation_id', p_operation_id,
    'operation_status', 'confirmed',
    'reward_id', v_operation.reward_id,
    'reward_status', 'distributed',
    'period_id', v_period_id,
    'period_distributed', COALESCE(v_period_distributed, FALSE)
  );
END;
$$;

ALTER FUNCTION public.finalize_payout_confirmation(TEXT, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_payout_confirmation(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_payout_confirmation(TEXT, JSONB) TO service_role;
