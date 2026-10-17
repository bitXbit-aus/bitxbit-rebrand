import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  findMatchingTokenTransfer,
  amountToRaw,
  preparePayoutSubmission,
  broadcastPayoutSubmission,
  confirmPayoutSubmission,
} from "./payout";

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MINT = new PublicKey("DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5");

function randomWallet() {
  return Keypair.generate().publicKey;
}

async function makeParsedTx(opts: {
  programId: PublicKey | string;
  sourceWallet: PublicKey;
  destinationWallet: PublicKey;
  amount: string;
  authority: PublicKey;
  instructionType?: string;
  program?: string;
}) {
  const sourceAta = await getAssociatedTokenAddress(MINT, opts.sourceWallet);
  const destinationAta = await getAssociatedTokenAddress(MINT, opts.destinationWallet);

  return {
    transaction: {
      message: {
        instructions: [
          {
            program: opts.program ?? "spl-token",
            programId: opts.programId,
            parsed: {
              type: opts.instructionType ?? "transfer",
              info: {
                source: sourceAta.toBase58(),
                destination: destinationAta.toBase58(),
                amount: opts.amount,
                authority: opts.authority.toBase58(),
              },
            },
          },
        ],
      },
    },
  };
}

describe("findMatchingTokenTransfer", () => {
  it("accepts a valid parsed SPL-token transfer when programId is a PublicKey object", async () => {
    const sourceWallet = randomWallet();
    const destinationWallet = randomWallet();
    const authority = sourceWallet;
    const amountRaw = amountToRaw(1.25, 9);

    const tx = await makeParsedTx({
      programId: new PublicKey(SPL_TOKEN_PROGRAM),
      sourceWallet,
      destinationWallet,
      amount: amountRaw.toString(),
      authority,
    });

    const result = await findMatchingTokenTransfer(
      tx,
      sourceWallet.toBase58(),
      destinationWallet.toBase58(),
      amountRaw,
      MINT.toBase58()
    );

    assert.equal(result.found, true);
  });

  it("accepts a valid parsed SPL-token transfer when programId is a base58 string", async () => {
    const sourceWallet = randomWallet();
    const destinationWallet = randomWallet();
    const authority = sourceWallet;
    const amountRaw = amountToRaw(0.5, 9);

    const tx = await makeParsedTx({
      programId: SPL_TOKEN_PROGRAM,
      sourceWallet,
      destinationWallet,
      amount: amountRaw.toString(),
      authority,
    });

    const result = await findMatchingTokenTransfer(
      tx,
      sourceWallet.toBase58(),
      destinationWallet.toBase58(),
      amountRaw,
      MINT.toBase58()
    );

    assert.equal(result.found, true);
  });

  it("rejects a transfer from the wrong SPL-token program", async () => {
    const sourceWallet = randomWallet();
    const destinationWallet = randomWallet();

    const tx = await makeParsedTx({
      programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), // Token-2022
      sourceWallet,
      destinationWallet,
      amount: "1000000000",
      authority: sourceWallet,
    });

    const result = await findMatchingTokenTransfer(
      tx,
      sourceWallet.toBase58(),
      destinationWallet.toBase58(),
      1000000000n,
      MINT.toBase58()
    );

    assert.equal(result.found, false);
  });

  it("rejects a non-transfer instruction", async () => {
    const sourceWallet = randomWallet();
    const destinationWallet = randomWallet();

    const tx = await makeParsedTx({
      programId: new PublicKey(SPL_TOKEN_PROGRAM),
      sourceWallet,
      destinationWallet,
      amount: "1000000000",
      authority: sourceWallet,
      instructionType: "approve",
    });

    const result = await findMatchingTokenTransfer(
      tx,
      sourceWallet.toBase58(),
      destinationWallet.toBase58(),
      1000000000n,
      MINT.toBase58()
    );

    assert.equal(result.found, false);
  });

  it("rejects when the source ATA does not match", async () => {
    const sourceWallet = randomWallet();
    const destinationWallet = randomWallet();
    const otherWallet = randomWallet();
    const authority = sourceWallet;
    const amountRaw = amountToRaw(1, 9);

    const tx = await makeParsedTx({
      programId: new PublicKey(SPL_TOKEN_PROGRAM),
      sourceWallet,
      destinationWallet,
      amount: amountRaw.toString(),
      authority,
    });

    const result = await findMatchingTokenTransfer(
      tx,
      otherWallet.toBase58(), // expected source wallet does not match transaction
      destinationWallet.toBase58(),
      amountRaw,
      MINT.toBase58()
    );

    assert.equal(result.found, false);
  });

  it("rejects when the destination ATA does not match", async () => {
    const sourceWallet = randomWallet();
    const destinationWallet = randomWallet();
    const otherWallet = randomWallet();
    const authority = sourceWallet;
    const amountRaw = amountToRaw(1, 9);

    const tx = await makeParsedTx({
      programId: new PublicKey(SPL_TOKEN_PROGRAM),
      sourceWallet,
      destinationWallet,
      amount: amountRaw.toString(),
      authority,
    });

    const result = await findMatchingTokenTransfer(
      tx,
      sourceWallet.toBase58(),
      otherWallet.toBase58(), // expected destination wallet does not match transaction
      amountRaw,
      MINT.toBase58()
    );

    assert.equal(result.found, false);
  });

  it("rejects when the amount does not match", async () => {
    const sourceWallet = randomWallet();
    const destinationWallet = randomWallet();
    const authority = sourceWallet;

    const tx = await makeParsedTx({
      programId: new PublicKey(SPL_TOKEN_PROGRAM),
      sourceWallet,
      destinationWallet,
      amount: "1000000000",
      authority,
    });

    const result = await findMatchingTokenTransfer(
      tx,
      sourceWallet.toBase58(),
      destinationWallet.toBase58(),
      2000000000n, // different amount
      MINT.toBase58()
    );

    assert.equal(result.found, false);
  });

  it("rejects when the authority does not match the expected source wallet", async () => {
    const sourceWallet = randomWallet();
    const destinationWallet = randomWallet();
    const otherWallet = randomWallet();
    const amountRaw = amountToRaw(1, 9);

    const tx = await makeParsedTx({
      programId: new PublicKey(SPL_TOKEN_PROGRAM),
      sourceWallet,
      destinationWallet,
      amount: amountRaw.toString(),
      authority: otherWallet, // authority is not the source wallet
    });

    const result = await findMatchingTokenTransfer(
      tx,
      sourceWallet.toBase58(),
      destinationWallet.toBase58(),
      amountRaw,
      MINT.toBase58()
    );

    assert.equal(result.found, false);
  });

  it("rejects an empty transaction", async () => {
    const sourceWallet = randomWallet();
    const destinationWallet = randomWallet();

    const result = await findMatchingTokenTransfer(
      { transaction: { message: { instructions: [] } } },
      sourceWallet.toBase58(),
      destinationWallet.toBase58(),
      1000000000n,
      MINT.toBase58()
    );

    assert.equal(result.found, false);
  });
});

describe("payout submission lifecycle", () => {
  it("preparePayoutSubmission reports preparation errors instead of throwing", async () => {
    const wallet = randomWallet();
    const result = await preparePayoutSubmission({
      operationId: "op:1",
      walletAddress: wallet.toBase58(),
      amountRaw: 1000000000n,
    });

    assert.equal(result.txHash, null);
    assert.ok(result.preparationError, "expected a preparation error when signer is not configured");
  });

  it("broadcastPayoutSubmission returns a broadcast error when no signed transaction exists", async () => {
    const wallet = randomWallet();
    const result = await broadcastPayoutSubmission({
      operationId: "op:1",
      walletAddress: wallet.toBase58(),
      amountRaw: 1000000000n,
      txHash: null,
      signedTransactionBase58: null,
      lastBlockhash: null,
      lastValidBlockHeight: null,
      preparationError: "simulated preparation failure",
      broadcastError: null,
    });

    assert.ok(result.broadcastError, "expected a broadcast error");
    assert.equal(result.txHash, null);
  });

  it("confirmPayoutSubmission reports a non-uncertain failure when the transaction hash is missing", async () => {
    const wallet = randomWallet();
    const result = await confirmPayoutSubmission(
      {
        operationId: "op:1",
        walletAddress: wallet.toBase58(),
        amountRaw: 1000000000n,
        txHash: null,
        signedTransactionBase58: null,
        lastBlockhash: null,
        lastValidBlockHeight: null,
        preparationError: "missing hash",
        broadcastError: null,
      },
      wallet.toBase58()
    );

    assert.equal(result.confirmed, false);
    assert.equal(result.uncertain, false);
    assert.ok(result.verificationError);
    assert.equal(result.txHash, null);
  });
});
