import "server-only";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidSolanaAddress } from "@/lib/solana";
import { buildWalletChallengeMessage, verifyEd25519Signature } from "@/lib/wallet-crypto";
import { resolveSignInDomain } from "@/lib/auth-callback-url";

// Re-exported so callers of the sign-in surface need one import. The resolver
// itself lives in the host module because it is pure and unit-tested, whereas
// this module is `server-only` and cannot be loaded by a test runner.
export { resolveSignInDomain };

/**
 * Phase 2 (B3) — wallet sign-in, link-only.
 *
 * A member proves control of the wallet already linked to their account and is
 * signed in without a password or an email round-trip. There are NO wallet-only
 * accounts: the account must already exist and its wallet must be `wallet_verified`.
 *
 * This module owns the sign-in half. It deliberately REUSES
 * `buildWalletChallengeMessage` / `verifyEd25519Signature` from `lib/wallet-crypto` — the same
 * functions the existing wallet-verification flow uses. Forking the message format
 * would silently stop already-verified wallets from being able to sign in, which is
 * a failure that no unit test of either half would catch.
 *
 * Two properties are load-bearing for the security of the whole feature:
 *
 * 1. **No enumeration.** A challenge is issued for ANY well-formed address,
 *    registered or not, and every failure at verification returns one identical
 *    outcome to the caller. The caller therefore cannot use this surface to learn
 *    which wallets have accounts.
 * 2. **The database decides ownership.** The Ed25519 signature is verified here,
 *    but the account is resolved by `verify_wallet_signin`, which consumes the
 *    challenge atomically and returns an account ONLY when `wallet_verified` is
 *    true. Possession of an address is not ownership; possession of the private key
 *    AND a prior verification is.
 */

export const WALLET_SIGNIN_CHALLENGE_TTL_SECONDS = 300; // 5 minutes

/**
 * Distinct from the wallet-verification purpose on purpose: a signature collected
 * to prove ownership while signed in must not be replayable as a sign-in, nor the
 * reverse. Both are bound to their own nonce, and the wording makes the intent of
 * a captured signature unambiguous to the person signing it.
 */
const WALLET_SIGNIN_PURPOSE = "Sign in to your bitxbit account with your Solana wallet";

export interface WalletSignInChallenge {
  nonce: string;
  message: string;
  expiresAt: string;
}

/**
 * Internal outcomes.
 *
 * Two classes, and the split is the point:
 *
 * - `unknown_challenge` and `invalid_signature` are reachable WITHOUT proving
 *   anything, so the caller maps them to one generic message. Distinguishing them
 *   would be an enumeration oracle.
 * - `wallet_not_linked` and `wallet_not_verified` are only ever produced AFTER the
 *   Ed25519 signature has verified, which proves the caller holds the private key
 *   for that wallet. Naming which case it is therefore reveals nothing the caller
 *   does not already know (that they own this wallet), and it is the difference
 *   between a dead end and an actionable instruction.
 */
export type WalletSignInOutcome =
  | "signed_in"
  | "unknown_challenge"
  | "invalid_signature"
  | "wallet_not_linked"
  | "wallet_not_verified";

export interface WalletSignInResult {
  outcome: WalletSignInOutcome;
  userId: string | null;
}

/**
 * The domain shown in the SIWS message the user signs is resolved by
 * `resolveSignInDomain` (re-exported above), which binds the message to the host
 * the user is ACTUALLY on rather than the canonical production URL. It is kept in
 * the host module so it is covered by unit tests.
 */

/**
 * Issues a challenge for any well-formed Solana address.
 *
 * No account lookup happens here — see the no-enumeration note above. The row is
 * written with the service role: `wallet_signin_challenges` is revoked from
 * `anon`/`authenticated`, so this table is only reachable server-side.
 */
export async function createWalletSignInChallenge(
  walletAddress: string,
  domain: string
): Promise<WalletSignInChallenge> {
  if (!isValidSolanaAddress(walletAddress)) {
    throw new Error("Invalid Solana wallet address.");
  }

  const nonce = randomUUID();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + WALLET_SIGNIN_CHALLENGE_TTL_SECONDS * 1000
  ).toISOString();

  const message = buildWalletChallengeMessage({
    site: `https://${domain}`,
    walletAddress,
    nonce,
    issuedAt,
    expiresAt,
    purpose: WALLET_SIGNIN_PURPOSE,
  });

  const supabase = createServiceClient();
  const { error } = await supabase.from("wallet_signin_challenges").insert({
    wallet_address: walletAddress,
    nonce,
    message,
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(`Failed to create sign-in challenge: ${error.message}`);
  }

  return { nonce, message, expiresAt };
}

/**
 * Verifies a signed challenge and resolves the account it belongs to.
 *
 * The challenge row is fetched first so the EXACT message that must have been
 * signed is recovered from the database rather than accepted from the caller — a
 * caller-supplied message would let an attacker have the user sign something
 * innocuous and then replay it as a sign-in.
 *
 * A failed signature does NOT consume the challenge: Ed25519 signatures cannot be
 * forged, so a bad signature is a wallet/UX failure rather than an attack, and
 * consuming on failure would strand a legitimate user whose wallet UI glitched.
 * The challenge is still single-use — `verify_wallet_signin` consumes it atomically
 * before resolving the owner, so a successful verification cannot be replayed.
 */
export async function verifyWalletSignIn(params: {
  walletAddress: string;
  signatureBase58: string;
  nonce: string;
}): Promise<WalletSignInResult> {
  const { walletAddress, signatureBase58, nonce } = params;

  if (!isValidSolanaAddress(walletAddress)) {
    return { outcome: "unknown_challenge", userId: null };
  }
  if (!signatureBase58 || !nonce) {
    return { outcome: "unknown_challenge", userId: null };
  }

  const supabase = createServiceClient();

  const { data: challenge, error: challengeError } = await supabase
    .from("wallet_signin_challenges")
    .select("id, message, expires_at, used_at")
    .eq("wallet_address", walletAddress)
    .eq("nonce", nonce)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (challengeError || !challenge) {
    return { outcome: "unknown_challenge", userId: null };
  }

  let isValid = false;
  try {
    isValid = verifyEd25519Signature(challenge.message, signatureBase58, walletAddress);
  } catch {
    isValid = false;
  }

  if (!isValid) {
    return { outcome: "invalid_signature", userId: null };
  }

  // Atomic consume + resolve. The function raises on a challenge that is invalid,
  // expired or already used, and returns NULL when no VERIFIED account owns the
  // wallet — so "no such challenge" and "no such account" stay distinguishable
  // here while remaining indistinguishable to the caller.
  const { data, error } = await supabase.rpc("verify_wallet_signin", {
    p_wallet_address: walletAddress,
    p_nonce: nonce,
  });

  if (error) {
    return { outcome: "unknown_challenge", userId: null };
  }

  if (!data) {
    // The signature verified, so the caller provably holds this wallet's private
    // key. That is what makes it safe to name which case this is — and this lookup
    // deliberately lives HERE, after the signature check: performed any earlier it
    // would answer "does this wallet have an account?" for anybody who asked, which
    // is exactly the oracle the generic messages exist to deny.
    const { data: owner } = await supabase
      .from("users")
      .select("wallet_verified")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    return {
      outcome: owner ? "wallet_not_verified" : "wallet_not_linked",
      userId: null,
    };
  }

  return { outcome: "signed_in", userId: data as string };
}
