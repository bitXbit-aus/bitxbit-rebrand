"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import {
  requestWalletSignInChallenge,
  submitWalletSignIn,
  WALLET_SIGNIN_GENERIC_ERROR,
} from "@/lib/wallet-signin-client";

/**
 * Sign in with a Solana wallet (Phase 2 / B3).
 *
 * Two deliberate UX choices that are also correctness choices:
 *
 * - **Two steps, not one.** Clicking with no wallet connected opens the wallet
 *   modal; the user then clicks again to sign. Auto-continuing into a signature
 *   prompt the moment a wallet connects is a prompt the user did not ask for and
 *   cannot have read.
 * - **One message for every auth failure.** The server returns an identical error
 *   for an unknown wallet, a bad signature, an unverified wallet and a replayed
 *   nonce, precisely so this surface cannot be used to discover which wallets have
 *   accounts. The UI must not undo that, so it shows the same text for all of them.
 *   A user CANCELLING the signature prompt is a separate, non-security event and is
 *   reported as such.
 */

function shorten(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletSignInButton() {
  const { publicKey, connected, connecting, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }

    setBusy(true);
    try {
      const walletAddress = publicKey.toBase58();

      const challenge = await requestWalletSignInChallenge(walletAddress);
      if (!challenge) {
        toast({ title: "Sign-in unavailable", description: WALLET_SIGNIN_GENERIC_ERROR, variant: "destructive" });
        return;
      }

      if (!signMessage) {
        // Not all adapters expose message signing; without it this flow cannot work.
        toast({
          title: "Wallet can't sign messages",
          description: "Try a different wallet such as Phantom or Solflare.",
          variant: "destructive",
        });
        return;
      }

      let signature: string;
      try {
        const signatureBytes = await signMessage(new TextEncoder().encode(challenge.message));
        signature = bs58.encode(signatureBytes);
      } catch {
        // The user dismissed the wallet prompt. Not a security outcome.
        toast({ title: "Signature cancelled", description: "You can try again whenever you're ready." });
        return;
      }

      const result = await submitWalletSignIn({
        walletAddress,
        signature,
        nonce: challenge.nonce,
      });

      if (!result.ok) {
        toast({ title: "Sign-in failed", description: WALLET_SIGNIN_GENERIC_ERROR, variant: "destructive" });
        return;
      }

      // A cookie-based session was set by the verify route; navigate so the server
      // renders the authenticated page.
      window.location.href = result.redirectTo;
    } finally {
      setBusy(false);
    }
  };

  const label = connected && publicKey
    ? busy
      ? "Signing you in…"
      : `Sign in with ${shorten(publicKey.toBase58())}`
    : "Sign in with a Solana wallet";

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={handleClick}
      disabled={busy || connecting}
    >
      {label}
    </Button>
  );
}
