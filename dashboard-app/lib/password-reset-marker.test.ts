import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PASSWORD_RESET_COOKIE,
  RESET_MARKER_TTL_SECONDS,
  RESET_PASSWORD_PATH,
  createResetMarker,
  resetMarkerKey,
  verifyResetMarker,
} from "./password-reset-marker";
import { RESET_PASSWORD_PATH as PATH_FROM_RESET_LIB } from "./password-reset";

const KEY = "test-key-not-a-real-secret";
const USER = "11111111-2222-3333-4444-555555555555";
const OTHER_USER = "99999999-8888-7777-6666-555555555555";
const NOW = 1_800_000_000_000; // fixed clock; the TTL is asserted, not waited on

test("a freshly minted marker verifies for the user it was minted for", () => {
  const { value } = createResetMarker(USER, KEY, NOW);
  assert.equal(verifyResetMarker(value, USER, KEY, NOW), true);
});

test("cookie maxAge matches the documented TTL", () => {
  const { maxAge } = createResetMarker(USER, KEY, NOW);
  assert.equal(maxAge, RESET_MARKER_TTL_SECONDS);
  assert.equal(maxAge, 1800);
});

test("the reset path has exactly ONE definition, shared with the request helper", () => {
  // A second copy of this constant could be changed in one place and honoured in
  // another: a marker issued for one path would then be accepted on a different
  // one. The re-export must stay the same value, not merely a similar string.
  assert.equal(RESET_PASSWORD_PATH, "/auth/reset-password");
  assert.equal(RESET_PASSWORD_PATH, PATH_FROM_RESET_LIB);
});

test("a marker minted for one user is REFUSED for another", () => {
  // The load-bearing property. If `userId` were dropped from the signed payload,
  // any marker would work for any account and this is what would catch it.
  const { value } = createResetMarker(USER, KEY, NOW);
  assert.equal(verifyResetMarker(value, OTHER_USER, KEY, NOW), false);
});

test("a tampered signature is refused", () => {
  const { value } = createResetMarker(USER, KEY, NOW);
  const [version, expires, sig] = value.split(".");
  const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
  assert.equal(verifyResetMarker(`${version}.${expires}.${flipped}`, USER, KEY, NOW), false);
});

test("a marker minted for another key is refused", () => {
  const { value } = createResetMarker(USER, KEY, NOW);
  assert.equal(verifyResetMarker(value, USER, "a-different-key", NOW), false);
});

test("an expired marker is refused, and the boundary is the expiry itself", () => {
  const { value } = createResetMarker(USER, KEY, NOW);
  const expiresAt = Number(value.split(".")[1]);
  // One millisecond before expiry: still valid.
  assert.equal(verifyResetMarker(value, USER, KEY, expiresAt * 1000 - 1), true);
  // At expiry: refused.
  assert.equal(verifyResetMarker(value, USER, KEY, expiresAt * 1000), false);
  // Well past it: refused.
  assert.equal(
    verifyResetMarker(value, USER, KEY, NOW + RESET_MARKER_TTL_SECONDS * 1000 + 1),
    false
  );
});

test("malformed values are refused rather than throwing", () => {
  const cases: (string | undefined | null)[] = [
    undefined,
    null,
    "",
    "v1",
    "v1.123",
    "v1.123.abc.extra",
    "v2.99999999999.deadbeef",
    "v1.notanumber.deadbeef",
    "v1.99999999999.deadbeef", // right shape, wrong signature length
    "v1.99999999999.zzzz", // right length, not hex
    "....",
  ];
  for (const value of cases) {
    assert.equal(
      verifyResetMarker(value, USER, KEY, NOW),
      false,
      `expected refusal for ${JSON.stringify(value)}`
    );
  }
});

test("with no key, NOTHING verifies — the guard fails closed", () => {
  const { value } = createResetMarker(USER, KEY, NOW);
  assert.equal(verifyResetMarker(value, USER, "", NOW), false);
  assert.equal(verifyResetMarker(undefined, USER, "", NOW), false);
});

test("an empty user id never verifies", () => {
  const { value } = createResetMarker(USER, KEY, NOW);
  assert.equal(verifyResetMarker(value, "", KEY, NOW), false);
});

test("the signature is deterministic for the same user, expiry and key", () => {
  // Two markers minted at the same instant must be byte-identical, otherwise a
  // test could pass on a value that a later verification path would reject.
  const a = createResetMarker(USER, KEY, NOW).value;
  const b = createResetMarker(USER, KEY, NOW).value;
  assert.equal(a, b);
  // A later mint differs (different expiry), so the value is not a constant.
  const c = createResetMarker(USER, KEY, NOW + 1000).value;
  assert.notEqual(a, c);
});

test("the cookie name is namespaced and not a Supabase cookie", () => {
  assert.equal(PASSWORD_RESET_COOKIE, "bx_pwreset");
  assert.equal(PASSWORD_RESET_COOKIE.startsWith("sb-"), false);
});

test("key resolution prefers a dedicated secret and falls back to the service key", () => {
  assert.equal(resetMarkerKey({ PASSWORD_RESET_MARKER_SECRET: "dedicated" }), "dedicated");
  assert.equal(
    resetMarkerKey({ PASSWORD_RESET_MARKER_SECRET: "dedicated", SUPABASE_SERVICE_ROLE_KEY: "svc" }),
    "dedicated"
  );
  assert.equal(resetMarkerKey({ SUPABASE_SERVICE_ROLE_KEY: "svc" }), "svc");
  assert.equal(resetMarkerKey({}), "");
});
