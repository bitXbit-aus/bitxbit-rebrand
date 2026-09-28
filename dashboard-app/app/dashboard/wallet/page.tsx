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
import { saveWalletAddress, getTokenBalanceAction } from "@/lib/actions";
import { Coins, History, Wallet, AlertCircle } from "lucide-react";

interface RewardTx {
  id: string;
  bitxbit_amount: number | null;
  estimated_aud_value: number | null;
  distribution_tx_hash: string | null;
  distributed_at: string | null;
  period?: { start_date: string; end_date: string } | null;
}

export default function WalletPage() {
  const { connection } = useConnection();
  const { publicKey, connected, disconnect, wallet } = useWallet();
  const { toast } = useToast();

  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [transactions, setTransactions] = useState<RewardTx[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(true);

  useEffect(() => {
    if (connected && publicKey) {
      const address = publicKey.toBase58();
      saveWalletAddress(address)
        .then(() => {
          toast({
            title: "Wallet saved",
            description: `Connected ${truncateAddress(address)}`,
          });
        })
        .catch((error) => {
          toast({
            title: "Failed to save wallet",
            description: error instanceof Error ? error.message : "Unknown error",
            variant: "destructive",
          });
        });
    }
  }, [connected, publicKey, toast]);

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

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Wallet</h1>
        <p className="text-muted-foreground mt-1">
          Connect your Solana wallet to receive bitxbit rewards.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Wallet Connection</CardTitle>
            <CardDescription>
              Connect a Solana wallet to track your bitxbit tokens.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {connected && publicKey ? (
              <>
                <div className="p-4 rounded-lg bg-muted space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">Connected Address</p>
                    <Badge variant="outline">{wallet?.adapter.name}</Badge>
                  </div>
                  <SolanaAddress address={publicKey.toBase58()} />
                </div>
                <div className="p-4 rounded-lg bg-muted space-y-2">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-primary" />
                    <p className="text-sm text-muted-foreground">bitxbit Balance</p>
                  </div>
                  <p className="text-2xl font-bold">
                    {isLoadingBalance ? "Loading..." : tokenBalance?.toFixed(4) ?? "0.0000"}
                  </p>
                </div>
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
                      Coinbase Wallet.
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
