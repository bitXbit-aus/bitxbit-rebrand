import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

export interface SiwsMessageInput {
  domain: string;
  walletAddress: string;
  nonce: string;
  purpose: string;
  issuedAt: string;
  expiresAt: string;
}

export function buildSiwsMessage(input: SiwsMessageInput): string {
  return `${input.domain} wants you to sign in with your Solana account:\n${input.walletAddress}\n\nPurpose: ${input.purpose}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expiresAt}`;
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
