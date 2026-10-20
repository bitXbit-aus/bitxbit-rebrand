"use server";

import "server-only";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { requireActiveUser } from "@/lib/authz";
import { writeSecurityAudit } from "@/lib/audit";
import { isValidSolanaAddress } from "@/lib/solana";
import { buildSiwsMessage, verifyEd25519Signature } from "@/lib/wallet-crypto";

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

export interface WalletChallenge {
  nonce: string;
  message: string;
  walletAddress: string;
  expiresAt: string;
}

export interface WalletVerificationResult {
  success: boolean;
  walletAddress: string;
  verifiedAt: string;
}

function getAppDomain(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) return "app.bitxbit.com.au";
  try {
    return new URL(url).hostname;
  } catch {
    return "app.bitxbit.com.au";
  }
}

export async function requestWalletVerificationChallenge(
  walletAddress: string
): Promise<WalletChallenge> {
  const context = await requireActiveUser();

  if (!isValidSolanaAddress(walletAddress)) {
    throw new Error("Invalid Solana wallet address.");
  }

  const supabase = createServiceClient();
  const nonce = randomUUID();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
  const message = buildSiwsMessage({
    domain: getAppDomain(),
    walletAddress,
    nonce,
    purpose: "Verify wallet ownership for bitxbit rewards",
    issuedAt,
    expiresAt,
  });

  const { error } = await supabase.from("wallet_verification_challenges").insert({
    user_id: context.user.id,
    wallet_address: walletAddress,
    nonce,
    message,
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(`Failed to create verification challenge: ${error.message}`);
  }

  await writeSecurityAudit(context, {
    action: "wallet.verification_challenge_created",
    targetTable: "public.wallet_verification_challenges",
    targetId: nonce,
    metadata: { wallet_address: walletAddress, expires_at: expiresAt },
  });

  return { nonce, message, walletAddress, expiresAt };
}

export async function verifyWalletSignature(
  walletAddress: string,
  signatureBase58: string,
  nonce: string
): Promise<WalletVerificationResult> {
  const context = await requireActiveUser();

  if (!isValidSolanaAddress(walletAddress)) {
    throw new Error("Invalid Solana wallet address.");
  }
  if (!signatureBase58 || signatureBase58.length === 0) {
    throw new Error("Signature is required.");
  }
  if (!nonce || nonce.length === 0) {
    throw new Error("Verification nonce is required.");
  }

  const supabase = createServiceClient();

  // Fetch the challenge to ensure it exists, belongs to this user/wallet, and
  // to recover the exact message that must have been signed.
  const { data: challenge, error: challengeError } = await supabase
    .from("wallet_verification_challenges")
    .select("id, message, expires_at, used_at")
    .eq("user_id", context.user.id)
    .eq("wallet_address", walletAddress)
    .eq("nonce", nonce)
    .maybeSingle();

  if (challengeError || !challenge) {
    throw new Error("Verification challenge not found.");
  }

  if (challenge.used_at) {
    throw new Error("Verification challenge has already been used.");
  }

  if (new Date(challenge.expires_at) <= new Date()) {
    throw new Error("Verification challenge has expired.");
  }

  // Verify the Ed25519 signature.
  let isValid = false;
  try {
    isValid = verifyEd25519Signature(challenge.message, signatureBase58, walletAddress);
  } catch (error) {
    throw new Error("Could not verify signature.");
  }

  if (!isValid) {
    await writeSecurityAudit(context, {
      action: "wallet.verification_signature_invalid",
      targetTable: "public.wallet_verification_challenges",
      targetId: nonce,
      success: false,
      metadata: { wallet_address: walletAddress },
    });
    throw new Error("Signature verification failed.");
  }

  // Atomic database-controlled verification: consume the signed challenge and
  // update the verified payout address together inside a single database
  // function. The function performs the address change (which resets
  // wallet_verified via trigger) and then sets wallet_verified = TRUE as a
  // second statement within the same transaction.
  const { data: verified, error: verifyError } = await supabase.rpc("verify_wallet_challenge", {
    p_user_id: context.user.id,
    p_wallet_address: walletAddress,
    p_nonce: nonce,
  });

  if (verifyError || verified !== true) {
    throw new Error(`Failed to record wallet verification: ${verifyError?.message ?? "unknown error"}`);
  }

  const verifiedAt = new Date().toISOString();

  await writeSecurityAudit(context, {
    action: "wallet.verified",
    targetTable: "public.users",
    targetId: context.user.id,
    after: { wallet_address: walletAddress, wallet_verified: true, wallet_verified_at: verifiedAt },
    metadata: { nonce },
  });

  return { success: true, walletAddress, verifiedAt };
}

export async function getWalletVerificationStatus(): Promise<{
  walletAddress: string | null;
  verified: boolean;
  verifiedAt: string | null;
}> {
  const context = await requireActiveUser();
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("users")
    .select("wallet_address, wallet_verified, wallet_verified_at")
    .eq("id", context.user.id)
    .single();

  if (error) {
    throw new Error(`Failed to load wallet status: ${error.message}`);
  }

  return {
    walletAddress: data?.wallet_address ?? null,
    verified: data?.wallet_verified ?? false,
    verifiedAt: data?.wallet_verified_at ?? null,
  };
}
