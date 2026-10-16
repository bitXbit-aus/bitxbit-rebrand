import { describe, it } from "node:test";
import assert from "node:assert";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { buildSiwsMessage, verifyEd25519Signature } from "./wallet-crypto";

describe("wallet cryptography", () => {
  it("builds a SIWS-compatible message containing all required fields", () => {
    const message = buildSiwsMessage({
      domain: "app.bitxbit.com.au",
      walletAddress: "DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5",
      nonce: "test-nonce",
      purpose: "Verify wallet ownership for bitxbit rewards",
      issuedAt: "2026-10-16T10:00:00.000Z",
      expiresAt: "2026-10-16T10:05:00.000Z",
    });

    assert.match(message, /app\.bitxbit\.com\.au wants you to sign in/);
    assert.match(message, /DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5/);
    assert.match(message, /Nonce: test-nonce/);
    assert.match(message, /Purpose: Verify wallet ownership for bitxbit rewards/);
    assert.match(message, /Issued At: 2026-10-16T10:00:00\.000Z/);
    assert.match(message, /Expiration Time: 2026-10-16T10:05:00\.000Z/);
  });

  it("verifies a valid Ed25519 signature for a SIWS message", () => {
    const keypair = Keypair.generate();
    const walletAddress = keypair.publicKey.toBase58();
    const message = buildSiwsMessage({
      domain: "app.bitxbit.com.au",
      walletAddress,
      nonce: "valid-nonce",
      purpose: "Verify wallet ownership for bitxbit rewards",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });

    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = nacl.sign.detached(messageBytes, keypair.secretKey);
    const signatureBase58 = bs58.encode(signatureBytes);

    assert.strictEqual(verifyEd25519Signature(message, signatureBase58, walletAddress), true);
  });

  it("rejects a signature from a different keypair", () => {
    const realKeypair = Keypair.generate();
    const attackerKeypair = Keypair.generate();
    const walletAddress = realKeypair.publicKey.toBase58();
    const message = buildSiwsMessage({
      domain: "app.bitxbit.com.au",
      walletAddress,
      nonce: "replay-nonce",
      purpose: "Verify wallet ownership for bitxbit rewards",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });

    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = nacl.sign.detached(messageBytes, attackerKeypair.secretKey);
    const signatureBase58 = bs58.encode(signatureBytes);

    assert.strictEqual(verifyEd25519Signature(message, signatureBase58, walletAddress), false);
  });

  it("rejects a signature over a different message", () => {
    const keypair = Keypair.generate();
    const walletAddress = keypair.publicKey.toBase58();
    const signedMessage = buildSiwsMessage({
      domain: "app.bitxbit.com.au",
      walletAddress,
      nonce: "nonce-a",
      purpose: "Verify wallet ownership for bitxbit rewards",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    const otherMessage = buildSiwsMessage({
      domain: "app.bitxbit.com.au",
      walletAddress,
      nonce: "nonce-b",
      purpose: "Verify wallet ownership for bitxbit rewards",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });

    const messageBytes = new TextEncoder().encode(signedMessage);
    const signatureBytes = nacl.sign.detached(messageBytes, keypair.secretKey);
    const signatureBase58 = bs58.encode(signatureBytes);

    assert.strictEqual(verifyEd25519Signature(otherMessage, signatureBase58, walletAddress), false);
  });
});
