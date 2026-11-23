import assert from "node:assert/strict";
import test from "node:test";

import { SolanaMobileWalletAdapterWalletName } from "@solana-mobile/wallet-standard-mobile";

import {
  MOBILE_WALLET_ADAPTER_NAME,
  nextWalletConnectStep,
} from "./wallet-connect-strategy";

// Background, because these assertions look arbitrary without it.
//
// Chrome on Android blocks a navigation that does not come from a user gesture, and MWA
// reaches the wallet app by navigating to `solana-wallet:/v1/associate/local?...`. Solana
// Mobile document the resulting error verbatim ("Navigation is blocked:
// solana-wallet:/v1/associate...").
//
// The bug this encodes: letting the chooser's own select→connect perform the launch leaves
// the wallet SELECTED BUT NOT CONNECTED, because that runs outside the gesture. Every
// subsequent click then sees `connected === false` and reopens the chooser — an inescapable
// loop that presents as "I pick it, I allow it, nothing happens".
//
// The fix is ONE behaviour: when MWA is the selected-but-unconnected wallet, connect it
// directly from the click. Nothing else about the flow changes — in particular the chooser
// must still open, or Phantom, Solflare and Coinbase vanish from Android.

const MWA = MOBILE_WALLET_ADAPTER_NAME;

test("the adapter name is the library's own, not a guess", () => {
  assert.equal(
    MOBILE_WALLET_ADAPTER_NAME,
    SolanaMobileWalletAdapterWalletName,
    "the name we compare against must come from the library; a rename upstream would make " +
      "every comparison below silently false and put us back in the chooser loop"
  );
});

test("a connected wallet with a key signs", () => {
  assert.equal(
    nextWalletConnectStep({
      connected: true,
      hasSignableKey: true,
      selectedWalletName: MWA,
    }),
    "sign"
  );
});

test("MWA selected but not connected connects DIRECTLY from the click", () => {
  assert.equal(
    nextWalletConnectStep({
      connected: false,
      hasSignableKey: false,
      selectedWalletName: MWA,
    }),
    "connect-mwa",
    "this is the gesture that opens the wallet app; leaving it to the chooser's own " +
      "select->connect is what Chrome blocks"
  );
});

test("the wallet chooser stays reachable when nothing is selected", () => {
  // The regression this pins: an earlier version diverted the first click straight to MWA,
  // which silently removed Phantom, Solflare and Coinbase from Android because the chooser
  // never opened. Every provider must stay on offer.
  assert.equal(
    nextWalletConnectStep({
      connected: false,
      hasSignableKey: false,
      selectedWalletName: undefined,
    }),
    "open-modal",
    "Phantom, Solflare, Coinbase AND Mobile Wallet Adapter must all be reachable; " +
      "diverting to MWA takes the other providers away"
  );
});

test("no selection at all still opens the chooser (desktop unchanged)", () => {
  assert.equal(
    nextWalletConnectStep({
      connected: false,
      hasSignableKey: false,
      selectedWalletName: null,
    }),
    "open-modal",
    "desktop and iOS keep the existing extension flow unchanged"
  );
});

test("a non-MWA wallet selected does not divert to the mobile path", () => {
  assert.equal(
    nextWalletConnectStep({
      connected: false,
      hasSignableKey: false,
      selectedWalletName: "Phantom",
    }),
    "open-modal",
    "a member who chose Phantom must not be redirected into the mobile adapter"
  );
});

test("connected without a usable key does NOT sign", () => {
  // `connected` alone is not enough: the flow needs a public key to build the challenge.
  assert.notEqual(
    nextWalletConnectStep({
      connected: true,
      hasSignableKey: false,
      selectedWalletName: MWA,
    }),
    "sign"
  );
});
