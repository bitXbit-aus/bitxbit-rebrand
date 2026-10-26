import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Sign-In With Solana (SIWS) message construction.
 *
 * WHY THIS FILE IS SO PARTICULAR
 *
 * Phantom recognises any message beginning with
 *
 *   "<domain> wants you to sign in with your Solana account:"
 *
 * as SIWS, and **validates it before it will show the user a prompt**. A message it
 * cannot parse is refused outright: the user sees nothing, and the dApp receives
 *
 *   "the app's signature request cannot be shown due to invalid formatting"
 *
 * That is a HARD block, distinct from the bypassable warning Phantom shows when a
 * field VALUE is wrong (bad domain, future issued-at).
 *
 * Solflare does not parse SIWS at all — it signs whatever it is handed. So a
 * malformed message works, silently, for every Solflare user and fails for every
 * Phantom user. That asymmetry is how the bug this file fixes survived: the message
 * previously omitted `URI`, `Version` and `Chain ID` (all required by the spec) and
 * put a non-standard `Purpose:` field where `URI:` belongs.
 *
 * The serialisation below mirrors Phantom's own reference implementation,
 * `createSignInMessageText` (github.com/phantom/sign-in-with-solana), byte for byte.
 * `wallet-crypto.test.ts` asserts that equality against a verbatim copy of the
 * reference function, so the test encodes the SPEC rather than our implementation.
 */

/** SIWS `version` field. "1" is the only value the spec defines. */
export const SIWS_VERSION = "1";

/**
 * Chain IDs the SIWS spec recognises. A wallet validates this field, so an
 * unrecognised value is rejected the same way a missing field is.
 */
export const SIWS_ALLOWED_CHAIN_IDS = [
  "mainnet",
  "testnet",
  "devnet",
  "localnet",
  "solana:mainnet",
  "solana:testnet",
  "solana:devnet",
] as const;

export type SiwsChainId = (typeof SIWS_ALLOWED_CHAIN_IDS)[number];

/** Chain this app binds its sessions to. */
export const SIWS_CHAIN_ID: SiwsChainId = "mainnet";

export interface SiwsMessageInput {
  domain: string;
  walletAddress: string;
  /** Human-readable assertion. MUST NOT contain a newline (spec requirement). */
  statement: string;
  /** Must share an origin with `domain`: Phantom validates this. */
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

/** The `uri` a message for `domain` should claim. */
export function siwsUriForDomain(domain: string): string {
  return `https://${domain}`;
}

/**
 * Serialise a SIWS message.
 *
 * Throws rather than emitting a message a validating wallet would refuse. A
 * malformed message is indistinguishable from a broken feature at the user's end,
 * so failing here — server-side, with a reason — is strictly better than shipping
 * something that works for one wallet and silently fails for another.
 */
export function buildSiwsMessage(input: SiwsMessageInput): string {
  const domain = input.domain.trim();
  const statement = input.statement.trim();

  if (!domain) throw new Error("SIWS domain is required.");
  if (!input.walletAddress) throw new Error("SIWS address is required.");
  if (!input.nonce) throw new Error("SIWS nonce is required.");
  if (!input.issuedAt) throw new Error("SIWS issued-at is required.");

  // The spec forbids a newline in the statement: the field block that follows is
  // newline-delimited, so a newline here would shift every subsequent field.
  if (statement.includes("\n") || statement.includes("\r")) {
    throw new Error("SIWS statement must be a single line.");
  }

  if (!(SIWS_ALLOWED_CHAIN_IDS as readonly string[]).includes(input.chainId)) {
    throw new Error(`Unrecognised SIWS chain id: ${input.chainId}`);
  }

  // Phantom compares the uri origin against the requesting page's origin and
  // returns -32000 without prompting on a mismatch.
  let uriOrigin: string;
  try {
    uriOrigin = new URL(input.uri).origin;
  } catch {
    throw new Error("SIWS uri must be an absolute URL.");
  }
  if (uriOrigin !== new URL(siwsUriForDomain(domain)).origin) {
    throw new Error("SIWS uri origin must match the signing domain.");
  }

  // --- serialisation: mirrors Phantom's createSignInMessageText exactly ---
  let message = `${domain} wants you to sign in with your Solana account:\n`;
  message += input.walletAddress;

  if (statement) {
    message += `\n\n${statement}`;
  }

  const fields: string[] = [];
  fields.push(`URI: ${input.uri}`);
  fields.push(`Version: ${input.version}`);
  fields.push(`Chain ID: ${input.chainId}`);
  fields.push(`Nonce: ${input.nonce}`);
  fields.push(`Issued At: ${input.issuedAt}`);
  if (input.expiresAt) fields.push(`Expiration Time: ${input.expiresAt}`);

  message += `\n\n${fields.join("\n")}`;

  return message;
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
