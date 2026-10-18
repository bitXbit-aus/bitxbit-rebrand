/**
 * Staging Solana fault-injection test for the bitXbit payout pipeline.
 *
 * Connects to the staging Supabase project and Solana devnet, creates isolated
 * test data, and verifies that the durable payout workflow survives common
 * on-chain / RPC failure modes without producing unsafe retries or silent
 * successes.
 *
 * Required environment variables:
 *   STAGING_SUPABASE_URL
 *   STAGING_SUPABASE_SERVICE_ROLE_KEY
 *   BITXBIT_TOKEN_MINT (devnet USDC mint recommended)
 *   BITXBIT_TOKEN_DECIMALS (6 for devnet USDC)
 *   AIRDROP_WALLET_PRIVATE_KEY (devnet treasury)
 *   SOLANA_RPC_URL (required; must identify Solana devnet)
 */

import { Connection } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import {
  preparePayoutSubmission,
  broadcastPayoutSubmission,
  confirmPayoutSubmission,
  getAirdropWalletAddress,
  amountToRaw,
} from "../lib/payout";

const url = process.env.STAGING_SUPABASE_URL;
const serviceKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing STAGING_SUPABASE_URL or STAGING_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!process.env.AIRDROP_WALLET_PRIVATE_KEY) {
  console.error("Missing AIRDROP_WALLET_PRIVATE_KEY");
  process.exit(1);
}

if (!process.env.BITXBIT_TOKEN_MINT) {
  console.error("Missing BITXBIT_TOKEN_MINT");
  process.exit(1);
}

const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl) {
  console.error("Missing SOLANA_RPC_URL; fault tests require an explicit Solana devnet endpoint");
  process.exit(1);
}

const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const verifiedDevnetConnection = new Connection(rpcUrl, "confirmed");

async function verifyDevnetConnection(): Promise<void> {
  const genesisHash = await verifiedDevnetConnection.getGenesisHash();
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error(
      `SOLANA_RPC_URL is not Solana devnet (genesis hash ${genesisHash}); refusing all broadcasts`
    );
  }
  console.log(`Verified Solana devnet RPC (${genesisHash})`);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const runId = `fault-${Date.now()}`;
const testUserId = `11111111-1111-4111-8111-${runId.slice(-12)}`;
const testEmail = `${runId}@staging-fault.bitxbit`;
const testWallet = "DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5";
const testModelId = `55555555-5555-4555-8555-${runId.slice(-12)}`;
const testPeriodId = `33333333-3333-4333-8333-${runId.slice(-12)}`;
const testRewardId = `44444444-4444-4444-8444-${runId.slice(-12)}`;

const tokenDecimals = parseInt(process.env.BITXBIT_TOKEN_DECIMALS || "9", 10);
const amountDisplay = 0.001;
const amountRaw = amountToRaw(amountDisplay, tokenDecimals);

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

async function setup() {
  const { error: authError } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: "staging-fault-password-123!",
    email_confirm: true,
    id: testUserId,
    user_metadata: { display_name: "Staging Fault Test" },
  });
  if (authError) throw authError;

  await supabase.from("users").update({ wallet_address: testWallet }).eq("id", testUserId);
  await supabase.from("users").update({ wallet_verified: true }).eq("id", testUserId);

  await supabase.from("allocation_models").insert({
    id: testModelId,
    name: "Staging Fault Model",
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
  await supabase.from("users").delete().eq("id", testUserId);
  await supabase.auth.admin.deleteUser(testUserId);
}

async function rpc<T>(fn: string, args: unknown): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args as any);
  if (error) throw error;
  return data as T;
}

async function persistSubmitted(
  operationId: string,
  prepared: Awaited<ReturnType<typeof preparePayoutSubmission>>
) {
  const { error } = await supabase.from("payout_operations").insert({
    operation_id: operationId,
    reward_period_id: testPeriodId,
    reward_id: testRewardId,
    user_id: testUserId,
    wallet_address: testWallet,
    token_amount_raw: Number(prepared.amountRaw),
    token_decimals: tokenDecimals,
    status: "submitting",
    transaction_hash: prepared.txHash,
    signed_transaction_base58: prepared.signedTransactionBase58,
    last_blockhash: prepared.lastBlockhash,
    actor_id: testUserId,
  });
  if (error) throw error;
}

async function main() {
  // This is deliberately the first network action. No transaction may be
  // prepared or broadcast until the configured RPC proves it is devnet.
  await verifyDevnetConnection();
  await setup();
  const sourceWalletAddress = getAirdropWalletAddress();
  const operationId = `fault:${runId}:reward`;

  await section("prepare real devnet payout submission", async () => {
    const prepared = await preparePayoutSubmission({
      operationId,
      walletAddress: testWallet,
      amountRaw,
    });
    if (prepared.preparationError || !prepared.txHash) {
      throw new Error(`preparation failed: ${prepared.preparationError}`);
    }
  });

  await section("broadcast failure preserves durable transaction identity", async () => {
    const prepared = await preparePayoutSubmission({
      operationId,
      walletAddress: testWallet,
      amountRaw,
    });
    if (prepared.preparationError || !prepared.signedTransactionBase58) {
      throw new Error(`preparation failed: ${prepared.preparationError}`);
    }

    // Inject a transport that deterministically fails before touching any RPC.
    // This proves the broadcast error path itself rather than relying on an
    // environment-variable mutation or a possibly reachable endpoint.
    let sendAttempts = 0;
    const failedTransport = {
      sendRawTransaction: async () => {
        sendAttempts += 1;
        throw new Error("injected Solana RPC broadcast outage");
      },
    };
    const broadcasted = await broadcastPayoutSubmission(prepared, failedTransport);
    if (!broadcasted.broadcastError?.includes("injected Solana RPC broadcast outage")) {
      throw new Error(`broadcast did not report the injected outage: ${broadcasted.broadcastError}`);
    }
    if (sendAttempts !== 1) {
      throw new Error(`expected one mocked broadcast attempt, got ${sendAttempts}`);
    }
    if (broadcasted.txHash !== prepared.txHash) {
      throw new Error("broadcast error path lost the prepared transaction hash");
    }
  });

  await section("confirmation of unknown transaction returns uncertain", async () => {
    const fakeSubmission = {
      operationId,
      walletAddress: testWallet,
      amountRaw,
      txHash: "1111111111111111111111111111111111111111111111111111111111111111",
      signedTransactionBase58: null,
      lastBlockhash: null,
      lastValidBlockHeight: null,
      preparationError: null,
      broadcastError: null,
    };
    const confirmation = await confirmPayoutSubmission(
      fakeSubmission,
      sourceWalletAddress,
      5000,
      500,
      verifiedDevnetConnection
    );
    if (!confirmation.uncertain) {
      throw new Error(`expected uncertain for unknown tx, got confirmed=${confirmation.confirmed}`);
    }
  });

  await section("on-chain mismatch is reported as non-retryable incident", async () => {
    const prepared = await preparePayoutSubmission({
      operationId,
      walletAddress: testWallet,
      amountRaw,
    });
    if (prepared.preparationError || !prepared.txHash) {
      throw new Error(`preparation failed: ${prepared.preparationError}`);
    }

    await persistSubmitted(operationId, prepared);

    const broadcasted = await broadcastPayoutSubmission(prepared, verifiedDevnetConnection);
    if (broadcasted.broadcastError) {
      throw new Error(`real devnet broadcast failed: ${broadcasted.broadcastError}`);
    }

    // Wait briefly for the transaction to land.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Confirm expecting a different amount so the landed transfer does not match.
    const mismatchedAmount = amountRaw * 2n;
    const mismatchedSubmission = {
      ...prepared,
      amountRaw: mismatchedAmount,
    };
    const confirmation = await confirmPayoutSubmission(
      mismatchedSubmission,
      sourceWalletAddress,
      60000,
      2000,
      verifiedDevnetConnection
    );

    if (!confirmation.incident) {
      throw new Error(
        `expected incident for amount mismatch, got confirmed=${confirmation.confirmed}, uncertain=${confirmation.uncertain}`
      );
    }
  });
}

main()
  .then(async () => {
    await teardown();
    if (failures > 0) {
      console.error(`\n${failures} Solana fault-injection test(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll Solana fault-injection tests passed.");
  })
  .catch(async (err) => {
    console.error("Solana fault-injection test error:", err);
    await teardown().catch(() => {});
    process.exit(1);
  });
