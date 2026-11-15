"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { toSignatureBytes } from "@/lib/wallet-signature-format";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import {
  requestWalletSignInChallenge,
  submitWalletSignIn,
  submitWalletStepUp,
  WALLET_SIGNIN_GENERIC_ERROR,
} from "@/lib/wallet-signin-client";

/**
 * Sign in with a Solana wallet (Phase 2 / B3), including the new-device step-up.
 *
 * Three deliberate UX choices that are also correctness choices:
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
 * - **A step-up is not an error, and its copy must not read like one.** R-021
 *   prevention: an unrecognised device must enter a code sent to the account email.
 *   The form says *why* it appeared and never asks the member to "verify your
 *   wallet" — that phrasing is the phishing pattern this control exists to defeat,
 *   and a real control must not teach the wording the attack uses.
 */

function shorten(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletSignInButton() {
  const { publicKey, connected, connecting, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const [busy, setBusy] = useState(false);
  const [stepUp, setStepUp] = useState<{ stepUpId: string; emailHint: string } | null>(null);
  const [code, setCode] = useState("");

  const finish = (redirectTo: string) => {
    // A cookie-based session was set by the route; navigate so the server renders the
    // authenticated page.
    window.location.href = redirectTo;
  };

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

      let signed: unknown;
      try {
        signed = await signMessage(new TextEncoder().encode(challenge.message));
      } catch {
        // The wallet prompt was dismissed, or the wallet refused. Not a security
        // outcome, and nothing reached the server.
        toast({
          title: "Signature cancelled",
          description: "You can try again whenever you're ready.",
        });
        return;
      }

      let signature: string;
      try {
        signature = bs58.encode(toSignatureBytes(signed));
      } catch {
        // DISTINCT from a cancellation, and previously misreported as one. If the
        // wallet returned an unreadable shape, telling the user "you dismissed the
        // prompt" sends them — and anyone debugging — after the wrong cause.
        toast({
          title: "Unsupported wallet response",
          description:
            "This wallet returned a signature bitxbit could not read. Please try Solflare, or update the wallet extension.",
          variant: "destructive",
        });
        return;
      }

      const result = await submitWalletSignIn({
        walletAddress,
        signature,
        nonce: challenge.nonce,
      });

      // Checked BEFORE the failure branch. The signature verified and the account was
      // resolved — telling the member "sign-in failed" here would be false, and would
      // send them looking for a wallet problem they do not have.
      if (!result.ok && "stepUpRequired" in result) {
        setStepUp({ stepUpId: result.stepUpId, emailHint: result.emailHint });
        setCode("");
        return;
      }

      if (!result.ok) {
        // Prefer the server's guidance when it gave one (wallet not linked / not
        // verified — both only reachable after a valid signature). Otherwise stay
        // generic, exactly as the server does for the cases that prove nothing.
        toast({
          title: "Sign-in failed",
          description: result.error ?? WALLET_SIGNIN_GENERIC_ERROR,
          variant: "destructive",
        });
        return;
      }

      finish(result.redirectTo);
    } finally {
      setBusy(false);
    }
  };

  const handleStepUp = async () => {
    if (!stepUp || !/^\d{6}$/.test(code)) {
      toast({ title: "Enter the 6-digit code", description: "Check the email we just sent." });
      return;
    }

    setBusy(true);
    try {
      const result = await submitWalletStepUp({ stepUpId: stepUp.stepUpId, code });
      if (!result.ok) {
        // The server sends one message for a wrong, expired, exhausted or unknown
        // code, and this surface must not invent a more specific one.
        toast({
          title: "That code didn't work",
          description: result.error ?? "Request a new code and try again.",
          variant: "destructive",
        });
        return;
      }
      finish(result.redirectTo);
    } finally {
      setBusy(false);
    }
  };

  if (stepUp) {
    return (
      <div className="w-full rounded-md border border-border p-3 text-left">
        <p className="text-sm font-medium">Check your email</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This browser hasn&apos;t signed in to your account before, so we sent a 6-digit code to{" "}
          {stepUp.emailHint || "your account email"}. Enter it here to finish signing in.
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          aria-label="Sign-in code"
          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-center text-lg tracking-widest"
        />
        <div className="mt-2 flex gap-2">
          <Button type="button" className="flex-1" onClick={handleStepUp} disabled={busy}>
            {busy ? "Checking…" : "Finish sign-in"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setStepUp(null);
              setCode("");
            }}
            disabled={busy}
          >
            Start over
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Only enter a code you requested. bitXbit will never ask you to share it.
        </p>
      </div>
    );
  }

  const label = connected && publicKey
    ? busy
      ? "Signing you in…"
      : `Sign in with ${shorten(publicKey.toBase58())}`
    : "Sign in with your linked wallet";

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
