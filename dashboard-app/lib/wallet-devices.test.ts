import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_HASH_PATTERN,
  isDeviceHash,
  normaliseDeviceHash,
  toDeviceSummary,
  type WalletDeviceRow,
} from "./wallet-devices";

// Behavioural tests for the pure half of the recognised-devices feature (R-021, D5).
//
// The value that comes from the client is a device hash, and it decides which row a
// revoke RPC targets. These tests pin the shape check in both directions — a real
// digest is accepted, and everything else is refused as a cheap `null` rather than
// being handed to the database.

// A real digest: SHA-256 of "device-handle", lowercase hex, 64 chars.
const VALID = "9f2c1b7a4e6d8035c1a2b3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718";

test("accepts a well-formed lowercase digest", () => {
  assert.equal(isDeviceHash(VALID), true);
  assert.equal(normaliseDeviceHash(VALID), VALID);
});

test("normalises an uppercase digest to lowercase rather than refusing it", () => {
  // Hex is case-insensitive and hashDeviceId always emits lowercase, so a caller
  // sending uppercase must still reach its own row — a case-only miss would look
  // like "device not found" and leave a device trusted that the member removed.
  const upper = VALID.toUpperCase();
  assert.equal(normaliseDeviceHash(upper), VALID);
  // The strict predicate is still lowercase-only; normalisation is the intake path.
  assert.equal(isDeviceHash(upper), false);
});

test("trims surrounding whitespace from a valid digest", () => {
  assert.equal(normaliseDeviceHash(`  ${VALID}\n`), VALID);
});

test("refuses anything that is not a 64-char hex digest", () => {
  const refused = [
    "",
    "   ",
    null,
    undefined,
    123,
    {},
    [],
    VALID.slice(0, 63), // one short
    VALID + "0", // one long
    VALID.replace("9", "g"), // non-hex character
    "device_hash",
    // A UUID is NOT a device hash — the mistake this pattern exists to catch.
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  ];
  for (const value of refused) {
    assert.equal(normaliseDeviceHash(value), null, `expected refusal for ${String(value)}`);
  }
});

test("the pattern is anchored — it does not match a digest embedded in other text", () => {
  assert.equal(normaliseDeviceHash(`x${VALID}`), null);
  assert.equal(normaliseDeviceHash(`${VALID}x`), null);
  assert.equal(DEVICE_HASH_PATTERN.test(VALID).valueOf(), true);
});

test("maps a row to a summary, preserving nulls rather than inventing values", () => {
  const row: WalletDeviceRow = {
    device_hash: VALID,
    label: null,
    first_seen_at: null,
    last_seen_at: "2026-11-15T08:00:00.000Z",
    last_ip: null,
    revoked_at: null,
  };
  assert.deepEqual(toDeviceSummary(row), {
    deviceHash: VALID,
    label: null,
    firstSeenAt: null,
    lastSeenAt: "2026-11-15T08:00:00.000Z",
    lastIp: null,
    revokedAt: null,
  });
});

test("carries a revoked_at through unchanged — revocation is a state, not a delete", () => {
  const row: WalletDeviceRow = {
    device_hash: VALID,
    label: "Chrome on macOS",
    first_seen_at: "2026-11-01T00:00:00.000Z",
    last_seen_at: "2026-11-15T08:00:00.000Z",
    last_ip: "203.0.113.7",
    revoked_at: "2026-11-15T09:30:00.000Z",
  };
  const summary = toDeviceSummary(row);
  assert.equal(summary.revokedAt, "2026-11-15T09:30:00.000Z");
  assert.equal(summary.label, "Chrome on macOS");
});
