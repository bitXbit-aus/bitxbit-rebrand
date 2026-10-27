import { describe, it } from "node:test";
import assert from "node:assert";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  buildWalletChallengeMessage,
  looksLikeSiws,
  verifyEd25519Signature,
} from "./wallet-crypto";

/**
 * These tests encode the CONTRACT WITH THE WALLET — the part the type system, the
 * build and CI cannot see.
 *
 * HISTORY, because it is why this file looks the way it does:
 *
 *  v1 asserted the presence of a `Purpose:` field that is not in the SIWS spec, and
 *  asserted nothing about `URI`/`Version`/`Chain ID`, which the spec marks required.
 *  It passed for months and certified a malformed message.
 *
 *  v2 pinned the builder byte-for-byte to Phantom's own reference SIWS serialiser.
 *  Correct — and still refused. Measured in a browser: Phantom rejects ANY field
 *  block following the SIWS prefix, while signing plain messages from the same
 *  wallet, in the same session. A test can only be as right as the spec it copies.
 *
 *  v3, here, asserts the property that actually decides whether the feature works:
 *  the message must NOT be SIWS-shaped, because an SIWS-shaped message is refused
 *  outright — no prompt, and no server-side trace to diagnose from.
 *
 * The lesson worth keeping: for a format another party consumes, assert the
 * property you need to hold, then prove the assertion fails when it is violated.
 */

const SITE = "https://app.bitxbit.com.au";
const WALLET = "DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5";
const PURPOSE = "Link this wallet to your bitxbit account.";

function validInput(overrides: Partial<Parameters<typeof buildWalletChallengeMessage>[0]> = {}) {
  return {
    site: SITE,
    walletAddress: WALLET,
    nonce: "test-nonce",
    issuedAt: "2026-10-16T10:00:00.000Z",
    expiresAt: "2026-10-16T10:05:00.000Z",
    purpose: PURPOSE,
    ...overrides,
  };
}

describe("wallet challenge message", () => {
  it("carries every value the server needs to bind and verify the signature", () => {
    const message = buildWalletChallengeMessage(validInput());

    assert.match(message, /^Site:\s+https:\/\/app\.bitxbit\.com\.au$/m);
    assert.match(message, new RegExp(`^Wallet:\\s+${WALLET}$`, "m"));
    assert.match(message, /^Nonce:\s+test-nonce$/m);
    assert.match(message, /^Issued:\s+2026-10-16T10:00:00\.000Z$/m);
    assert.match(message, /^Expires:\s+2026-10-16T10:05:00\.000Z$/m);
    assert.match(message, /^Purpose:\s+Link this wallet to your bitxbit account\.$/m);
  });

  it("is NOT SIWS-shaped — the property that makes Phantom work", () => {
    // The regression guard for the defect that took four diagnostics and seven
    // message variants to isolate. If this ever fails, every Phantom user loses
    // wallet auth silently: no prompt, no error, no audit row.
    const message = buildWalletChallengeMessage(validInput());
    assert.strictEqual(looksLikeSiws(message), false);
    assert.doesNotMatch(message, /wants you to sign in with your/i);
  });

  it("recognises the SIWS shapes Phantom actually refused, including the near-miss", () => {
    // Both of these failed in a real browser: the exact phrase, and a phrasing
    // whose domain ("bitXbit") did not match the page origin — which Phantom
    // reported by name, unlike the field-block refusals.
    assert.strictEqual(
      looksLikeSiws("app.bitxbit.com.au wants you to sign in with your Solana account:\nABC"),
      true
    );
    assert.strictEqual(
      looksLikeSiws("bitXbit wants you to sign in with your Solana account:\nABC"),
      true
    );
    assert.strictEqual(looksLikeSiws(buildWalletChallengeMessage(validInput())), false);
  });

  it("refuses to build an SIWS-shaped message out of a purpose string", () => {
    // A future "let's be spec-compliant again" change must fail loudly here rather
    // than silently in someone's browser.
    assert.throws(
      () =>
        buildWalletChallengeMessage(
          validInput({ purpose: "x wants you to sign in with your Solana account:" })
        ),
      /must not be SIWS-shaped/
    );
  });

  it("rejects missing required values rather than emitting a weak message", () => {
    assert.throws(() => buildWalletChallengeMessage(validInput({ site: "  " })), /site is required/);
    assert.throws(() => buildWalletChallengeMessage(validInput({ nonce: "" })), /nonce is required/);
    assert.throws(() => buildWalletChallengeMessage(validInput({ issuedAt: "" })), /issued-at is required/);
    assert.throws(() => buildWalletChallengeMessage(validInput({ purpose: "" })), /purpose is required/);
    assert.throws(
      () => buildWalletChallengeMessage(validInput({ walletAddress: "" })),
      /wallet address is required/
    );
  });

  it("lays the message out as a readable block, not a single line", () => {
    const lines = buildWalletChallengeMessage(validInput()).split("\n");
    assert.strictEqual(lines[0], "bitXbit wallet verification");
    assert.strictEqual(lines[1], "");
    // 2..6 are Site/Wallet/Nonce/Issued/Expires, so Purpose is index 7.
    assert.match(lines[7], /^Purpose:/);
    assert.strictEqual(lines[8], "");
    assert.match(lines[9], /Signing this proves you control this wallet/);
  });
});

describe("wallet signature verification", () => {
  it("verifies a valid Ed25519 signature over the challenge message", () => {
    const keypair = Keypair.generate();
    const walletAddress = keypair.publicKey.toBase58();
    const message = buildWalletChallengeMessage(validInput({ walletAddress }));

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
    const message = buildWalletChallengeMessage(validInput({ walletAddress }));

    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(message), attackerKeypair.secretKey);
    assert.strictEqual(
      verifyEd25519Signature(message, bs58.encode(signatureBytes), walletAddress),
      false
    );
  });

  it("rejects a signature over a different message (nonce binding)", () => {
    const keypair = Keypair.generate();
    const walletAddress = keypair.publicKey.toBase58();
    const signed = buildWalletChallengeMessage(validInput({ walletAddress, nonce: "nonce-a" }));
    const other = buildWalletChallengeMessage(validInput({ walletAddress, nonce: "nonce-b" }));

    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(signed), keypair.secretKey);
    assert.strictEqual(
      verifyEd25519Signature(other, bs58.encode(signatureBytes), walletAddress),
      false
    );
  });

  it("rejects a signature over a message minted for a different site", () => {
    // Domain binding now rests on the server-side nonce table rather than on the
    // wallet parsing the message — but the bytes must still differ, so a signature
    // cannot be lifted from a challenge minted for another origin.
    const keypair = Keypair.generate();
    const walletAddress = keypair.publicKey.toBase58();
    const signed = buildWalletChallengeMessage(validInput({ walletAddress, site: "https://app.bitxbit.com.au" }));
    const other = buildWalletChallengeMessage(validInput({ walletAddress, site: "https://evil.example" }));

    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(signed), keypair.secretKey);
    assert.strictEqual(
      verifyEd25519Signature(other, bs58.encode(signatureBytes), walletAddress),
      false
    );
  });
});
