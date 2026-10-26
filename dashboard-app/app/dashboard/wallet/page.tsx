"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SolanaAddress } from "@/components/dashboard/solana-address";
import { useToast } from "@/components/ui/use-toast";
import { truncateAddress, formatDate, formatCurrency } from "@/lib/utils";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  requestWalletVerificationChallenge,
  verifyWalletSignature,
  getWalletVerificationStatus,
} from "@/lib/wallet-verification";
import { getTokenBalanceAction, unlinkWallet } from "@/lib/actions";
import bs58 from "bs58";
import { Coins, History, Wallet, AlertCircle, Shield, ShieldAlert } from "lucide-react";

interface RewardTx {
  id: string;
  bitxbit_amount: number | null;
  estimated_aud_value: number | null;
  distribution_tx_hash: string | null;
  distributed_at: string | null;
  period?: { start_date: string; end_date: string } | null;
}

interface SavedWalletState {
  address: string | null;
  verified: boolean;
  verifiedAt: string | null;
}

export default function WalletPage() {
  const { publicKey, connected, disconnect, wallet, signMessage } = useWallet();
  const { toast } = useToast();

  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [transactions, setTransactions] = useState<RewardTx[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(true);
  const [savedWallet, setSavedWallet] = useState<SavedWalletState | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const connectedAddress = publicKey?.toBase58() ?? null;
  const walletName = wallet?.adapter.name ?? "Wallet";

  async function loadSavedWallet() {
    setIsLoadingStatus(true);
    try {
      const status = await getWalletVerificationStatus();
      setSavedWallet({
        address: status.walletAddress,
        verified: status.verified,
        verifiedAt: status.verifiedAt,
      });
    } catch (error) {
      console.error("Failed to load wallet status:", error);
    } finally {
      setIsLoadingStatus(false);
    }
  }

  useEffect(() => {
    loadSavedWallet();
  }, []);

  useEffect(() => {
    // Connecting a wallet changes NO persisted state. verifyWalletSignature() is
    // the only path that writes wallet_address and wallet_verified, and
    // getWalletVerificationStatus() - called by loadSavedWallet - is the source
    // of truth for what is stored.
    //
    // This effect used to call the address-save action on every connect. That
    // action could only ever "succeed" by no-op'ing (re-saving an address equal
    // to the already-verified one), so on a normal connect it threw instead -
    // and it wrote a `success: false` audit row BEFORE throwing, with empty
    // metadata. Four ordinary connects logged four fabricated security
    // failures, indistinguishable from real ones. Re-reading the status gives
    // the same UI result without any write.
    if (!connectedAddress) return;
    loadSavedWallet();
  }, [connectedAddress]);

  useEffect(() => {
    async function loadBalance() {
      if (!publicKey) {
        setTokenBalance(null);
        return;
      }
      setIsLoadingBalance(true);
      try {
        const balance = await getTokenBalanceAction(publicKey.toBase58());
        setTokenBalance(balance);
      } catch (error) {
        console.error("Failed to load token balance:", error);
        setTokenBalance(null);
      } finally {
        setIsLoadingBalance(false);
      }
    }

    loadBalance();
  }, [publicKey]);

  useEffect(() => {
    async function loadTransactions() {
      setIsLoadingTx(true);
      try {
        const res = await fetch("/api/wallet/rewards");
        if (res.ok) {
          const data = await res.json();
          setTransactions(data.rewards ?? []);
        }
      } catch (error) {
        console.error("Failed to load reward transactions:", error);
      } finally {
        setIsLoadingTx(false);
      }
    }

    loadTransactions();
  }, []);

  async function handleVerifyOwnership() {
    if (!connectedAddress || !signMessage) {
      toast({
        title: "Cannot verify",
        description: "Please connect a wallet that supports message signing.",
        variant: "destructive",
      });
      return;
    }

    setIsVerifying(true);
    try {
      const challenge = await requestWalletVerificationChallenge(connectedAddress);
      const messageBytes = new TextEncoder().encode(challenge.message);
      const signatureBytes = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signatureBytes);

      await verifyWalletSignature(connectedAddress, signatureBase58, challenge.nonce);
      await loadSavedWallet();

      toast({
        title: "Wallet verified",
        description: `${truncateAddress(connectedAddress)} is now your verified payout address.`,
      });
    } catch (error) {
      toast({
        title: "Verification failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleUnlink() {
    if (!savedWallet?.address) return;

    // The confirmation states what actually changes. It is NOT a vague "are you
    // sure": unlinking cannot lock anyone out (email sign-in always remains) and
    // cannot strand money (payout_operations snapshots its own address at claim
    // time), so saying so is more useful than a generic warning.
    const confirmed = window.confirm(
      "Unlink this wallet?\n\n" +
        savedWallet.address +
        "\n\nYou will no longer be able to sign in with this wallet. " +
        "Email sign-in still works, and you can verify this or another wallet again at any time."
    );
    if (!confirmed) return;

    setIsUnlinking(true);
    try {
      const result = await unlinkWallet();
      await loadSavedWallet();
      toast({
        title: result.unlinked ? "Wallet unlinked" : "No wallet was linked",
        description: result.unlinked
          ? "That wallet can no longer sign in to this account."
          : undefined,
      });
    } catch (error) {
      toast({
        title: "Could not unlink wallet",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUnlinking(false);
    }
  }

  const isConnectedSaved =
    !!connectedAddress &&
    !!savedWallet?.address &&
    savedWallet.address.toLowerCase() === connectedAddress.toLowerCase();

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Wallet</h1>
        <p className="text-muted-foreground mt-1">
          Connect and verify your Solana wallet to receive bitxbit rewards.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Wallet Connection</CardTitle>
            <CardDescription>
              Connect a Solana wallet, then verify ownership to set it as your payout address.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {connected && publicKey ? (
              <>
                <div className="p-4 rounded-lg bg-muted space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">Connected Address</p>
                    <Badge variant="outline">{walletName}</Badge>
                  </div>
                  <SolanaAddress address={publicKey.toBase58()} />
                </div>

                {!isLoadingStatus && savedWallet?.address && (
                  <div className="p-4 rounded-lg bg-muted space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">Saved Payout Address</p>
                      {savedWallet.verified ? (
                        <Badge variant="default" className="gap-1">
                          <Shield className="h-3 w-3" /> Verified
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <ShieldAlert className="h-3 w-3" /> Unverified
                        </Badge>
                      )}
                    </div>
                    <SolanaAddress address={savedWallet.address} />
                    {savedWallet.verified && savedWallet.verifiedAt && (
                      <p className="text-xs text-muted-foreground">
                        Verified {formatDate(savedWallet.verifiedAt)}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <p className="text-xs text-muted-foreground">
                        {savedWallet.verified
                          ? "Unlinking stops wallet sign-in for this account."
                          : "Not verified, so it cannot sign in."}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleUnlink}
                        disabled={isUnlinking}
                      >
                        {isUnlinking ? "Unlinking…" : "Unlink"}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="p-4 rounded-lg bg-muted space-y-2">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-primary" />
                    <p className="text-sm text-muted-foreground">bitxbit Balance</p>
                  </div>
                  <p className="text-2xl font-bold">
                    {isLoadingBalance ? "Loading..." : tokenBalance?.toFixed(4) ?? "0.0000"}
                  </p>
                </div>

                {isConnectedSaved && savedWallet?.verified ? (
                  <div className="text-sm text-emerald-400 flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    This wallet is verified and set as your payout address.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm text-amber-400 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        {savedWallet?.address
                          ? "The connected wallet does not match your saved payout address. Verify ownership to update it."
                          : "Wallet connection is not proof of ownership. Verify ownership to set this as your payout address."}
                      </span>
                    </div>
                    <Button
                      onClick={handleVerifyOwnership}
                      disabled={isVerifying || !signMessage}
                      className="w-full sm:w-auto"
                    >
                      {isVerifying ? "Verifying..." : "Verify Ownership"}
                    </Button>
                  </div>
                )}

                <Button variant="outline" onClick={disconnect}>
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                <div className="p-4 rounded-lg bg-muted/50 border border-dashed border-border">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-sm text-muted-foreground">
                      No wallet connected. Use the button below to connect Phantom, Solflare, or
                      Coinbase Wallet. You will then be asked to sign a short message proving you
                      control the wallet.
                    </p>
                  </div>
                </div>
                <WalletMultiButton className="!bg-primary !text-primary-foreground hover:!bg-primary/90" />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Token Information</CardTitle>
            <CardDescription>bitxbit token contract details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Token</span>
              <span className="font-medium">bitxbit</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Network</span>
              <span className="font-medium">Solana</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Contract</span>
              <SolanaAddress address="DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5" showCopy />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Max Supply</span>
              <span className="font-medium">1,000,000</span>
            </div>
            <a
              href="https://solscan.io/token/DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-sm text-primary hover:underline pt-2"
            >
              View on Solscan →
            </a>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <CardTitle>Reward Distributions</CardTitle>
          </div>
          <CardDescription>On-chain distributions sent to your wallet.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingTx ? (
            <p className="text-sm text-muted-foreground">Loading transactions...</p>
          ) : transactions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>bitxbit</th>
                    <th>Estimated AUD</th>
                    <th>Date</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td>
                        {tx.period
                          ? `${formatDate(tx.period.start_date)} – ${formatDate(tx.period.end_date)}`
                          : "—"}
                      </td>
                      <td>{tx.bitxbit_amount?.toFixed(4) ?? "—"}</td>
                      <td>{formatCurrency(tx.estimated_aud_value)}</td>
                      <td>{tx.distributed_at ? formatDate(tx.distributed_at) : "—"}</td>
                      <td>
                        {tx.distribution_tx_hash ? (
                          <SolanaAddress address={tx.distribution_tx_hash} showCopy={false} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8">
              <Wallet className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-sm font-medium mb-1">No distributions yet</h3>
              <p className="text-xs text-muted-foreground">
                Once rewards are approved and airdropped, they&apos;ll appear here.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
