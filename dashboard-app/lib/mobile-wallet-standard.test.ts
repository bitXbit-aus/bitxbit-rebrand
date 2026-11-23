import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { SOLANA_MAINNET_CHAIN } from "@solana/wallet-standard-chains";

import {
  MOBILE_WALLET_CHAINS,
  MOBILE_WALLET_ICON_PATH,
  MOBILE_WALLET_NAME,
  isMobileWalletAdapterEnvironment,
  mobileAppIdentity,
  registerMobileWalletAdapter,
} from "./mobile-wallet-standard";

// Background, because these assertions look arbitrary without it.
//
// The wallet provider registered only browser-extension adapters, so on Android Chrome the
// connect modal offered wallets that could never reach a connected state — reported as a
// modal that "fails to load options". `registerMwa` fixes that by registering the mobile
// wallet as a WALLET STANDARD wallet, which `@solana/wallet-adapter-react` already
// consumes, so no new adapter is added to the provider's array.
//
// Three properties decide whether this helps or makes things worse, and each can be broken
// silently:
//   1. It must register ONLY where a wallet app is actually reachable. Registering on
//      desktop/iOS adds a wallet entry that can never connect — the very defect being
//      fixed, but now deliberate.
//   2. It must be wired to the provider. An unused export changes nothing.
//   3. It must be unable to break sign-in. It is an enhancement: if it fails, sign-in must
//      behave exactly as it did before it existed.

const ROOT = join(__dirname, "..");
const providerSource = readFileSync(
  join(ROOT, "components", "providers", "wallet-provider.tsx"),
  "utf8"
);
const moduleSource = readFileSync(join(ROOT, "lib", "mobile-wallet-standard.ts"), "utf8");

// --- 1. Register only where a wallet app can be reached ------------------------------

const ANDROID_USER_AGENTS = [
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Android 15; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

const NON_ANDROID_USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

test("registers on Android browsers", () => {
  for (const ua of ANDROID_USER_AGENTS) {
    assert.equal(isMobileWalletAdapterEnvironment(ua), true, `should register on: ${ua}`);
  }
});

test("does NOT register where no wallet app can be reached", () => {
  for (const ua of NON_ANDROID_USER_AGENTS) {
    assert.equal(
      isMobileWalletAdapterEnvironment(ua),
      false,
      `registering here would add a wallet entry that can never connect: ${ua}`
    );
  }
});

test("an absent user agent is not Android", () => {
  for (const value of [null, undefined, ""]) {
    assert.equal(isMobileWalletAdapterEnvironment(value), false, `userAgent=${String(value)}`);
  }
});

// --- the identity the wallet app displays -------------------------------------------

test("the app identity is bound to the origin the member is actually on", () => {
  const previewOrigin = "https://deploy-preview-99--bitxbit-dashboard.netlify.app";
  const identity = mobileAppIdentity(previewOrigin);
  assert.equal(
    identity.uri,
    previewOrigin,
    "a preview must identify itself as the preview, not as production"
  );
  assert.equal(identity.name, MOBILE_WALLET_NAME);
  assert.ok(
    identity.icon.startsWith(previewOrigin),
    "the icon must be an absolute URL on the same origin, or the wallet cannot fetch it"
  );
});

test("the prompt icon is a real PNG that exists in public/", () => {
  const iconPath = join(ROOT, "public", MOBILE_WALLET_ICON_PATH.replace(/^\//, ""));
  const bytes = readFileSync(iconPath); // throws if the asset is missing or moved
  assert.ok(bytes.length > 0, "the icon the wallet prompts with must exist and be non-empty");
  assert.equal(
    bytes.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    "the wallet prompt icon must be a real PNG, not an HTML error page"
  );
});

// --- chains are read from the package, never retyped --------------------------------

test("the mobile wallet is registered for mainnet, taken from the chain constant", () => {
  assert.equal(SOLANA_MAINNET_CHAIN, "solana:mainnet", "sanity: the chain identifier moved");
  assert.deepEqual([...MOBILE_WALLET_CHAINS], [SOLANA_MAINNET_CHAIN]);
  assert.ok(
    !MOBILE_WALLET_CHAINS.includes("solana:devnet"),
    "the browser is mainnet-pinned (R-011); the mobile wallet must match it"
  );
});

// --- 2. It must actually be wired to the provider -----------------------------------

test("the wallet provider registers the mobile adapter", () => {
  assert.match(
    providerSource,
    /import\s*\{[^}]*\bregisterMobileWalletAdapter\b[^}]*\}\s*from\s*"@\/lib\/mobile-wallet-standard"/,
    "the provider must import registerMobileWalletAdapter"
  );
  assert.match(
    providerSource,
    /\bregisterMobileWalletAdapter\s*\(/,
    "importing it is not wiring it: the provider must CALL it"
  );
  assert.match(
    providerSource,
    /useEffect\s*\(/,
    "registration must run in an effect — client-side, after mount, not during render or SSR"
  );
});

// --- 3. It must be unable to break sign-in ------------------------------------------

test("registration is guarded and cannot throw", () => {
  assert.match(
    moduleSource,
    /typeof window === "undefined"/,
    "it must no-op during SSR rather than reaching for a browser global"
  );
  assert.match(moduleSource, /catch\s*\(/, "it must catch its own failures");
  assert.ok(
    !/\bthrow\s+new\b/.test(moduleSource),
    "an enhancement may not throw: a failure here must degrade to 'no mobile wallet', never to a broken sign-in"
  );
});

test("registration is a no-op outside a browser and returns rather than exploding", async () => {
  assert.equal(
    await registerMobileWalletAdapter(),
    false,
    "with no window there is nothing to register, and no exception"
  );
});
