import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { CONTENT_SECURITY_POLICY } from "./csp";

// Background, because these assertions look arbitrary without it.
//
// Wallet sign-in once died in production with a white "This content is blocked." screen
// and a *successful* audit entry. The browser console named the cause:
//
//   Framing 'https://connect.solflare.com/' violates the following Content Security
//   Policy directive: "default-src 'self'". Note that 'frame-src' was not explicitly
//   set, so 'default-src' is used as a fallback.
//
// The Solflare adapter frames that origin. With no frame-src, `default-src 'self'`
// blocked the iframe and the flow never completed.
//
// The policy then existed in TWO places - netlify.toml (a CDN rule) and middleware.ts
// (per response) - and the previous version of this file asserted only that the two
// copies *agreed*. That is the weaker invariant: it documents the duplication and
// tolerates it, so a fix applied to one emitter still ships a broken path. The policy is
// now defined once in lib/csp.ts, and the assertions below are about there being exactly
// one definition, plus the properties that must survive any future edit.

const ROOT = join(__dirname, "..");
const netlify = readFileSync(join(ROOT, "netlify.toml"), "utf8");
const middleware = readFileSync(join(ROOT, "middleware.ts"), "utf8");

const WALLET_FRAME_ORIGINS = ["https://connect.solflare.com", "https://keys.coinbase.com"];

function directive(policy: string, name: string): string {
  const m = policy.match(new RegExp(`(?:^|;)\\s*${name}\\s([^;]*)`));
  assert.ok(m, `${name} directive is missing from the policy`);
  return m![1].trim();
}

// --- There must be exactly one definition -----------------------------------------

test("netlify.toml does not define a Content-Security-Policy", () => {
  assert.ok(
    !/Content-Security-Policy\s*=/i.test(netlify),
    "a second CSP definition reappeared in netlify.toml - two emitters drift silently"
  );
});

test("middleware.ts imports the policy instead of inlining it", () => {
  assert.match(
    middleware,
    /from\s+["']@\/lib\/csp["']/,
    "middleware must take the policy from lib/csp.ts"
  );
  assert.ok(
    !/default-src/.test(middleware),
    "middleware.ts still contains a policy literal - move it to lib/csp.ts"
  );
});

test("the policy defines each directive exactly once", () => {
  for (const name of ["default-src", "script-src", "connect-src", "frame-src", "frame-ancestors"]) {
    const count = (CONTENT_SECURITY_POLICY.match(new RegExp(`(?:^|;)\\s*${name}\\s`, "g")) ?? []).length;
    assert.equal(count, 1, `${name} must appear exactly once, found ${count}`);
  }
});

// --- Properties that must survive any edit ----------------------------------------

test("frame-src names the wallet connect origins", () => {
  const frameSrc = directive(CONTENT_SECURITY_POLICY, "frame-src");
  for (const origin of WALLET_FRAME_ORIGINS) {
    assert.ok(
      frameSrc.includes(origin),
      `${origin} must be frame-src-allowed or that wallet's sign-in dies`
    );
  }
});

test("frame-ancestors stays 'none' - clickjacking protection is not traded away", () => {
  assert.equal(directive(CONTENT_SECURITY_POLICY, "frame-ancestors"), "'none'");
});

test("frame-src is not widened to a wildcard", () => {
  const frameSrc = directive(CONTENT_SECURITY_POLICY, "frame-src");
  assert.ok(!frameSrc.includes("*"), `frame-src must not contain a wildcard: ${frameSrc}`);
  assert.ok(!/\bhttps:(?!\/\/)/.test(frameSrc), `frame-src must not allow bare https:: ${frameSrc}`);
});

test("connect-src excludes devnet and keeps mainnet", () => {
  const connectSrc = directive(CONTENT_SECURITY_POLICY, "connect-src");
  assert.ok(
    !connectSrc.includes("api.devnet.solana.com"),
    "devnet must not be in connect-src: the browser is mainnet-pinned " +
      "(wallet-provider.tsx uses WalletAdapterNetwork.Mainnet), so devnet was never used " +
      "by a client-side request. See R-011."
  );
  assert.ok(
    connectSrc.includes("https://api.mainnet-beta.solana.com"),
    "mainnet RPC must stay in connect-src or wallet balance/connection calls are blocked"
  );
});

// This test went red the moment http://localhost was added to connect-src — which is the
// test doing its job, and how the missing allowance was confirmed to matter. It is widened
// by NAMING the exception rather than by loosening the rule, so everything else must still
// be https and a second non-https origin cannot slip in unnoticed.
const NON_HTTPS_ALLOWED = ["http://localhost", "ws://localhost:*"];

test("every connect-src and frame-src origin is https, except the MWA localhost allowances", () => {
  for (const name of ["connect-src", "frame-src"]) {
    for (const token of directive(CONTENT_SECURITY_POLICY, name).split(/\s+/).filter(Boolean)) {
      if (token === "'self'" || token.includes("*")) continue;
      if (NON_HTTPS_ALLOWED.includes(token)) continue;
      assert.ok(
        token.startsWith("https://"),
        `${name} origin is not https: ${token}. Only the named MWA localhost allowances may ` +
          "use another scheme — everything else must be https."
      );
    }
  }
});

test("the policy is terminated and parseable", () => {
  assert.ok(CONTENT_SECURITY_POLICY.endsWith(";"), "policy must end with ';'");
  assert.ok(!/;;/.test(CONTENT_SECURITY_POLICY), "policy contains an empty directive");
  assert.ok(!/\s{2,}/.test(CONTENT_SECURITY_POLICY), "policy contains doubled whitespace");
});

// --- Mobile Wallet Adapter (Android browsers) ---------------------------------------
//
// On Android Chrome the connect modal offered wallets that could never reach a connected
// state, because the provider registered only browser-extension adapters. `registerMwa`
// registers the mobile wallet as a Wallet Standard wallet; its browser transport is a
// WebSocket to a reflector the wallet app runs on the same device —
// `ws://localhost:<port>/solana-wallet`, the only localhost reference in the library's
// browser build (no fetch, no http://localhost). Blocked here, the handshake fails at the
// browser and leaves no server-side trace.
//
// NOTE: the https-only test above CANNOT see this entry — it skips any token containing
// '*', and this one is a port wildcard. That is precisely why it is pinned explicitly
// here: a scoped allowance that no rule inspects is a change nobody would notice.

test("connect-src permits the Mobile Wallet Adapter localhost reflector", () => {
  const connectSrc = directive(CONTENT_SECURITY_POLICY, "connect-src");
  assert.ok(
    connectSrc.includes("ws://localhost:*"),
    "the Android mobile wallet handshakes over ws://localhost:<port>/solana-wallet; " +
      "without this entry CSP blocks it silently at the browser. See " +
      "lib/mobile-wallet-standard.ts."
  );
});

test("connect-src permits the MWA loopback PERMISSION PRIMER, not only the transport", () => {
  const connectSrc = directive(CONTENT_SECURITY_POLICY, "connect-src");
  assert.ok(
    connectSrc.includes("http://localhost"),
    "the library's \"Continue to allow\" button calls exactly fetch(\"http://localhost\") to " +
      "make Chrome raise its local-network permission prompt. Without this the fetch is " +
      "blocked by CSP, the prompt never appears, and — because the library swallows the " +
      "failure in `catch {}` — nothing is reported anywhere. The member taps the button and " +
      "no wallet opens."
  );
});

test("the MWA localhost allowances are not a general widening", () => {
  const connectSrc = directive(CONTENT_SECURITY_POLICY, "connect-src");
  assert.ok(!connectSrc.includes("ws://*:"), "must not become a general websocket wildcard");
  assert.ok(!connectSrc.includes("http://*"), "must not become a general http wildcard");

  // Every non-https connect target must be localhost. (Earlier this file asserted the
  // OPPOSITE for http://localhost — pinning the very omission that broke mobile sign-in.
  // An assertion can lock in a mistake as effectively as it locks in a decision.)
  const plainOrWs = connectSrc.split(/\s+/).filter((t) => /^wss?:/.test(t) || /^http:\/\//.test(t));
  assert.ok(plainOrWs.length > 0, "sanity: the MWA allowances should be present");
  for (const token of plainOrWs) {
    assert.ok(
      /^(http|ws):\/\/localhost/.test(token),
      `only localhost may use a non-https scheme in connect-src, found: ${token}`
    );
  }
});
