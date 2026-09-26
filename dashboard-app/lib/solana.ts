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

export interface AirdropResult {
  userId: string;
  walletAddress: string;
  amount: number;
  txHash: string | null;
  error: string | null;
}

function getConnection() {
  return new Connection(SOLANA_RPC, "confirmed");
}

function getSigner(): Keypair {
  if (!PRIVATE_KEY) {
    throw new Error("AIRDROP_WALLET_PRIVATE_KEY is not configured");
  }
  const secretKey = bs58.decode(PRIVATE_KEY);
  return Keypair.fromSecretKey(secretKey);
}

export async function getAirdropWalletBalance(): Promise<{ sol: number; token: number }> {
  const connection = getConnection();
  const signer = getSigner();
  const mint = new PublicKey(MINT!);

  const solBalance = await connection.getBalance(signer.publicKey);
  const ata = await getAssociatedTokenAddress(mint, signer.publicKey);

  let tokenBalance = 0;
  try {
    const account = await getAccount(connection, ata);
    tokenBalance = Number(account.amount) / Math.pow(10, DECIMALS);
  } catch {
    tokenBalance = 0;
  }

  return {
    sol: solBalance / LAMPORTS_PER_SOL,
    token: tokenBalance,
  };
}

export async function distributeTokens(
  distributions: { userId: string; walletAddress: string; amount: number }[]
): Promise<AirdropResult[]> {
  const connection = getConnection();
  const signer = getSigner();
  const mint = new PublicKey(MINT!);
  const sourceAta = await getAssociatedTokenAddress(mint, signer.publicKey);

  const results: AirdropResult[] = [];

  for (const dist of distributions) {
    try {
      const recipient = new PublicKey(dist.walletAddress);
      const destAta = await getAssociatedTokenAddress(mint, recipient);

      const transaction = new Transaction();

      // Create recipient ATA if it doesn't exist
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

      const tokenAmount = BigInt(Math.round(dist.amount * Math.pow(10, DECIMALS)));

      transaction.add(
        createTransferInstruction(
          sourceAta,
          destAta,
          signer.publicKey,
          tokenAmount
        )
      );

      const txHash = await sendAndConfirmTransaction(connection, transaction, [signer], {
        commitment: "confirmed",
      });

      results.push({
        userId: dist.userId,
        walletAddress: dist.walletAddress,
        amount: dist.amount,
        txHash,
        error: null,
      });
    } catch (err) {
      results.push({
        userId: dist.userId,
        walletAddress: dist.walletAddress,
        amount: dist.amount,
        txHash: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
