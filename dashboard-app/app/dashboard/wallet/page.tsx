"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/utils";
import { useState } from "react";

export default function WalletPage() {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  const connectWallet = async () => {
    // Placeholder for Solana wallet adapter integration
    setAddress("DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5");
    setConnected(true);
  };

  const disconnectWallet = () => {
    setAddress(null);
    setConnected(false);
  };

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Wallet</h1>
        <p className="text-muted-foreground mt-1">Connect your Solana wallet to view BxB balance and receive rewards.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Wallet Connection</CardTitle>
            <CardDescription>Connect a Solana wallet to track your BxB tokens.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {connected ? (
              <>
                <div className="p-4 rounded-lg bg-muted">
                  <p className="text-sm text-muted-foreground">Connected Address</p>
                  <p className="font-mono text-sm text-foreground">{truncateAddress(address)}</p>
                </div>
                <Button variant="outline" onClick={disconnectWallet}>Disconnect</Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">No wallet connected.</p>
                <Button onClick={connectWallet}>Connect Wallet</Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Token Information</CardTitle>
            <CardDescription>BxB token contract details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Token</span>
              <span className="font-medium">BxB (bitXbit)</span>
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
