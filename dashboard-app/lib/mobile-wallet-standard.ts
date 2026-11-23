/**
 * Mobile Wallet Adapter (MWA) — Android browser wallet support.
 *
 * WHY THIS EXISTS
 * ---------------
 * `components/providers/wallet-provider.tsx` registers only browser-extension adapters
 * (Phantom, Solflare, Coinbase). On Android Chrome none of those can reach a connected
 * state, so the "Connect a wallet" modal offered entries that could never work — reported
 * by the owner as a modal that "fails to load options". The only working mobile path was
 * the wallet's own in-app browser.
 *
 * THE HELPER THAT MAKES IT CHEAP
 * ------------------------------
 * `@solana-mobile/wallet-standard-mobile` exposes `registerMwa`, which registers the
 * mobile wallet as a **Wallet Standard** wallet. `@solana/wallet-adapter-react`'s
 * `WalletProvider` already consumes Wallet Standard wallets, so registering one adds
 * mobile support with NO new entry in the adapter array and no new API surface.
 *
 * WHY NOT `@solana-mobile/wallet-adapter-mobile`
 * ----------------------------------------------
 * Measured 2026-11-23 by declaring each candidate and diffing the lock. The mobile
 * *adapter* package re-resolves the tree: **+133 packages, −266, 47 version changes**,
 * dragging `react-native`, `metro`, `babel` and `hermes-compiler` into the lock — its
 * `react-native >0.74` peer is not optional. The two packages declared for this route are
 * already resolved in the lock as transitive dependencies, so declaring them costs
 * exactly zero: entries 1140 → 1140, 0 added, 0 removed, 0 version changes, no
 * react-native. Same capability, none of the supply-chain blast radius.
 *
 * CSP
 * ---
 * The browser transport is a WebSocket to a reflector the wallet app runs on the same
 * device: `ws://localhost:<port>/solana-wallet` (the only localhost reference the browser
 * build contains — there is no fetch and no http://localhost). `connect-src` must allow
 * `ws://localhost:*` or the handshake is blocked at the browser with no server-side
 * trace. See lib/csp.ts and lib/csp-policy.test.ts.
 *
 * AN ENHANCEMENT, NEVER LOAD-BEARING
 * ----------------------------------
 * Registration failing must leave sign-in exactly as it was before this existed. Every
 * path here is guarded and swallows its own errors. This is the device-key gate's lesson:
 * an optional layer must be unable to block the flow it protects, and an enhancement that
 * cannot do its job must leave the flow working as though it were never added.
 */
import { SOLANA_MAINNET_CHAIN } from "@solana/wallet-standard-chains";

/**
 * Chains the mobile wallet is registered for. Mainnet-pinned, like the browser provider.
 *
 * Typed as the Wallet Standard `Identifier` shape (`${string}:${string}`) rather than
 * `string[]`: `registerMwa` takes an `IdentifierArray`, and a widened `string[]` is a
 * compile error, not a runtime one — so the type is what keeps this honest.
 */
export const MOBILE_WALLET_CHAINS: readonly `${string}:${string}`[] = [SOLANA_MAINNET_CHAIN];

/** Name shown by the wallet app when it asks the member to approve this site. */
export const MOBILE_WALLET_NAME = "bitXbit";

/** Icon shown in that prompt. A real asset: public/icons/icon-192x192.png (verified 192x192). */
export const MOBILE_WALLET_ICON_PATH = "/icons/icon-192x192.png";

/**
 * Is this a browser that can actually reach a wallet app over MWA?
 *
 * Android **Chrome** only, deliberately — and the narrower test is the vendor's, not a
 * guess. Solana Mobile's compatibility table:
 *
 *   Android - Chrome        ✅  (also works in Chrome PWAs)
 *   Android - Other browsers ❌  "Firefox, Opera, Brave, etc. do not support MWA"
 *   Android - WebViews      ❌  in-app browsers cannot launch the intent
 *   iOS - all browsers      ❌
 *   Desktop                 ❌  (remote/QR only)
 *
 * MWA's browser transport needs a wallet app on the SAME device, reachable over a
 * localhost reflector, and it launches it by navigating to `solana-wallet:/…`, which only
 * Android Chrome will act on. Offering the entry anywhere else is not a harmless extra: it
 * is the same dead-option defect this feature exists to remove — a member taps it, allows
 * the prompt, and nothing opens.
 *
 * A member in a supported browser with no wallet app installed is handled separately, by
 * the wallet-not-found handler passed to `registerMwa`.
 */
export function isMobileWalletAdapterEnvironment(userAgent: string | null | undefined): boolean {
  if (typeof userAgent !== "string") return false;
  if (!/android/i.test(userAgent)) return false;

  // In-app browsers (WebViews) report `; wv` or the WebView token, and can never launch an
  // Android intent. This is the environment a member is most likely to arrive in, because a
  // shared link opens inside whichever app shared it.
  if (/\bwv\b|WebView/i.test(userAgent)) return false;

  // Everything the vendor lists as unsupported. Samsung Internet and Brave are
  // Chromium-based but are named explicitly as non-supporting, so they are excluded too.
  if (
    /SamsungBrowser|OPR\/|Opera|Firefox|FxiOS|EdgA|Edg\/|Brave|YaBrowser|DuckDuckGo|MiuiBrowser|UCBrowser|Vivaldi/i.test(
      userAgent
    )
  ) {
    return false;
  }

  // Must actually be Chrome (or a Chrome PWA, which carries the same token).
  return /Chrome\/\d/.test(userAgent);
}

/**
 * The app identity the wallet app displays. Bound to the origin the member is actually
 * on, so a preview identifies itself as the preview rather than as production.
 */
export function mobileAppIdentity(origin: string): { name: string; uri: string; icon: string } {
  return {
    name: MOBILE_WALLET_NAME,
    uri: origin,
    icon: `${origin}${MOBILE_WALLET_ICON_PATH}`,
  };
}

let registered = false;

/** Test seam: clear the once-only guard so a suite can exercise registration paths. */
export function __resetMobileWalletRegistrationForTests(): void {
  registered = false;
}

/**
 * Register the mobile wallet, once, on a device that can use it.
 *
 * Returns whether registration actually happened. Never throws: a failure here means
 * "no mobile wallet offered", which is strictly better than a broken sign-in.
 */
export async function registerMobileWalletAdapter(): Promise<boolean> {
  if (registered) return false;
  if (typeof window === "undefined") return false;
  if (!isMobileWalletAdapterEnvironment(window.navigator?.userAgent)) return false;

  try {
    // Imported lazily so the module never enters a server graph and so a browser without
    // MWA never pays for it.
    const mwa = await import("@solana-mobile/wallet-standard-mobile");
    mwa.registerMwa({
      appIdentity: mobileAppIdentity(window.location.origin),
      authorizationCache: mwa.createDefaultAuthorizationCache(),
      chains: [...MOBILE_WALLET_CHAINS],
      chainSelector: mwa.createDefaultChainSelector(),
      // Called when no compatible wallet app is installed on the device.
      onWalletNotFound: mwa.createDefaultWalletNotFoundHandler(),
    });
    registered = true;
    return true;
  } catch (error) {
    // An observation, not a gate: fail soft. A member can still use the extension path or
    // the wallet's in-app browser exactly as before.
    console.warn("[wallet] mobile wallet adapter unavailable; continuing without it", error);
    return false;
  }
}
