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
 * Their UX guidelines therefore prescribe: "If it is not selected, but available, select
 * it as early as possible in your UI flow. This will also fix connection related issues
 * with Mobile Wallet Adapter." (https://docs.solanamobile.com/get-started/web/ux-guidelines)
 *
 * The failure mode this avoids: opening the selection MODAL, choosing MWA there, and
 * letting the modal's select→connect dance run outside the gesture. Chrome blocks the
 * intent navigation, the wallet ends up SELECTED BUT NOT CONNECTED, and every later click
 * finds `connected === false`, reopens the modal, and re-enters the same dead branch —
 * which presents to a member as "I pick it, I allow it, and then nothing happens".
 *
 * So: never route a click through the modal when MWA is the thing standing by. Selection
 * and connection are two presses, each carrying its own gesture.
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
  /** MWA is selected but not connected — connect now, inside the click's gesture. */
  | "connect-mwa"
  /** MWA is available but not selected — select it so the NEXT click can connect. */
  | "select-mwa"
  /** No mobile wallet standing by — show the wallet selection modal as before. */
  | "open-modal";

export function nextWalletConnectStep(input: {
  connected: boolean;
  hasSignableKey: boolean;
  selectedWalletName: string | null | undefined;
  mobileWalletAvailable: boolean;
  mobileWalletName?: string;
}): WalletConnectStep {
  const mobileWalletName = input.mobileWalletName ?? MOBILE_WALLET_ADAPTER_NAME;

  if (input.connected && input.hasSignableKey) return "sign";
  if (input.selectedWalletName === mobileWalletName) return "connect-mwa";
  if (input.mobileWalletAvailable) return "select-mwa";
  return "open-modal";
}
