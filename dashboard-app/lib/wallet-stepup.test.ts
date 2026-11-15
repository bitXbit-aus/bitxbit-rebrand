import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEVICE_COOKIE,
  DEVICE_TTL_SECONDS,
  STEPUP_CODE_LENGTH,
  STEPUP_MAX_ATTEMPTS,
  deviceCookieOptions,
  deviceLabel,
  emailHint,
  generateStepUpCode,
  hashDeviceId,
  hashStepUpCode,
  newDeviceId,
  parseStepUpStatus,
  stepUpCodeMatches,
  stepUpKey,
} from "./wallet-stepup";

// ------------------------------------------------------------------ the code

test("a code is always six digits", () => {
  for (let i = 0; i < 300; i++) {
    assert.match(generateStepUpCode(), /^\d{6}$/, "a code must be exactly six digits");
  }
});

test("codes are drawn from a CSPRNG, not a fixed or cycling value", () => {
  // A predictable code is guessable regardless of the attempt limit, so this asserts
  // the generator actually varies. 300 draws from 10^6 are essentially all distinct.
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) seen.add(generateStepUpCode());
  assert.ok(seen.size > 250, `expected varied codes, saw ${seen.size} distinct of 300`);
  assert.equal(STEPUP_CODE_LENGTH, 6);
});

// ------------------------------------------------------------------ the HMAC

test("the code is stored as an HMAC, never recoverably", () => {
  const key = "test-key";
  const hashed = hashStepUpCode("123456", key);
  assert.equal(hashed.length, 64, "expected a sha256-length hex digest");
  assert.notEqual(hashed, hashStepUpCode("123456", "another-key"), "the key must matter");
  assert.equal(hashed, hashStepUpCode("123456", key), "and must be deterministic");
  assert.equal(hashStepUpCode("123456", ""), "", "no key means no hash, so callers must refuse");
});

test("matching is correct, refuses without a key, and never throws", () => {
  const key = "test-key";
  const stored = hashStepUpCode("123456", key);

  assert.equal(stepUpCodeMatches("123456", stored, key), true);
  assert.equal(stepUpCodeMatches("123457", stored, key), false);
  assert.equal(stepUpCodeMatches("123456", stored, ""), false, "no key must refuse, not pass");
  assert.equal(stepUpCodeMatches("", stored, key), false);
  assert.equal(stepUpCodeMatches("123456", "", key), false);

  // Length and non-hex inputs must be REFUSED, not thrown on: `timingSafeEqual`
  // throws on a length mismatch, and a throw here would surface as a 500 rather than
  // as a refusal.
  assert.equal(stepUpCodeMatches("123456", "short", key), false);
  assert.equal(stepUpCodeMatches("123456", "zz".repeat(32), key), false);
});

// -------------------------------------------------------- the status contract

test("only a recognised status survives parsing, and junk can never become ok", () => {
  for (const s of ["ok", "not_found", "consumed", "expired", "exhausted", "invalid_code"]) {
    assert.equal(parseStepUpStatus(s), s);
  }

  // Anything unrecognised must fall to a REFUSAL. If this ever defaulted to "ok", a
  // provider change or a malformed payload would mint a session.
  for (const junk of ["", "OK", "Ok", "success", null, undefined, 42, {}, [], "ok "]) {
    assert.notEqual(parseStepUpStatus(junk), "ok", `junk ${JSON.stringify(junk)} became ok`);
    assert.equal(parseStepUpStatus(junk), "not_found");
  }
});

// ------------------------------------------------------------- the device

test("a device id is unguessable, opaque and unique", () => {
  const a = newDeviceId();
  const b = newDeviceId();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/, "base64url, so it is cookie-safe");
  assert.ok(a.length >= 40, `expected >= 40 chars of handle, got ${a.length}`);
  assert.equal(hashDeviceId(a), hashDeviceId(a), "hashing is deterministic");
  assert.match(hashDeviceId(a), /^[0-9a-f]{64}$/);
  assert.notEqual(hashDeviceId(a), a, "the stored value must not be the cookie value");
});

test("the device cookie is httpOnly, secure and site-scoped", () => {
  const options = deviceCookieOptions();
  assert.equal(options.httpOnly, true, "a script-readable trust handle is an XSS gift");
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/");
  assert.equal(options.maxAge, DEVICE_TTL_SECONDS);
  assert.equal(DEVICE_COOKIE, "bx_wallet_device");
});

test("device labels are coarse, and never echo the raw user agent", () => {
  const chromeMac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
  assert.equal(deviceLabel(chromeMac), "Chrome on macOS");
  assert.equal(
    deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 Safari/604.1"),
    "Safari on iPhone"
  );
  assert.equal(
    deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0"),
    "Edge on Windows"
  );
  assert.equal(deviceLabel(""), "Unknown browser");
  assert.equal(deviceLabel(null), "Unknown browser");

  const label = deviceLabel(chromeMac);
  assert.equal(label.includes("AppleWebKit"), false, "the raw agent must not reach the member");
  assert.ok(label.length < 40, "a label is for recognition, not fingerprinting");
});

// ------------------------------------------------------------- the hint

test("the email hint shows enough to recognise the inbox and no more", () => {
  assert.equal(emailHint("millsy@protonmail.com"), "m••••@protonmail.com");
  assert.equal(emailHint("a@b.com"), "a•@b.com");
  assert.equal(emailHint("nonsense"), "", "no domain means no hint, not a leak");
  assert.equal(emailHint(""), "");

  const hint = emailHint("millsy@protonmail.com");
  assert.equal(hint.includes("millsy"), false, "the local part must be masked");
  assert.equal(hint.includes("protonmail.com"), true, "the domain is the point of the hint");
});

// ------------------------------------------------------------- the key

test("the signing key prefers its own secret and falls back to the service-role key", () => {
  assert.equal(
    stepUpKey({ STEPUP_HMAC_SECRET: "dedicated", SUPABASE_SERVICE_ROLE_KEY: "fallback" }),
    "dedicated"
  );
  assert.equal(stepUpKey({ SUPABASE_SERVICE_ROLE_KEY: "fallback" }), "fallback");
  assert.equal(stepUpKey({}), "", "no key at all must be an empty string, never a wildcard");
});

test("the documented limits are the ones the SQL enforces", () => {
  // These appear in the migration and in the member-facing copy; a silent divergence
  // would make the description wrong rather than the control.
  assert.equal(STEPUP_MAX_ATTEMPTS, 5);
  assert.equal(STEPUP_CODE_LENGTH, 6);
  assert.equal(DEVICE_TTL_SECONDS, 90 * 24 * 60 * 60);
});
