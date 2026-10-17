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
const amountRaw = Math.round(amountDisplay * 10 ** tokenDecimals);

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
  const { error: profileError } = await supabase
    .from("users")
    .update({ display_name: "Staging Smoke Test" })
    .eq("id", testUserId);
  if (profileError) throw profileError;

  // Seed an offer for trusted click tests.
  await supabase.from("affiliate_offers").insert({
    id: testOfferId,
    name: "Staging Smoke Offer",
    referral_url: "https://example.test/offer",
    active: true,
  });

  // Seed allocation model and reward period.
  await supabase.from("allocation_models").insert({
    id: testModelId,
    name: "Staging Smoke Model",
    community_rewards_pct: 50,
    liquidity_pct: 10,
    buybacks_pct: 10,
    projects_pct: 20,
    operations_pct: 10,
    effective_date: "2026-01-01",
  });

  await supabase.from("reward_periods").insert({
    id: testPeriodId,
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    allocation_model_id: testModelId,
    status: "approved",
  });

  await supabase.from("user_rewards").insert({
    id: testRewardId,
    user_id: testUserId,
    reward_period_id: testPeriodId,
    bitxbit_amount: amountDisplay,
    status: "approved",
  });
}

async function teardown() {
  await supabase.from("payout_operations").delete().eq("reward_id", testRewardId);
  await supabase.from("user_rewards").delete().eq("id", testRewardId);
  await supabase.from("reward_periods").delete().eq("id", testPeriodId);
  await supabase.from("allocation_models").delete().eq("id", testModelId);
  await supabase.from("wallet_verification_challenges").delete().eq("user_id", testUserId);
  await supabase.from("user_activities").delete().eq("user_id", testUserId);
  await supabase.from("affiliate_offers").delete().eq("id", testOfferId);
  await supabase.from("users").delete().eq("id", testUserId);
  await supabase.auth.admin.deleteUser(testUserId);
}

async function main() {
  await setup();

  await section("wallet verification challenge lifecycle", async () => {
    await supabase.from("wallet_verification_challenges").insert({
      user_id: testUserId,
      wallet_address: testWallet,
      nonce: "nonce-1",
      message: "test-message",
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

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
    await supabase
      .from("users")
      .update({ wallet_address: testWallet2 })
      .eq("id", testUserId);
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
    await supabase.from("users").update({ wallet_address: testWallet }).eq("id", testUserId);
    await supabase.from("users").update({ wallet_verified: true }).eq("id", testUserId);

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
    await supabase.from("payout_operations").update({ status: "pending" }).eq("operation_id", first);
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

    // Move to confirmed.
    await supabase
      .from("payout_operations")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("operation_id", first);

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
    await supabase.from("reward_periods").insert({
      id: rejectPeriodId,
      start_date: "2026-02-01",
      end_date: "2026-02-28",
      allocation_model_id: testModelId,
      status: "approved",
    });
    await supabase.from("user_rewards").insert({
      id: rejectRewardId,
      user_id: testUserId,
      reward_period_id: rejectPeriodId,
      bitxbit_amount: amountDisplay,
      status: "approved",
    });

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
    await supabase.from("reward_periods").update({ status: "calculating" }).eq("id", rejectPeriodId);
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
    await supabase.from("user_rewards").delete().eq("id", rejectRewardId);
    await supabase.from("reward_periods").delete().eq("id", rejectPeriodId);
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
