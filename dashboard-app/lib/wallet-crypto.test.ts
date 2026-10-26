import { describe, it } from "node:test";
import assert from "node:assert";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  buildSiwsMessage,
  verifyEd25519Signature,
  siwsUriForDomain,
  SIWS_VERSION,
  SIWS_CHAIN_ID,
} from "./wallet-crypto";

/**
 * Phantom's own reference serialiser, copied VERBATIM from
 * github.com/phantom/sign-in-with-solana (`createSignInMessageText`).
 *
 * The tests below assert our builder is byte-identical to this. That matters more
 * than it looks: the previous version of this file asserted the presence of
 * `Purpose: …` — a field that is NOT in the SIWS spec — and asserted nothing about
 * `URI`, `Version` or `Chain ID`, which the spec marks as REQUIRED. So the test
 * certified the bug. Phantom refused every message built from it with "the app's
 * signature request cannot be shown due to invalid formatting", while Solflare
 * (which does not parse SIWS) signed happily.
 *
 * Pinning to the reference function means the test encodes the SPEC, not our
 * implementation. If Phantom's format changes, this test is where we find out.
 */
function phantomReferenceMessage(input: {
  domain: string;
  address: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
}): string {
  let message = `${input.domain} wants you to sign in with your Solana account:\n`;
  message += `${input.address}`;

  if (input.statement) {
    message += `\n\n${input.statement}`;
  }

  const fields: string[] = [];
  if (input.uri) fields.push(`URI: ${input.uri}`);
  if (input.version) fields.push(`Version: ${input.version}`);
  if (input.chainId) fields.push(`Chain ID: ${input.chainId}`);
  if (input.nonce) fields.push(`Nonce: ${input.nonce}`);
  if (input.issuedAt) fields.push(`Issued At: ${input.issuedAt}`);
  if (input.expirationTime) fields.push(`Expiration Time: ${input.expirationTime}`);
  if (fields.length) {
    message += `\n\n${fields.join("\n")}`;
  }

  return message;
}

const WALLET = "DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5";
const DOMAIN = "app.bitxbit.com.au";
const STATEMENT = "Verify wallet ownership for bitxbit rewards. Signing proves you own this wallet and costs no fee or transaction.";

function validInput(overrides: Partial<Parameters<typeof buildSiwsMessage>[0]> = {}) {
  return {
    domain: DOMAIN,
    walletAddress: WALLET,
    statement: STATEMENT,
    uri: siwsUriForDomain(DOMAIN),
    version: SIWS_VERSION,
    chainId: SIWS_CHAIN_ID,
    nonce: "test-nonce",
    issuedAt: "2026-10-16T10:00:00.000Z",
    expiresAt: "2026-10-16T10:05:00.000Z",
    ...overrides,
  };
}

describe("wallet cryptography", () => {
  it("is byte-identical to Phantom's reference SIWS serialiser", () => {
    const message = buildSiwsMessage(validInput());
    const reference = phantomReferenceMessage({
      domain: DOMAIN,
      address: WALLET,
      statement: STATEMENT,
      uri: siwsUriForDomain(DOMAIN),
      version: SIWS_VERSION,
      chainId: SIWS_CHAIN_ID,
      nonce: "test-nonce",
      issuedAt: "2026-10-16T10:00:00.000Z",
      expirationTime: "2026-10-16T10:05:00.000Z",
    });

    assert.strictEqual(message, reference);
  });

  it("includes every field the SIWS spec marks as required", () => {
    const message = buildSiwsMessage(validInput());

    // The three that were missing and made every Phantom request unshowable.
    assert.match(message, /^URI: https:\/\/app\.bitxbit\.com\.au$/m);
    assert.match(message, /^Version: 1$/m);
    assert.match(message, /^Chain ID: mainnet$/m);

    assert.match(message, /^app\.bitxbit\.com\.au wants you to sign in with your Solana account:$/m);
    assert.match(message, /^DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5$/m);
    assert.match(message, /^Nonce: test-nonce$/m);
    assert.match(message, /^Issued At: 2026-10-16T10:00:00\.000Z$/m);
    assert.match(message, /^Expiration Time: 2026-10-16T10:05:00\.000Z$/m);
  });

  it("never emits the non-standard Purpose: field that broke Phantom", () => {
    const message = buildSiwsMessage(validInput());
    // Regression guard: `Purpose:` is not a SIWS field. Its presence is exactly
    // what made Phantom unable to parse the field block.
    assert.doesNotMatch(message, /^Purpose:/m);
  });

  it("places the statement as a bare line between two blank lines", () => {
    const lines = buildSiwsMessage(validInput()).split("\n");
    assert.strictEqual(lines[0], `${DOMAIN} wants you to sign in with your Solana account:`);
    assert.strictEqual(lines[1], WALLET);
    assert.strictEqual(lines[2], "");
    assert.strictEqual(lines[3], STATEMENT);
    assert.strictEqual(lines[4], "");
    assert.strictEqual(lines[5], `URI: ${siwsUriForDomain(DOMAIN)}`);
  });

  it("rejects a statement containing a newline", () => {
    assert.throws(
      () => buildSiwsMessage(validInput({ statement: "line one\nline two" })),
      /single line/
    );
  });

  it("rejects an unrecognised chain id", () => {
    assert.throws(
      () => buildSiwsMessage(validInput({ chainId: "not-a-chain" })),
      /chain id/
    );
  });

  it("rejects a uri whose origin does not match the signing domain", () => {
    assert.throws(
      () => buildSiwsMessage(validInput({ uri: "https://evil.example" })),
      /origin must match/
    );
  });

  it("verifies a valid Ed25519 signature for a SIWS message", () => {
    const keypair = Keypair.generate();
    const walletAddress = keypair.publicKey.toBase58();
    const message = buildSiwsMessage(validInput({ walletAddress }));

    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);
    assert.strictEqual(
      verifyEd25519Signature(message, bs58.encode(signatureBytes), walletAddress),
      true
    );
  });

  it("rejects a signature from a different keypair", () => {
    const realKeypair = Keypair.generate();
    const attackerKeypair = Keypair.generate();
    const walletAddress = realKeypair.publicKey.toBase58();
    const message = buildSiwsMessage(validInput({ walletAddress }));

    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(message), attackerKeypair.secretKey);
    assert.strictEqual(
      verifyEd25519Signature(message, bs58.encode(signatureBytes), walletAddress),
      false
    );
  });

  it("rejects a signature over a different message (nonce binding)", () => {
    const keypair = Keypair.generate();
    const walletAddress = keypair.publicKey.toBase58();
    const signed = buildSiwsMessage(validInput({ walletAddress, nonce: "nonce-a" }));
    const other = buildSiwsMessage(validInput({ walletAddress, nonce: "nonce-b" }));

    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(signed), keypair.secretKey);
    assert.strictEqual(
      verifyEd25519Signature(other, bs58.encode(signatureBytes), walletAddress),
      false
    );
  });
});
