import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import {
  getAirdropWalletBalances,
  amountToRaw,
  rawToAmount,
  executePayoutTransfers,
  confirmTokenTransfer,
  type PayoutTransfer,
  type PayoutTransferResult,
  type ConfirmationResult,
} from "@/lib/payout";

export type { PayoutTransfer, PayoutTransferResult, ConfirmationResult };
export { getAirdropWalletBalances, amountToRaw, rawToAmount, executePayoutTransfers, confirmTokenTransfer };

const MINT = process.env.BITXBIT_TOKEN_MINT;
const DECIMALS = parseInt(process.env.BITXBIT_TOKEN_DECIMALS || "9", 10);

export interface AirdropResult {
  userId: string;
  walletAddress: string;
  amount: number;
  txHash: string | null;
  error: string | null;
  rewardId?: string;
}

export async function getAirdropWalletBalance(): Promise<{ sol: number; token: number }> {
  const balances = await getAirdropWalletBalances();
  return { sol: balances.sol, token: balances.token };
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export async function getTokenBalance(walletAddress: string): Promise<number> {
  if (!isValidSolanaAddress(walletAddress)) {
    throw new Error("Invalid Solana wallet address");
  }

  const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed"
  );
  const mint = new PublicKey(MINT!);
  const owner = new PublicKey(walletAddress);
  const ata = await getAssociatedTokenAddress(mint, owner);

  try {
    const account = await getAccount(connection, ata);
    return rawToAmount(account.amount);
  } catch {
    return 0;
  }
}

/**
 * @deprecated Use executePayoutTransfers from @/lib/payout for new code.
 * Kept for compatibility; it does not provide idempotent operation tracking.
 */
export async function distributeTokens(
  distributions: { userId: string; walletAddress: string; amount: number; rewardId?: string }[]
): Promise<AirdropResult[]> {
  const transfers: PayoutTransfer[] = distributions.map((dist) => ({
    operationId: `legacy:${dist.rewardId ?? dist.userId}:${Date.now()}`,
    walletAddress: dist.walletAddress,
    amountRaw: amountToRaw(dist.amount, DECIMALS),
  }));

  const results = await executePayoutTransfers(transfers);

  return results.map((result, index) => ({
    userId: distributions[index].userId,
    walletAddress: result.walletAddress,
    amount: rawToAmount(result.amountRaw, DECIMALS),
    txHash: result.txHash,
    error: result.error,
    rewardId: distributions[index].rewardId,
  }));
}
