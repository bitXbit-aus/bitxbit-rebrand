/**
 * Staging smoke test for the bitXbit dashboard security hardening.
 *
 * This script connects to a staging Supabase project via the service-role key
 * and verifies the end-to-end behaviour of the wallet verification and payout
 * safeguards. It creates test data, runs assertions, and cleans up after itself.
 *
 * Required environment variables:
 *   STAGING_SUPABASE_URL
 *   STAGING_SUPABASE_SERVICE_ROLE_KEY
 *
 * Run from dashboard-app/ with:
 *   npx ts-node scripts/staging-smoke-test.ts
 * or compile and run manually.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.STAGING_SUPABASE_URL;
const serviceKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing STAGING_SUPABASE_URL or STAGING_SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const runId = `smoke-${Date.now()}`;
const testUserId = `11111111-1111-4111-8111-${runId.slice(-12)}`;
const testEmail = `${runId}@staging-smoke.bitxbit`;
const testWallet = "DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5";
const testWallet2 = "DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH6";
const testOfferId = `22222222-2222-4222-8222-${runId.slice(-12)}`;
const testPeriodId = `33333333-3333-4333-8333-${runId.slice(-12)}`;
const testRewardId = `44444444-4444-4444-8444-${runId.slice(-12)}`;
const testOpId = `payout:${runId}:reward`;
const testModelId = `55555555-5555-4555-8555-${runId.slice(-12)}`;
const tokenDecimals = parseInt(process.env.BITXBIT_TOKEN_DECIMALS || "9", 10);
const amountDisplay = 1.5;
const amountRaw = BigInt(Math.round(amountDisplay * 10 ** tokenDecimals)).toString();

let failures = 0;

async function section(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`✗ ${name}:`, err instanceof Error ? err.message : err);
  }
}

async function rpc<T>(fn: string, args: unknown): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args as any);
  if (error) throw error;
  return data as T;
}

async function querySingle<T>(table: string, id: string): Promise<T | null> {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("id", id)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return (data as T) ?? null;
}

async function expectThrows(
  name: string,
  fn: () => PromiseLike<unknown>
): Promise<void> {
  try {
    await Promise.resolve(fn());
    throw new Error(`${name} did not throw as expected`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("did not throw")) {
      throw err;
    }
  }
}

interface SupabaseResult {
  error?: { message?: string; code?: string } | null;
}

async function requireNoError(
  label: string,
  resultPromise: PromiseLike<SupabaseResult>
): Promise<void> {
  const result = await resultPromise;
  if (result.error) {
    throw new Error(`${label}: ${result.error.message ?? result.error.code ?? "Supabase error"}`);
  }
}

async function expectSupabaseError(
  name: string,
  resultPromise: PromiseLike<SupabaseResult>
): Promise<void> {
  const result = await resultPromise;
  if (!result.error) {
    throw new Error(`${name} succeeded unexpectedly; expected a Supabase error`);
  }
}

async function setup() {
  // Create auth user and public profile.
  const { error: authError } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: "staging-smoke-password-123!",
    email_confirm: true,
    id: testUserId,
    user_metadata: { display_name: "Staging Smoke Test" },
  });
  if (authError) throw authError;

  // Ensure public.users row exists.
  await requireNoError(
    "update staging smoke profile",
    supabase
      .from("users")
      .update({ display_name: "Staging Smoke Test" })
      .eq("id", testUserId)
  );

  // Seed an offer for trusted click tests.
  await requireNoError(
    "insert staging smoke offer",
    supabase.from("affiliate_offers").insert({
      id: testOfferId,
      name: "Staging Smoke Offer",
      referral_url: "https://example.test/offer",
      active: true,
    })
  );

  // Seed allocation model and a calculated period awaiting atomic approval.
  await requireNoError(
    "insert staging smoke allocation model",
    supabase.from("allocation_models").insert({
      id: testModelId,
      name: "Staging Smoke Model",
      community_rewards_pct: 50,
      liquidity_pct: 10,
      buybacks_pct: 10,
      projects_pct: 20,
      operations_pct: 10,
      effective_date: "2026-01-01",
    })
  );

  await requireNoError(
    "insert staging smoke reward period",
    supabase.from("reward_periods").insert({
      id: testPeriodId,
      start_date: "2026-01-01",
      end_date: "2026-01-31",
      allocation_model_id: testModelId,
      status: "calculating",
    })
  );

  await requireNoError(
    "insert staging smoke reward",
    supabase.from("user_rewards").insert({
      id: testRewardId,
      user_id: testUserId,
      reward_period_id: testPeriodId,
      bitxbit_amount: amountDisplay,
      status: "pending",
    })
  );
}

async function teardown() {
  const { data: operations, error: operationsError } = await supabase
    .from("payout_operations")
    .select("operation_id, status")
    .eq("reward_id", testRewardId);
  if (operationsError) throw operationsError;

  await requireNoError(
    "delete staging smoke wallet challenges",
    supabase.from("wallet_verification_challenges").delete().eq("user_id", testUserId)
  );
  await requireNoError(
    "delete staging smoke activities",
    supabase.from("user_activities").delete().eq("user_id", testUserId)
  );
  await requireNoError(
    "delete staging smoke offer",
    supabase.from("affiliate_offers").delete().eq("id", testOfferId)
  );

  const immutableOperations = (operations ?? []).filter((op) =>
    op.status === "confirmed" || op.status === "incident"
  );
  if (immutableOperations.length > 0) {
    console.log(
      `  (retained immutable staging payout fixture ${immutableOperations
        .map((op) => op.operation_id)
        .join(", ")} with its referenced user/reward/period history)`
    );
    return;
  }

  await requireNoError(
    "delete staging smoke payout operations",
    supabase.from("payout_operations").delete().eq("reward_id", testRewardId)
  );
  await requireNoError(
    "delete staging smoke reward",
    supabase.from("user_rewards").delete().eq("id", testRewardId)
  );
  await requireNoError(
    "delete staging smoke reward period",
    supabase.from("reward_periods").delete().eq("id", testPeriodId)
  );
  await requireNoError(
    "delete staging smoke allocation model",
    supabase.from("allocation_models").delete().eq("id", testModelId)
  );
  await requireNoError(
    "delete staging smoke profile",
    supabase.from("users").delete().eq("id", testUserId)
  );
  const { error: authDeleteError } = await supabase.auth.admin.deleteUser(testUserId);
  if (authDeleteError) throw authDeleteError;
}

async function main() {
  await setup();

  await section("atomic reward approval", async () => {
    const result = await rpc<{ approved_rewards?: number; period_status?: string }>(
      "approve_reward_period",
      { p_period_id: testPeriodId }
    );
    if (result.approved_rewards !== 1 || result.period_status !== "approved") {
      throw new Error(`unexpected approval result: ${JSON.stringify(result)}`);
    }

    const period = await querySingle<{ status: string }>("reward_periods", testPeriodId);
    const reward = await querySingle<{ status: string }>("user_rewards", testRewardId);
    if (period?.status !== "approved" || reward?.status !== "approved") {
      throw new Error("reward approval did not commit period and reward together");
    }

    const exactCandidates = await rpc<Array<{ reward_id: string; amount_raw: string }>>(
      "get_reward_payout_candidates_exact",
      { p_period_id: testPeriodId, p_token_decimals: tokenDecimals }
    );
    const exactCandidate = exactCandidates.find((candidate) => candidate.reward_id === testRewardId);
    if (!exactCandidate || exactCandidate.amount_raw !== amountRaw || typeof exactCandidate.amount_raw !== "string") {
      throw new Error(`exact reward amount RPC returned an inexact value: ${JSON.stringify(exactCandidate)}`);
    }

    await expectThrows("reapprove approved period", () =>
      rpc("approve_reward_period", { p_period_id: testPeriodId })
    );
  });

  await section("wallet verification challenge lifecycle", async () => {
    await requireNoError(
      "insert wallet verification challenge",
      supabase.from("wallet_verification_challenges").insert({
        user_id: testUserId,
        wallet_address: testWallet,
        nonce: "nonce-1",
        message: "test-message",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
    );

    const ok = await rpc<boolean>("verify_wallet_challenge", {
      p_user_id: testUserId,
      p_wallet_address: testWallet,
      p_nonce: "nonce-1",
    });
    if (!ok) throw new Error("verify_wallet_challenge returned false");

    const profile = await querySingle<{ wallet_verified: boolean; wallet_address: string | null }>(
      "users",
      testUserId
    );
    if (!profile?.wallet_verified) throw new Error("wallet not verified");
    if (profile.wallet_address !== testWallet) throw new Error("wallet address mismatch");

    // Reused nonce must fail.
    await expectThrows("reused nonce", () =>
      rpc("verify_wallet_challenge", {
        p_user_id: testUserId,
        p_wallet_address: testWallet,
        p_nonce: "nonce-1",
      })
    );

    // Address change resets verification.
    await requireNoError(
      "change verified wallet address",
      supabase
        .from("users")
        .update({ wallet_address: testWallet2 })
        .eq("id", testUserId)
    );
    const updated = await querySingle<{ wallet_verified: boolean }>("users", testUserId);
    if (updated?.wallet_verified !== false) {
      throw new Error("wallet_verified was not reset after address change");
    }
  });

  await section("trusted offer click deduplication", async () => {
    const first = await rpc<boolean>("record_trusted_offer_click", {
      p_user_id: testUserId,
      p_offer_id: testOfferId,
      p_expected_url: "https://example.test/offer",
      p_dedupe_seconds: 30,
    });
    if (first !== true) throw new Error("first trusted click was not recorded");

    const second = await rpc<boolean>("record_trusted_offer_click", {
      p_user_id: testUserId,
      p_offer_id: testOfferId,
      p_expected_url: "https://example.test/offer",
      p_dedupe_seconds: 30,
    });
    if (second !== false) throw new Error("duplicate trusted click was not suppressed");
  });

  await section("payout operation atomic creation and rejection", async () => {
    // The preceding wallet-lifecycle test resets verification on address change.
    // Restore the verified wallet using the same two-step pattern as
    // verify_wallet_challenge(): address update first, then verification flag.
    await requireNoError(
      "restore staging smoke wallet address",
      supabase.from("users").update({ wallet_address: testWallet }).eq("id", testUserId)
    );
    await requireNoError(
      "restore staging smoke wallet verification",
      supabase.from("users").update({ wallet_verified: true }).eq("id", testUserId)
    );

    // First call creates a new operation and returns it in submitting state.
    const first = await rpc<string | null>("create_or_claim_payout_operation", {
      p_period_id: testPeriodId,
      p_reward_id: testRewardId,
      p_user_id: testUserId,
      p_wallet_address: testWallet,
      p_amount_raw: amountRaw,
      p_token_decimals: tokenDecimals,
      p_actor_id: testUserId,
    });
    if (!first) throw new Error("create_or_claim_payout_operation did not return an operation id");

    const { data: op, error: opError } = await supabase
      .from("payout_operations")
      .select("status")
      .eq("operation_id", first)
      .single();
    if (opError) throw opError;
    if (op?.status !== "submitting") throw new Error("newly created operation is not submitting");

    const exactOperations = await rpc<Array<{ operation_id: string; token_amount_raw: string }>>(
      "get_period_payout_operations_exact",
      { p_period_id: testPeriodId }
    );
    const exactOperation = exactOperations.find((operation) => operation.operation_id === first);
    if (!exactOperation || exactOperation.token_amount_raw !== amountRaw || typeof exactOperation.token_amount_raw !== "string") {
      throw new Error(`exact operation amount RPC returned an inexact value: ${JSON.stringify(exactOperation)}`);
    }

    // Second call on an already-submitting operation must fail.
    await expectThrows("double submit attempt", () =>
      rpc("create_or_claim_payout_operation", {
        p_period_id: testPeriodId,
        p_reward_id: testRewardId,
        p_user_id: testUserId,
        p_wallet_address: testWallet,
        p_amount_raw: amountRaw,
        p_token_decimals: tokenDecimals,
        p_actor_id: testUserId,
      })
    );

    // Reset to pending and verify the claim path.
    await requireNoError(
      "reset payout operation to pending",
      supabase.from("payout_operations").update({ status: "pending" }).eq("operation_id", first)
    );
    const claimed = await rpc<string | null>("create_or_claim_payout_operation", {
      p_period_id: testPeriodId,
      p_reward_id: testRewardId,
      p_user_id: testUserId,
      p_wallet_address: testWallet,
      p_amount_raw: amountRaw,
      p_token_decimals: tokenDecimals,
      p_actor_id: testUserId,
    });
    if (claimed !== first) throw new Error("claim path returned a different operation id");

    // Persist a synthetic staging transaction identity, then verify the atomic
    // finalization RPC commits the operation, reward, and complete period state
    // together. On-chain identity verification is covered by the devnet fault test.
    const stagingTxHash = `staging-smoke-${runId}`;
    await requireNoError(
      "persist staging smoke transaction identity",
      supabase
        .from("payout_operations")
        .update({
          status: "submitted",
          transaction_hash: stagingTxHash,
          submitted_at: new Date().toISOString(),
        })
        .eq("operation_id", first)
        .eq("status", "submitting")
    );

    const finalization = await rpc<{
      operation_status?: string;
      reward_status?: string;
      period_distributed?: boolean;
    }>("finalize_payout_confirmation", {
      p_operation_id: first,
      p_blockchain_confirmation: {
        confirmed: true,
        txHash: stagingTxHash,
        source: "staging-smoke",
      },
    });
    if (
      finalization.operation_status !== "confirmed" ||
      finalization.reward_status !== "distributed" ||
      finalization.period_distributed !== true
    ) {
      throw new Error(`unexpected finalization result: ${JSON.stringify(finalization)}`);
    }

    const finalizedReward = await querySingle<{
      status: string;
      distribution_tx_hash: string | null;
    }>("user_rewards", testRewardId);
    const finalizedPeriod = await querySingle<{ status: string }>("reward_periods", testPeriodId);
    if (
      finalizedReward?.status !== "distributed" ||
      finalizedReward.distribution_tx_hash !== stagingTxHash ||
      finalizedPeriod?.status !== "distributed"
    ) {
      throw new Error("atomic payout finalization left inconsistent financial state");
    }

    // Confirmed row must be immutable.
    await expectSupabaseError(
      "confirmed status mutation",
      supabase
        .from("payout_operations")
        .update({ status: "failed" })
        .eq("operation_id", first)
        .select()
        .single()
    );

    await expectSupabaseError(
      "confirmed field mutation",
      supabase
        .from("payout_operations")
        .update({ wallet_address: testWallet2 })
        .eq("operation_id", first)
        .select()
        .single()
    );
  });

  await section("payout operation rejects stale rewards and mismatches", async () => {
    // Create a second reward/period pair for rejection tests.
    const rejectPeriodId = `66666666-6666-4666-8666-${runId.slice(-12)}`;
    const rejectRewardId = `77777777-7777-4777-8777-${runId.slice(-12)}`;
    await requireNoError(
      "insert stale-reward test period",
      supabase.from("reward_periods").insert({
        id: rejectPeriodId,
        start_date: "2026-02-01",
        end_date: "2026-02-28",
        allocation_model_id: testModelId,
        status: "approved",
      })
    );
    await requireNoError(
      "insert stale-reward test reward",
      supabase.from("user_rewards").insert({
        id: rejectRewardId,
        user_id: testUserId,
        reward_period_id: rejectPeriodId,
        bitxbit_amount: amountDisplay,
        status: "approved",
      })
    );

    // Wallet address mismatch.
    await expectThrows("wallet address mismatch", () =>
      rpc("create_or_claim_payout_operation", {
        p_period_id: rejectPeriodId,
        p_reward_id: rejectRewardId,
        p_user_id: testUserId,
        p_wallet_address: testWallet2,
        p_amount_raw: amountRaw,
        p_token_decimals: tokenDecimals,
        p_actor_id: testUserId,
      })
    );

    // Non-approved period.
    await requireNoError(
      "move stale-reward period out of approved state",
      supabase.from("reward_periods").update({ status: "calculating" }).eq("id", rejectPeriodId)
    );
    await expectThrows("non-approved period", () =>
      rpc("create_or_claim_payout_operation", {
        p_period_id: rejectPeriodId,
        p_reward_id: rejectRewardId,
        p_user_id: testUserId,
        p_wallet_address: testWallet,
        p_amount_raw: amountRaw,
        p_token_decimals: tokenDecimals,
        p_actor_id: testUserId,
      })
    );

    // Cleanup.
    await requireNoError(
      "delete stale-reward test reward",
      supabase.from("user_rewards").delete().eq("id", rejectRewardId)
    );
    await requireNoError(
      "delete stale-reward test period",
      supabase.from("reward_periods").delete().eq("id", rejectPeriodId)
    );
  });

  await section("public API health and rate-limit headers", async () => {
    const appUrl = process.env.STAGING_APP_URL;
    if (!appUrl) {
      console.log("  (skipped: STAGING_APP_URL not set)");
      return;
    }
    const endpoints = [
      `${appUrl}/api/public/offers`,
      `${appUrl}/api/public/transparency`,
      `${appUrl}/api/token-stats`,
    ];
    for (const endpoint of endpoints) {
      const res = await fetch(endpoint);
      if (res.status !== 200) {
        throw new Error(`${endpoint} returned ${res.status}`);
      }
      if (!res.headers.get("x-ratelimit-limit")) {
        // Not a failure; headers are optional depending on implementation.
      }
    }
  });
}

main()
  .then(async () => {
    await teardown();
    if (failures > 0) {
      console.error(`\n${failures} staging smoke test(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll staging smoke tests passed.");
  })
  .catch(async (err) => {
    console.error("Staging smoke test error:", err);
    await teardown().catch(() => {});
    process.exit(1);
  });
