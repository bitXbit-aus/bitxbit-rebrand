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

test("every connect-src and frame-src origin is https (or 'self')", () => {
  for (const name of ["connect-src", "frame-src"]) {
    for (const token of directive(CONTENT_SECURITY_POLICY, name).split(/\s+/).filter(Boolean)) {
      if (token === "'self'" || token.includes("*")) continue;
      assert.ok(token.startsWith("https://"), `${name} origin is not https: ${token}`);
    }
  }
});

test("the policy is terminated and parseable", () => {
  assert.ok(CONTENT_SECURITY_POLICY.endsWith(";"), "policy must end with ';'");
  assert.ok(!/;;/.test(CONTENT_SECURITY_POLICY), "policy contains an empty directive");
  assert.ok(!/\s{2,}/.test(CONTENT_SECURITY_POLICY), "policy contains doubled whitespace");
});
