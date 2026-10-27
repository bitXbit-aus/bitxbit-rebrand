import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Wallet challenge message construction, and Ed25519 verification.
 *
 * WHY THIS IS DELIBERATELY **NOT** SIWS (Sign-In With Solana)
 *
 * This messenger previously emitted the CAIP-122 / EIP-4361 SIWS wire format,
 * byte-for-byte identical to Phantom's own reference `createSignInMessageText`.
 * Phantom still refused EVERY such message with
 *
 *   "the app's signature request cannot be shown due to invalid formatting"
 *
 * without ever rendering a prompt — while signing plain messages from the same
 * wallet, in the same browser, in the same session. Measured on 2026-10-27 with a
 * controlled probe (four diagnostics, seven variants):
 *
 *   plain message                                  -> PASS
 *   SIWS prefix + address, NO field block           -> PASS
 *   SIWS prefix + address + any field block         -> FAIL, no prompt
 *   SIWS with a non-matching domain                 -> FAIL, "…the domain in the
 *                                                      sign-in message does not
 *                                                      match the requesting app's
 *                                                      origin"   (named explicitly)
 *   Solflare, any of the above                      -> PASS (it parses nothing)
 *
 * So the rejection is Phantom's SIWS validator refusing our field block, not the
 * domain, not the call convention (`display`), not CSP. When the DOMAIN is the
 * problem Phantom says so by name; here it did not, which is what ruled the domain
 * out. This matches independent reports of the same error appearing inconsistently
 * across browsers — a wallet-side defect we cannot satisfy from our side.
 *
 * DROPPING SIWS COSTS US NOTHING, AND HERE IS THE ARGUMENT
 *
 * SIWS exists so that a THIRD PARTY can parse and validate a message it did not
 * create. No third party ever parses ours: we mint the nonce, store the message,
 * check its expiry, and verify the Ed25519 signature over the exact stored text.
 * Every property SIWS claims is already held by something stronger —
 *
 *   replay protection : a single-use nonce, consumed atomically in Postgres
 *   freshness         : `Expires` here plus a 5-minute challenge TTL, server-checked
 *   domain binding    : the server minted the challenge; the Site line is for the
 *                       USER's benefit, so they can see what they are signing for
 *   integrity         : Ed25519 over the stored bytes, not over anything the client
 *                       says it signed
 *
 * The security boundary was never the message text. A hostile site could induce a
 * signature over a message that merely SAYS "app.bitxbit.com.au" — but it would
 * carry that site's nonce, which does not exist in our challenge table, so our
 * server refuses it. Trust comes from the nonce we minted and stored, not from a
 * string a wallet helpfully pattern-matched.
 *
 * ONE THING THAT IS STILL LOAD-BEARING: the message must not resemble an SIWS
 * message. A near-miss phrasing was enough to trigger Phantom's validator and a
 * hard refusal, so this builder deliberately avoids the phrase "wants you to sign
 * in with your … account:" entirely. `wallet-crypto.test.ts` asserts its absence
 * so a future well-meaning "let's be spec-compliant again" change cannot silently
 * reintroduce it.
 */

export interface WalletChallengeInput {
  /** The site the user is on, shown to them so they can see what they are signing for. */
  site: string;
  walletAddress: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  /** One line of intent, e.g. "Link this wallet to your bitxbit account." */
  purpose: string;
}

/**
 * Serialise the message a wallet is asked to sign.
 *
 * Throws rather than emitting something a strict wallet would refuse. A message
 * that silently fails on one wallet but not another is the most expensive kind of
 * defect in this area, so an invalid input fails loudly here instead.
 */
export function buildWalletChallengeMessage(input: WalletChallengeInput): string {
  const site = input.site.trim();
  const purpose = input.purpose.trim();

  if (!site) throw new Error("Challenge site is required.");
  if (!input.walletAddress) throw new Error("Challenge wallet address is required.");
  if (!input.nonce) throw new Error("Challenge nonce is required.");
  if (!input.issuedAt) throw new Error("Challenge issued-at is required.");
  if (!purpose) throw new Error("Challenge purpose is required.");

  const message = [
    "bitXbit wallet verification",
    "",
    `Site:    ${site}`,
    `Wallet:  ${input.walletAddress}`,
    `Nonce:   ${input.nonce}`,
    `Issued:  ${input.issuedAt}`,
    `Expires: ${input.expiresAt}`,
    `Purpose: ${purpose}`,
    "",
    "Signing this proves you control this wallet. It is not a transaction:",
    "nothing is sent on-chain and no fee is charged.",
  ].join("\n");

  // Guard the one property that is load-bearing for wallet compatibility. See the
  // file comment: an SIWS-shaped message is refused outright by Phantom.
  if (looksLikeSiws(message)) {
    throw new Error("Challenge message must not be SIWS-shaped.");
  }

  return message;
}

/**
 * True if `message` would trigger a wallet's SIWS parser.
 *
 * Kept deliberately broad: Phantom refused both the exact phrase and a near-miss
 * ("bitXbit wants you to sign in with your Solana account:"), so matching loosely
 * is the safer direction — a false positive here costs a clear server-side error,
 * a false negative costs a silent, unprompting refusal in the user's browser.
 */
export function looksLikeSiws(message: string): boolean {
  return /wants you to sign in with your\s+\S+\s+account:/i.test(message);
}

export function verifyEd25519Signature(
  message: string,
  signatureBase58: string,
  walletAddress: string
): boolean {
  const publicKey = new PublicKey(walletAddress);
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = bs58.decode(signatureBase58);
  return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());
}
