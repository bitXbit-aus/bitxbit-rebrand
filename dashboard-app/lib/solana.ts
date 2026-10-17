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
  getAirdropWalletAddress,
  type PayoutTransfer,
  type PayoutTransferResult,
  type ConfirmationResult,
} from "@/lib/payout";

export type { PayoutTransfer, PayoutTransferResult, ConfirmationResult };
export {
  getAirdropWalletBalances,
  amountToRaw,
  rawToAmount,
  executePayoutTransfers,
  confirmTokenTransfer,
  getAirdropWalletAddress,
};

const MINT = process.env.BITXBIT_TOKEN_MINT;
const DECIMALS = parseInt(process.env.BITXBIT_TOKEN_DECIMALS || "9", 10);

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
