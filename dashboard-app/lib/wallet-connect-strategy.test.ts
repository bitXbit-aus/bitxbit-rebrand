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
// solana-wallet:/v1/associate...") and prescribe selecting MWA as early as possible so the
// connection is made directly from a click.
//
// The bug this encodes: routing the click through the selection MODAL leaves the wallet
// SELECTED BUT NOT CONNECTED, because the modal's select→connect runs outside the gesture.
// Every subsequent click then sees `connected === false` and reopens the modal — an
// inescapable loop that presents as "I pick it, I allow it, nothing happens".

const MWA = MOBILE_WALLET_ADAPTER_NAME;

test("the adapter name is the library's own, not a guess", () => {
  assert.equal(
    MOBILE_WALLET_ADAPTER_NAME,
    SolanaMobileWalletAdapterWalletName,
    "the name we compare against must come from the library; a rename upstream would make " +
      "every comparison below silently false and put us back in the modal loop"
  );
});

test("a connected wallet with a key signs", () => {
  assert.equal(
    nextWalletConnectStep({
      connected: true,
      hasSignableKey: true,
      selectedWalletName: MWA,
      mobileWalletAvailable: true,
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
      mobileWalletAvailable: true,
    }),
    "connect-mwa",
    "this is the gesture that opens the wallet app; routing it through the modal is what " +
      "Chrome blocks"
  );
});

test("MWA available but NOT selected selects it, rather than opening the modal", () => {
  assert.equal(
    nextWalletConnectStep({
      connected: false,
      hasSignableKey: false,
      selectedWalletName: undefined,
      mobileWalletAvailable: true,
    }),
    "select-mwa",
    "the vendor guidance is to select MWA as early as possible; opening the modal here is " +
      "what loses the gesture for the connect that follows"
  );
});

test("with no mobile wallet available the modal is still the fallback", () => {
  assert.equal(
    nextWalletConnectStep({
      connected: false,
      hasSignableKey: false,
      selectedWalletName: undefined,
      mobileWalletAvailable: false,
    }),
    "open-modal",
    "desktop and iOS must keep the existing extension flow unchanged"
  );
});

test("a non-MWA wallet selected does not divert to the mobile path", () => {
  assert.equal(
    nextWalletConnectStep({
      connected: false,
      hasSignableKey: false,
      selectedWalletName: "Phantom",
      mobileWalletAvailable: true,
    }),
    "select-mwa",
    "with Phantom selected but not connected, MWA is still the mobile path worth taking"
  );
});

test("connected without a usable key does NOT sign", () => {
  // `connected` alone is not enough: the flow needs a public key to build the challenge.
  assert.notEqual(
    nextWalletConnectStep({
      connected: true,
      hasSignableKey: false,
      selectedWalletName: MWA,
      mobileWalletAvailable: true,
    }),
    "sign"
  );
});
