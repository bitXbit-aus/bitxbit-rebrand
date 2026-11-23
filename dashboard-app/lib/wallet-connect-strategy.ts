/**
 * Which wallet step the sign-in button should take on a click.
 *
 * WHY THIS EXISTS (Android / Mobile Wallet Adapter)
 * -------------------------------------------------
 * Chrome on Android blocks a navigation that does not originate from a user gesture, and
 * MWA reaches the wallet app by navigating to a custom-scheme URL:
 *
 *     solana-wallet:/v1/associate/local?association=…&port=…&v=v1
 *
 * Solana Mobile document the failure explicitly: "MWA Intent navigation to a wallet app
 * will be blocked if it does not come from a user gesture. You will see an error like:
 * `Navigation is blocked: solana-wallet:/v1/associate...`"
 * (https://www.npmjs.com/package/@solana-mobile/wallet-adapter-mobile)
 *
 * The failure mode this avoids: letting the chooser's own select→connect dance perform the
 * launch, outside the gesture. Chrome blocks the intent navigation, the wallet ends up
 * SELECTED BUT NOT CONNECTED, and every later click finds `connected === false`, reopens
 * the chooser and re-enters the same dead branch — which presents to a member as
 * "I pick it, I allow it, and then nothing happens".
 *
 * So when MWA is the selected-but-unconnected wallet, the click connects it DIRECTLY.
 * That is the whole fix, and it is deliberately the only thing this module changes.
 *
 * WHY THERE IS NO "select MWA for you" STEP
 * -----------------------------------------
 * Solana Mobile's UX guidelines recommend selecting MWA as early as possible, and an
 * earlier version here followed that by diverting the first click straight to MWA. That was
 * wrong for this product: it silently removed Phantom, Solflare and Coinbase from Android,
 * because the wallet chooser never opened. The guideline assumes MWA is the only wallet
 * worth reaching; here the member chooses, so every provider stays on offer. The gesture
 * requirement is satisfied by connecting on the press AFTER the choice — one extra tap, and
 * nothing taken away.
 */

/**
 * The Wallet Standard wallet name MWA registers under.
 *
 * Held as a literal rather than imported so the client bundle does not eagerly pull the
 * mobile package in (it is loaded lazily only on Android — see lib/mobile-wallet-standard.ts).
 * `lib/wallet-connect-strategy.test.ts` asserts this equals the library's own exported
 * `SolanaMobileWalletAdapterWalletName`, so a rename upstream fails CI instead of
 * silently breaking the comparison.
 */
export const MOBILE_WALLET_ADAPTER_NAME = "Mobile Wallet Adapter";

/** The next thing a sign-in click should do. */
export type WalletConnectStep =
  /** Already connected with a usable key — proceed to the signature. */
  | "sign"
  /** MWA is the selected wallet but not connected — connect now, inside the click's gesture. */
  | "connect-mwa"
  /** Otherwise show the wallet chooser, so the member can pick any provider. */
  | "open-modal";

export function nextWalletConnectStep(input: {
  connected: boolean;
  hasSignableKey: boolean;
  selectedWalletName: string | null | undefined;
  mobileWalletName?: string;
}): WalletConnectStep {
  const mobileWalletName = input.mobileWalletName ?? MOBILE_WALLET_ADAPTER_NAME;

  if (input.connected && input.hasSignableKey) return "sign";
  if (input.selectedWalletName === mobileWalletName) return "connect-mwa";
  return "open-modal";
}
