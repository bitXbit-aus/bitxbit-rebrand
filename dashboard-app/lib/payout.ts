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

export interface ConfirmationResult {
  confirmed: boolean;
  slot?: number;
  err?: unknown;
  blockTime?: number;
  verificationError?: string;
}

function getConnection(): Connection {
  return new Connection(SOLANA_RPC, "confirmed");
}

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

export async function executePayoutTransfers(
  transfers: PayoutTransfer[]
): Promise<PayoutTransferResult[]> {
  const connection = getConnection();
  const signer = getSigner();
  const mint = new PublicKey(MINT!);
  const sourceAta = await getAssociatedTokenAddress(mint, signer.publicKey);

  const results: PayoutTransferResult[] = [];

  for (const transfer of transfers) {
    try {
      const recipient = new PublicKey(transfer.walletAddress);
      const destAta = await getAssociatedTokenAddress(mint, recipient);

      const transaction = new Transaction();

      try {
        await getAccount(connection, destAta);
      } catch {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            signer.publicKey,
            destAta,
            recipient,
            mint
          )
        );
      }

      transaction.add(
        createTransferInstruction(
          sourceAta,
          destAta,
          signer.publicKey,
          transfer.amountRaw
        )
      );

      const txHash = await sendAndConfirmTransaction(connection, transaction, [signer], {
        commitment: "confirmed",
      });

      results.push({
        operationId: transfer.operationId,
        walletAddress: transfer.walletAddress,
        amountRaw: transfer.amountRaw,
        txHash,
        error: null,
      });
    } catch (err) {
      results.push({
        operationId: transfer.operationId,
        walletAddress: transfer.walletAddress,
        amountRaw: transfer.amountRaw,
        txHash: null,
        error: err instanceof Error ? err.message : String(err),
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
  mintAddress: string = MINT!
): Promise<ConfirmationResult> {
  const connection = getConnection();

  try {
    const status = await connection.getSignatureStatus(txHash, { searchTransactionHistory: true });

    if (!status?.value) {
      return { confirmed: false, verificationError: "Transaction not found on-chain" };
    }

    if (status.value.err) {
      return {
        confirmed: false,
        err: status.value.err,
        verificationError: "Transaction failed on-chain",
      };
    }

    if (
      status.value.confirmationStatus !== "confirmed" &&
      status.value.confirmationStatus !== "finalized"
    ) {
      return { confirmed: false, verificationError: "Transaction not yet confirmed" };
    }

    // Parse the transaction to verify source, mint, recipient, and amount.
    const tx = await connection.getParsedTransaction(txHash, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { confirmed: false, verificationError: "Could not fetch transaction details" };
    }

    const match = await findMatchingTokenTransfer(
      tx,
      expectedSourceWalletAddress,
      expectedWalletAddress,
      expectedAmountRaw,
      mintAddress
    );

    if (!match.found) {
      return {
        confirmed: false,
        verificationError:
          match.error ||
          "Transaction does not contain the expected source/mint/recipient/amount/authority",
      };
    }

    return {
      confirmed: true,
      slot: status.value.slot,
      blockTime: tx.blockTime ?? undefined,
    };
  } catch (err) {
    return {
      confirmed: false,
      verificationError: err instanceof Error ? err.message : String(err),
    };
  }
}
