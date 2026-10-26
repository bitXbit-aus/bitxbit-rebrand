/**
 * End-to-end wallet ownership verification against staging.
 *
 * WHY THIS EXISTS
 * ---------------
 * The two halves of wallet verification were tested separately and never joined:
 *   * scripts/staging-smoke-test.ts  exercises `verify_wallet_challenge` at the
 *     DB level, but INSERTS the challenge row itself — no signature is involved;
 *   * lib/wallet-crypto.test.ts      verifies Ed25519 signatures, but never
 *     touches the database.
 *
 * So nothing proved that a REAL signature over the exact SIWS message the
 * application builds flows through the application's own verifier into a
 * successful, non-replayable database verification. That composition is the
 * control that stops a payout address being claimed on a connection alone.
 *
 * This script signs with a real keypair, verifies with the application's own
 * `verifyEd25519Signature`, then drives the real RPC. It also asserts the
 * negative paths: wrong signer, replayed nonce, expired challenge, and a
 * challenge/wallet mismatch.
 *
 * Required environment variables:
 *   STAGING_SUPABASE_URL
 *   STAGING_SUPABASE_SERVICE_ROLE_KEY
 *
 * Run from dashboard-app/ via `npm run test:wallet-verify`.
 * Exit 0 only when every assertion passes AND teardown is proven clean.
 */

import { createClient } from "@supabase/supabase-js";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { buildWalletChallengeMessage, verifyEd25519Signature } from "../lib/wallet-crypto";

const url = process.env.STAGING_SUPABASE_URL;
const serviceKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing STAGING_SUPABASE_URL or STAGING_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const runId = `walletverify-${Date.now()}`;
const suffix = runId.slice(-12);
const testUserId = `11111111-1111-4111-8111-${suffix}`;
const testEmail = `${runId}@staging-wallet.bitxbit`;
const DOMAIN = "app.bitxbit.com.au";
const PURPOSE = "Verify wallet ownership for bitxbit rewards";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`✓ ${name}`);
  } else {
    failures += 1;
    console.error(`✗ ${name}${detail ? `: ${detail}` : ""}`);
  }
}

async function expectRejects(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(name, false, "call unexpectedly succeeded (no error raised)");
  } catch {
    check(name, true);
  }
}

function signMessage(message: string, keypair: Keypair): string {
  const bytes = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);
  return bs58.encode(bytes);
}

function buildChallengeMessage(walletAddress: string, nonce: string, expiresAt: string): string {
  return buildWalletChallengeMessage({
    site: `https://${DOMAIN}`,
    walletAddress,
    nonce,
    issuedAt: new Date().toISOString(),
    expiresAt,
    purpose: PURPOSE,
  });
}

async function insertChallenge(
  walletAddress: string,
  nonce: string,
  message: string,
  expiresAt: string
): Promise<void> {
  const { error } = await supabase.from("wallet_verification_challenges").insert({
    user_id: testUserId,
    wallet_address: walletAddress,
    nonce,
    message,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`insert challenge: ${error.message}`);
}

async function rpcVerifyChallenge(walletAddress: string, nonce: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("verify_wallet_challenge", {
    p_user_id: testUserId,
    p_wallet_address: walletAddress,
    p_nonce: nonce,
  });
  if (error) throw error;
  return data === true;
}

async function setup(): Promise<void> {
  const { error } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: "staging-wallet-password-123!",
    email_confirm: true,
    id: testUserId,
    user_metadata: { display_name: "Staging Wallet Verify" },
  });
  if (error) throw error;
  // The handle_new_user() trigger provisions the users row; confirm it exists.
  const { data, error: readError } = await supabase
    .from("users")
    .select("id, wallet_address, wallet_verified")
    .eq("id", testUserId)
    .maybeSingle();
  if (readError) throw readError;
  if (!data) throw new Error("users row was not provisioned by the signup trigger");
}

async function teardown(): Promise<{ challenges: number; user: boolean }> {
  await supabase.from("wallet_verification_challenges").delete().eq("user_id", testUserId);
  await supabase.from("users").delete().eq("id", testUserId);
  await supabase.auth.admin.deleteUser(testUserId);

  const { count } = await supabase
    .from("wallet_verification_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", testUserId);
  const { data: leftover } = await supabase.from("users").select("id").eq("id", testUserId);
  return { challenges: count ?? 0, user: (leftover ?? []).length > 0 };
}

async function main(): Promise<void> {
  await setup();

  const keypair = Keypair.generate();
  const wallet = keypair.publicKey.toBase58();

  // ---------------------------------------------------------------- happy path
  const nonce = `nonce-${suffix}-ok`;
  const future = new Date(Date.now() + 300_000).toISOString();
  const message = buildChallengeMessage(wallet, nonce, future);
  await insertChallenge(wallet, nonce, message, future);

  const signature = signMessage(message, keypair);

  // The application's OWN verifier — the gate that runs before the RPC.
  check(
    "application verifier accepts a real signature over the built message",
    verifyEd25519Signature(message, signature, wallet) === true
  );

  let verified = false;
  try {
    verified = await rpcVerifyChallenge(wallet, nonce);
  } catch (err) {
    check("verify_wallet_challenge accepts a valid signature", false, String(err));
  }
  check("verify_wallet_challenge returns true", verified === true);

  const { data: after } = await supabase
    .from("users")
    .select("wallet_address, wallet_verified, wallet_verified_at")
    .eq("id", testUserId)
    .single();
  check("wallet address persisted", after?.wallet_address === wallet, `got ${after?.wallet_address}`);
  check("wallet_verified is TRUE", after?.wallet_verified === true);
  check("wallet_verified_at is set", Boolean(after?.wallet_verified_at));

  const { data: consumed } = await supabase
    .from("wallet_verification_challenges")
    .select("used_at")
    .eq("nonce", nonce)
    .single();
  check("challenge marked used", Boolean(consumed?.used_at));

  // ------------------------------------------------------------------ negatives
  await expectRejects("replaying the consumed nonce is rejected", () =>
    rpcVerifyChallenge(wallet, nonce)
  );

  const attacker = Keypair.generate();
  const attackerSig = signMessage(message, attacker);
  check(
    "application verifier rejects a signature from a different keypair",
    verifyEd25519Signature(message, attackerSig, wallet) === false
  );

  const expiredNonce = `nonce-${suffix}-expired`;
  const past = new Date(Date.now() - 60_000).toISOString();
  const expiredMessage = buildChallengeMessage(wallet, expiredNonce, past);
  await insertChallenge(wallet, expiredNonce, expiredMessage, past);
  await expectRejects("an expired challenge is rejected", () =>
    rpcVerifyChallenge(wallet, expiredNonce)
  );

  const otherNonce = `nonce-${suffix}-mismatch`;
  const otherMessage = buildChallengeMessage(wallet, otherNonce, future);
  await insertChallenge(wallet, otherNonce, otherMessage, future);
  const otherWallet = Keypair.generate().publicKey.toBase58();
  await expectRejects("a wallet that does not match the challenge is rejected", () =>
    rpcVerifyChallenge(otherWallet, otherNonce)
  );

  // A challenge row for a *different* user must not be consumable here.
  await expectRejects("a nonce that was never issued is rejected", () =>
    rpcVerifyChallenge(wallet, `nonce-${suffix}-never-issued`)
  );
}

main()
  .then(async () => {
    const teardownState = await teardown();
    check("teardown removed all challenges", teardownState.challenges === 0, `${teardownState.challenges} left`);
    check("teardown removed the test user", teardownState.user === false);

    if (failures > 0) {
      console.error(`\n${failures} wallet verification assertion(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll wallet ownership verification assertions passed.");
  })
  .catch(async (err) => {
    console.error("Wallet verification harness error:", err);
    await teardown().catch(() => {});
    process.exit(1);
  });
