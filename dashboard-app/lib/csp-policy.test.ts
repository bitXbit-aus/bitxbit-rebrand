import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Wallet sign-in broke in production with a white "This content is blocked.
// Contact site owner to fix the issue." screen. Measured cause, from the browser
// console:
//
//   Framing 'https://connect.solflare.com/' violates the following Content
//   Security Policy directive: "default-src 'self'". Note that 'frame-src' was
//   not explicitly set, so 'default-src' is used as a fallback.
//
// The Solflare adapter embeds its connect origin in an IFRAME. With no frame-src,
// default-src 'self' blocked it, the adapter never completed, and the user landed
// on a dead page.
//
// These assertions pin the three things that must stay true:
//   1. frame-src EXISTS and names the wallet origins (so the iframe loads).
//   2. frame-ancestors stays 'none' (we stay unframeable - clickjacking
//      protection is NOT traded away to fix this).
//   3. frame-src is not widened to a wildcard.
//
// Two sources emit the CSP - netlify.toml (CDN header rule) and middleware.ts
// (per-response) - so both are checked. A fix applied to only one would pass on
// one path and fail on the other, which is how this kind of policy drifts.

const ROOT = join(__dirname, "..");
const netlify = readFileSync(join(ROOT, "netlify.toml"), "utf8");
const middleware = readFileSync(join(ROOT, "middleware.ts"), "utf8");

const WALLET_FRAME_ORIGINS = ["https://connect.solflare.com", "https://keys.coinbase.com"];

// netlify.toml holds the CSP as one literal value.
function netlifyCsp(): string {
  const m = netlify.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
  assert.ok(m, "Content-Security-Policy not found in netlify.toml");
  return m![1];
}

// middleware.ts builds it by concatenating adjacent string literals across lines,
// with comments in between. Strip comments, then join the literals.
function middlewareCsp(): string {
  const cleaned = middleware
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  const start = cleaned.indexOf('"default-src');
  assert.ok(start >= 0, "CSP literal not found in middleware.ts");
  const tail = cleaned.slice(start);
  const end = tail.indexOf('";');
  assert.ok(end > 0, "unterminated CSP literal in middleware.ts");
  return tail
    .slice(0, end)
    .replace(/"\s*\+\s*\n?\s*"/g, "")
    .replace(/^"|"$/g, "");
}

const sources: Array<[string, string]> = [
  ["netlify.toml", netlifyCsp()],
  ["middleware.ts", middlewareCsp()],
];

for (const [name, csp] of sources) {
  test(`${name}: CSP declares frame-src for the wallet connect origins`, () => {
    assert.match(csp, /frame-src\b/, "frame-src missing - wallet iframes fall back to default-src");
    const frameSrc = csp.match(/frame-src([^;]*)/)?.[1] ?? "";
    for (const origin of WALLET_FRAME_ORIGINS) {
      assert.ok(
        frameSrc.includes(origin),
        `${origin} must be frame-src-allowed or that wallet's sign-in dies`
      );
    }
  });

  test(`${name}: frame-ancestors is still 'none' (clickjacking protection intact)`, () => {
    assert.match(csp, /frame-ancestors 'none'/, "frame-ancestors must remain 'none'");
  });

  test(`${name}: frame-src is not widened to a wildcard`, () => {
    const frameSrc = csp.match(/frame-src([^;]*)/)?.[1] ?? "";
    assert.ok(!frameSrc.includes("*"), `frame-src must not contain a wildcard: ${frameSrc}`);
    assert.ok(!/\bhttps:(?!\/\/)/.test(frameSrc), `frame-src must not allow bare https:: ${frameSrc}`);
  });
}

test("netlify.toml and middleware.ts agree on frame-src", () => {
  const origins = (csp: string) =>
    (csp.match(/frame-src([^;]*)/)?.[1] ?? "").trim().split(/\s+/).filter(Boolean).sort();
  assert.deepEqual(
    origins(sources[0][1]),
    origins(sources[1][1]),
    "the two CSP sources have drifted apart on frame-src"
  );
});
