"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  CoinbaseWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";

// Default styles for wallet adapter UI
import "@solana/wallet-adapter-react-ui/styles.css";

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const network = WalletAdapterNetwork.Mainnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new CoinbaseWalletAdapter()],
    []
  );

  const TypedConnectionProvider = ConnectionProvider as any;
  const TypedWalletProvider = WalletProvider as any;
  const TypedWalletModalProvider = WalletModalProvider as any;

  return (
    <TypedConnectionProvider endpoint={endpoint}>
      <TypedWalletProvider wallets={wallets} autoConnect>
        <TypedWalletModalProvider>{children}</TypedWalletModalProvider>
      </TypedWalletProvider>
    </TypedConnectionProvider>
  );
}
