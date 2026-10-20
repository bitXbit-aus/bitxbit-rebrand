import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";

const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const MINT = process.env.BITXBIT_TOKEN_MINT;
const DECIMALS = parseInt(process.env.BITXBIT_TOKEN_DECIMALS || "9", 10);
const PRIVATE_KEY = process.env.AIRDROP_WALLET_PRIVATE_KEY;

export interface PayoutTransfer {
  operationId: string;
  walletAddress: string;
  amountRaw: bigint;
}

export interface PayoutTransferResult {
  operationId: string;
  walletAddress: string;
  amountRaw: bigint;
  txHash: string | null;
  error: string | null;
}

export interface PayoutSubmission {
  operationId: string;
  walletAddress: string;
  amountRaw: bigint;
  txHash: string | null;
  signedTransactionBase58: string | null;
  lastBlockhash: string | null;
  lastValidBlockHeight: number | null;
  /** Error during local preparation/signing. Broadcast may still be attempted. */
  preparationError: string | null;
  /** Error returned by the RPC when attempting to broadcast. The signed tx identity is still durable. */
  broadcastError: string | null;
}

export interface ConfirmationResult {
  confirmed: boolean;
  slot?: number;
  err?: unknown;
  blockTime?: number;
  verificationError?: string;
  /** true if the outcome is inconclusive and must not be treated as failure/ retryable */
  uncertain?: boolean;
  /** true if the transaction landed on-chain but does not match the expected transfer. Non-retryable incident. */
  incident?: boolean;
}

function getConnection(): Connection {
  return new Connection(process.env.SOLANA_RPC_URL || SOLANA_RPC, "confirmed");
}

export type PayoutBroadcastTransport = Pick<Connection, "sendRawTransaction">;
export type PayoutConfirmationTransport = Pick<
  Connection,
  "getSignatureStatus" | "getParsedTransaction"
>;

function getSigner(): Keypair {
  if (!PRIVATE_KEY) {
    throw new Error("AIRDROP_WALLET_PRIVATE_KEY is not configured");
  }
  const secretKey = bs58.decode(PRIVATE_KEY);
  return Keypair.fromSecretKey(secretKey);
}

export function getAirdropWalletAddress(): string {
  if (!PRIVATE_KEY) {
    throw new Error("AIRDROP_WALLET_PRIVATE_KEY is not configured");
  }
  const secretKey = bs58.decode(PRIVATE_KEY);
  const signer = Keypair.fromSecretKey(secretKey);
  return signer.publicKey.toBase58();
}

export function parseRawTokenAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error("Raw token amount must be a canonical non-negative decimal string");
  }
  return BigInt(value);
}

export function amountToRaw(amountDisplay: number, decimals = DECIMALS): bigint {
  return BigInt(Math.round(amountDisplay * Math.pow(10, decimals)));
}

export function rawToAmount(amountRaw: bigint, decimals = DECIMALS): number {
  return Number(amountRaw) / Math.pow(10, decimals);
}

export async function getAirdropWalletBalances(): Promise<{
  sol: number;
  token: number;
  tokenRaw: bigint;
}> {
  const connection = getConnection();
  const signer = getSigner();
  const mint = new PublicKey(MINT!);

  const solBalance = await connection.getBalance(signer.publicKey);
  const ata = await getAssociatedTokenAddress(mint, signer.publicKey);

  let tokenBalanceRaw = 0n;
  try {
    const account = await getAccount(connection, ata);
    tokenBalanceRaw = account.amount;
  } catch {
    tokenBalanceRaw = 0n;
  }

  return {
    sol: solBalance / LAMPORTS_PER_SOL,
    token: rawToAmount(tokenBalanceRaw),
    tokenRaw: tokenBalanceRaw,
  };
}

async function buildPayoutTransaction(
  transfer: PayoutTransfer,
  connection: Connection,
  signer: Keypair,
  mint: PublicKey,
  sourceAta: PublicKey
): Promise<Transaction> {
  const recipient = new PublicKey(transfer.walletAddress);
  const destAta = await getAssociatedTokenAddress(mint, recipient);

  const transaction = new Transaction();

  try {
    await getAccount(connection, destAta);
  } catch {
    transaction.add(
      createAssociatedTokenAccountInstruction(signer.publicKey, destAta, recipient, mint)
    );
  }

  transaction.add(
    createTransferInstruction(sourceAta, destAta, signer.publicKey, transfer.amountRaw)
  );

  return transaction;
}

function getTransactionSignature(transaction: Transaction): string | null {
  // A fully-signed single-signer transaction exposes the signature directly.
  if (transaction.signature) {
    return bs58.encode(transaction.signature);
  }
  // Multi-signer fallback: use the first signature that is present.
  for (const sig of transaction.signatures) {
    if (sig.signature) {
      return bs58.encode(sig.signature);
    }
  }
  return null;
}

export async function preparePayoutSubmission(
  transfer: PayoutTransfer
): Promise<PayoutSubmission> {
  try {
    const connection = getConnection();
    const signer = getSigner();
    const mint = new PublicKey(MINT!);
    const sourceAta = await getAssociatedTokenAddress(mint, signer.publicKey);

    const transaction = await buildPayoutTransaction(transfer, connection, signer, mint, sourceAta);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

    transaction.recentBlockhash = blockhash;
    transaction.feePayer = signer.publicKey;
    transaction.sign(signer);

    const txHash = getTransactionSignature(transaction);
    if (!txHash) {
      throw new Error("Could not derive transaction signature after signing");
    }

    const serialized = transaction.serialize({ requireAllSignatures: false });
    const signedTransactionBase58 = bs58.encode(serialized);

    return {
      operationId: transfer.operationId,
      walletAddress: transfer.walletAddress,
      amountRaw: transfer.amountRaw,
      txHash,
      signedTransactionBase58,
      lastBlockhash: blockhash,
      lastValidBlockHeight,
      preparationError: null,
      broadcastError: null,
    };
  } catch (err) {
    return {
      operationId: transfer.operationId,
      walletAddress: transfer.walletAddress,
      amountRaw: transfer.amountRaw,
      txHash: null,
      signedTransactionBase58: null,
      lastBlockhash: null,
      lastValidBlockHeight: null,
      preparationError: err instanceof Error ? err.message : String(err),
      broadcastError: null,
    };
  }
}

export async function broadcastPayoutSubmission(
  submission: PayoutSubmission,
  transport: PayoutBroadcastTransport = getConnection()
): Promise<PayoutSubmission> {
  if (!submission.signedTransactionBase58 || !submission.txHash) {
    return {
      ...submission,
      broadcastError: submission.preparationError ?? "Missing signed transaction",
    };
  }

  const rawTx = bs58.decode(submission.signedTransactionBase58);

  try {
    await transport.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
  } catch (err) {
    // A broadcast error does not prove the transaction never reached the chain.
    // The signed transaction identity is already durable; preserve it as uncertain.
    return {
      ...submission,
      broadcastError: err instanceof Error ? err.message : String(err),
    };
  }

  return { ...submission, broadcastError: null };
}

export async function confirmPayoutSubmission(
  submission: PayoutSubmission,
  expectedSourceWalletAddress: string,
  timeoutMs = 60000,
  pollIntervalMs = 2000,
  transport: PayoutConfirmationTransport = getConnection()
): Promise<ConfirmationResult & { txHash: string | null }> {
  if (!submission.txHash) {
    return {
      confirmed: false,
      uncertain: false,
      verificationError: submission.preparationError ?? "Missing transaction hash",
      txHash: null,
    };
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await transport.getSignatureStatus(submission.txHash, {
      searchTransactionHistory: true,
    });

    if (status?.value) {
      if (status.value.err) {
        return {
          confirmed: false,
          uncertain: false,
          err: status.value.err,
          verificationError: "Transaction failed on-chain",
          txHash: submission.txHash,
        };
      }

      if (
        status.value.confirmationStatus === "confirmed" ||
        status.value.confirmationStatus === "finalized"
      ) {
        const confirmation = await confirmTokenTransfer(
          submission.txHash,
          expectedSourceWalletAddress,
          submission.walletAddress,
          submission.amountRaw,
          MINT!,
          transport
        );
        return { ...confirmation, txHash: submission.txHash };
      }

      // Status exists but not yet confirmed/finalized; keep polling.
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Polling window expired without a definitive on-chain outcome.
  // Do not treat this as failure; it is uncertain and requires later reconciliation.
  return {
    confirmed: false,
    uncertain: true,
    verificationError: "Transaction submission outcome unknown within polling window",
    txHash: submission.txHash,
  };
}

export async function executePayoutTransfers(
  transfers: PayoutTransfer[]
): Promise<PayoutTransferResult[]> {
  // Legacy convenience path: prepare, broadcast, and confirm each transfer.
  // New airdrop code should use preparePayoutSubmission -> persist -> broadcast
  // so the signed transaction identity is durable before broadcast.
  const results: PayoutTransferResult[] = [];

  for (const transfer of transfers) {
    const prepared = await preparePayoutSubmission(transfer);
    if (prepared.preparationError || !prepared.txHash) {
      results.push({
        operationId: transfer.operationId,
        walletAddress: transfer.walletAddress,
        amountRaw: transfer.amountRaw,
        txHash: null,
        error: prepared.preparationError ?? "Preparation failed",
      });
      continue;
    }

    const broadcasted = await broadcastPayoutSubmission(prepared);
    if (broadcasted.broadcastError) {
      // Even though broadcast failed, we have a durable tx hash. Surface it as
      // an error to legacy callers while preserving the hash for investigation.
      results.push({
        operationId: transfer.operationId,
        walletAddress: transfer.walletAddress,
        amountRaw: transfer.amountRaw,
        txHash: broadcasted.txHash,
        error: `Broadcast error (tx identity preserved): ${broadcasted.broadcastError}`,
      });
      continue;
    }

    const sourceWalletAddress = getAirdropWalletAddress();
    const confirmation = await confirmPayoutSubmission(broadcasted, sourceWalletAddress);
    if (confirmation.confirmed) {
      results.push({
        operationId: transfer.operationId,
        walletAddress: transfer.walletAddress,
        amountRaw: transfer.amountRaw,
        txHash: confirmation.txHash,
        error: null,
      });
    } else if (confirmation.uncertain) {
      results.push({
        operationId: transfer.operationId,
        walletAddress: transfer.walletAddress,
        amountRaw: transfer.amountRaw,
        txHash: confirmation.txHash,
        error: `Uncertain outcome: ${confirmation.verificationError}`,
      });
    } else {
      results.push({
        operationId: transfer.operationId,
        walletAddress: transfer.walletAddress,
        amountRaw: transfer.amountRaw,
        txHash: confirmation.txHash,
        error: confirmation.verificationError ?? "On-chain confirmation failed",
      });
    }
  }

  return results;
}

export interface TokenTransferMatch {
  found: boolean;
  error?: string;
}

export async function findMatchingTokenTransfer(
  tx: any,
  expectedSourceWalletAddress: string,
  expectedWalletAddress: string,
  expectedAmountRaw: bigint,
  mintAddress: string = MINT!
): Promise<TokenTransferMatch> {
  const mintPublicKey = new PublicKey(mintAddress);
  const expectedSourceAta = await getAssociatedTokenAddress(
    mintPublicKey,
    new PublicKey(expectedSourceWalletAddress)
  );
  const expectedRecipientAta = await getAssociatedTokenAddress(
    mintPublicKey,
    new PublicKey(expectedWalletAddress)
  );

  const instructions = tx?.transaction?.message?.instructions ?? [];

  for (const instruction of instructions) {
    const parsed = (instruction as any).parsed;
    const program = (instruction as any).program;
    const programId = (instruction as any).programId;

    // Defensive: require the SPL Token program.
    if (program !== "spl-token") continue;

    // programId may be a Solana PublicKey object or a base58 string.
    const programIdBase58 =
      programId && typeof programId === "object" && "toBase58" in programId
        ? (programId as PublicKey).toBase58()
        : programId;
    if (
      programIdBase58 &&
      programIdBase58 !== "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    ) {
      continue;
    }

    if (parsed?.type !== "transfer") continue;

    const info = parsed.info;
    if (!info) continue;

    const source = info.source;
    const destination = info.destination;
    const amount = info.amount;
    const authority = info.authority;

    // Verify the complete transfer graph: source ATA, destination ATA,
    // token authority, and exact raw amount all match the expected payout.
    if (
      source === expectedSourceAta.toBase58() &&
      destination === expectedRecipientAta.toBase58() &&
      BigInt(amount) === expectedAmountRaw &&
      authority === expectedSourceWalletAddress
    ) {
      return { found: true };
    }
  }

  return { found: false };
}

export async function confirmTokenTransfer(
  txHash: string,
  expectedSourceWalletAddress: string,
  expectedWalletAddress: string,
  expectedAmountRaw: bigint,
  mintAddress: string = MINT!,
  transport: PayoutConfirmationTransport = getConnection()
): Promise<ConfirmationResult> {
  try {
    const status = await transport.getSignatureStatus(txHash, { searchTransactionHistory: true });

    if (!status?.value) {
      // A missing signature status is not proof of non-execution. RPC nodes can
      // lag, drop lookups, or the transaction may still land. Treat as uncertain.
      return {
        confirmed: false,
        uncertain: true,
        verificationError: "Transaction not found on-chain",
      };
    }

    if (status.value.err) {
      return {
        confirmed: false,
        uncertain: false,
        err: status.value.err,
        verificationError: "Transaction failed on-chain",
      };
    }

    if (
      status.value.confirmationStatus !== "confirmed" &&
      status.value.confirmationStatus !== "finalized"
    ) {
      return {
        confirmed: false,
        uncertain: true,
        verificationError: "Transaction not yet confirmed",
      };
    }

    // Parse the transaction to verify source, mint, recipient, and amount.
    const tx = await transport.getParsedTransaction(txHash, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      // The signature status says confirmed/finalized but the parsed transaction
      // could not be retrieved. This is usually transient RPC unavailability.
      return {
        confirmed: false,
        uncertain: true,
        verificationError: "Could not fetch transaction details",
      };
    }

    const match = await findMatchingTokenTransfer(
      tx,
      expectedSourceWalletAddress,
      expectedWalletAddress,
      expectedAmountRaw,
      mintAddress
    );

    if (!match.found) {
      // The transaction is on-chain and parsed, but it does not contain the
      // expected transfer. This is a verified mismatch: it may represent a real
      // transfer to an unexpected destination and must not be retried
      // automatically. Treat it as an incident requiring investigation.
      return {
        confirmed: false,
        uncertain: false,
        incident: true,
        verificationError:
          match.error ||
          "Transaction landed on-chain but does not match the expected source/mint/recipient/amount/authority",
      };
    }

    return {
      confirmed: true,
      slot: status.value.slot,
      blockTime: tx.blockTime ?? undefined,
    };
  } catch (err) {
    // RPC or parsing exceptions are not proof of non-execution.
    return {
      confirmed: false,
      uncertain: true,
      verificationError: err instanceof Error ? err.message : String(err),
    };
  }
}
