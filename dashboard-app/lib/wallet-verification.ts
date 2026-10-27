"use server";

import "server-only";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { requireActiveUser } from "@/lib/authz";
import { writeSecurityAudit } from "@/lib/audit";
import { isValidSolanaAddress } from "@/lib/solana";
import { buildWalletChallengeMessage, verifyEd25519Signature } from "@/lib/wallet-crypto";

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

/**
 * Closed set of verification failure reasons, so the audit trail is queryable
 * rather than free text.
 *
 * WHY EVERY PATH AUDITS: previously only the invalid-signature case wrote a row;
 * the other six failure paths threw into silence. A user's report of "verification
 * failed" left the server with NO record of which path was taken, which makes the
 * failure impossible to diagnose from evidence. A failure that leaves no trace is
 * a failure that cannot be fixed.
 */
type VerificationFailureReason =
  | "invalid_address"
  | "missing_signature"
  | "missing_nonce"
  | "challenge_not_found"
  | "challenge_already_used"
  | "challenge_expired"
  | "signature_unverifiable"
  | "signature_invalid"
  | "persist_failed";

async function failVerification(
  context: Awaited<ReturnType<typeof requireActiveUser>>,
  reason: VerificationFailureReason,
  walletAddress: string,
  nonce: string | null,
  message: string
): Promise<never> {
  try {
    await writeSecurityAudit(context, {
      action: "wallet.verification_failed",
      targetTable: "public.wallet_verification_challenges",
      targetId: nonce ?? undefined,
      success: false,
      metadata: { reason, wallet_address: walletAddress },
    });
  } catch {
    // An audit failure must never mask the failure being reported. Losing the
    // original error here would be strictly worse than losing the record.
  }
  throw new Error(message);
}

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
    return failVerification(
      context,
      "invalid_address",
      walletAddress,
      null,
      "Invalid Solana wallet address."
    );
  }

  const supabase = createServiceClient();
  const nonce = randomUUID();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
  const domain = getAppDomain();
  const message = buildWalletChallengeMessage({
    site: `https://${domain}`,
    walletAddress,
    nonce,
    issuedAt,
    expiresAt,
    purpose: "Link this wallet to your bitxbit account.",
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
    return failVerification(
      context,
      "invalid_address",
      walletAddress,
      nonce,
      "Invalid Solana wallet address."
    );
  }
  if (!signatureBase58 || signatureBase58.length === 0) {
    return failVerification(
      context,
      "missing_signature",
      walletAddress,
      nonce,
      "Signature is required."
    );
  }
  if (!nonce || nonce.length === 0) {
    return failVerification(
      context,
      "missing_nonce",
      walletAddress,
      nonce,
      "Verification nonce is required."
    );
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
    return failVerification(
      context,
      "challenge_not_found",
      walletAddress,
      nonce,
      "Verification challenge not found."
    );
  }

  if (challenge.used_at) {
    return failVerification(
      context,
      "challenge_already_used",
      walletAddress,
      nonce,
      "Verification challenge has already been used."
    );
  }

  if (new Date(challenge.expires_at) <= new Date()) {
    return failVerification(
      context,
      "challenge_expired",
      walletAddress,
      nonce,
      "Verification challenge has expired."
    );
  }

  // Verify the Ed25519 signature.
  let isValid = false;
  try {
    isValid = verifyEd25519Signature(challenge.message, signatureBase58, walletAddress);
  } catch {
    return failVerification(
      context,
      "signature_unverifiable",
      walletAddress,
      nonce,
      "Could not verify signature."
    );
  }

  if (!isValid) {
    return failVerification(
      context,
      "signature_invalid",
      walletAddress,
      nonce,
      "Signature verification failed."
    );
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
    return failVerification(
      context,
      "persist_failed",
      walletAddress,
      nonce,
      `Failed to record wallet verification: ${verifyError?.message ?? "unknown error"}`
    );
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
