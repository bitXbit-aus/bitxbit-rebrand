"use client";

import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/utils";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { toast } from "@/components/ui/use-toast";
import { saveWalletAddress } from "@/lib/actions";

export default function WalletPage() {
  const { connection } = useConnection();
  const { publicKey, connected, disconnect, wallet } = useWallet();

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
  }, [connected, publicKey]);

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
                <div className="p-4 rounded-lg bg-muted space-y-2">
                  <p className="text-sm text-muted-foreground">Connected Address</p>
                  <p className="font-mono text-sm text-foreground break-all">
                    {publicKey.toBase58()}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Wallet: {wallet?.adapter.name}
                  </p>
                </div>
                <Button variant="outline" onClick={disconnect}>
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  No wallet connected. Use the button below to connect Phantom, Solflare, or
                  Coinbase Wallet.
                </p>
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
              <span className="font-mono text-xs">DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5</span>
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
    </div>
  );
}
