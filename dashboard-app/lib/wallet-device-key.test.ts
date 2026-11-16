import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";

import {
  DEVICE_SIGNATURE_BYTES,
  DEVICE_SIGNATURE_ENCODING,
  deviceKeyRegistered,
  parseDevicePublicKey,
  verifyDeviceSignature,
} from "./wallet-device-key";

// Tests for the device-bound key's verification half (R-021, Part 2).
//
// These are written around the trap, not around the happy path only.
//
// WebCrypto emits ECDSA signatures as raw `r || s` (IEEE P-1363, 64 bytes for
// P-256). Node's `crypto.verify` assumes DER unless told `dsaEncoding:
// "ieee-p1363"`. Get that wrong and nothing throws — every GENUINE signature
// simply fails to verify, which reads as "the device key never works" and would
// be debugged in entirely the wrong place. So the first test signs with the real
// `crypto.subtle`, through the same call the browser will make, and requires it to
// verify. A negative-only suite would pass with the bug in place.

const subtle = webcrypto.subtle;
const encoder = new TextEncoder();

/** Generates a real P-256 keypair and a real WebCrypto signature over `nonce`. */
async function genuineSignature(nonce: string) {
  const pair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await subtle.exportKey("jwk", pair.publicKey);
  const raw = new Uint8Array(
    await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, encoder.encode(nonce))
  );
  const publicKey = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
  return { publicKey, signature: Buffer.from(raw).toString("base64url"), raw, pair };
}

test("a GENUINE WebCrypto signature over the nonce verifies", async () => {
  // The load-bearing assertion: this is what fails if dsaEncoding is omitted.
  const { publicKey, signature } = await genuineSignature("nonce-abc-123");
  assert.equal(
    verifyDeviceSignature({ publicKey, nonce: "nonce-abc-123", signature }),
    true,
    "a real crypto.subtle ECDSA P-256 signature must verify — if this fails, DEVICE_SIGNATURE_ENCODING is wrong"
  );
});

test("WebCrypto's signature is raw r||s, 64 bytes — not DER", async () => {
  const { raw } = await genuineSignature("nonce-format");
  assert.equal(raw.length, DEVICE_SIGNATURE_BYTES);
  assert.equal(DEVICE_SIGNATURE_BYTES, 64);
  // A DER-encoded P-256 signature is longer than 64 bytes (SEQUENCE + two INTEGERs
  // with length prefixes), so a 64-byte length is what distinguishes the two forms.
  assert.ok(raw.length === 64, "P-256 r||s is exactly 64 bytes");
});

test("a DER-encoded signature is refused", async () => {
  // Documents the strictness: we require the WebCrypto form and do not try to
  // accept both encodings. A DER signature is the wrong length, so it is rejected
  // before any verifier is invoked.
  const { publicKey, pair } = await genuineSignature("nonce-der");
  const der = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    // Re-sign the same nonce, then present the signature in DER via Node's own
    // encoder: the bytes differ in framing, not in meaning.
    pair.privateKey,
    encoder.encode("nonce-der")
  );
  // WebCrypto always gives raw; fabricate a DER-shaped buffer of the wrong length.
  const fakeDer = Buffer.concat([Buffer.from([0x30, 0x44]), Buffer.from(new Uint8Array(der))]);
  assert.equal(
    verifyDeviceSignature({
      publicKey,
      nonce: "nonce-der",
      signature: fakeDer.toString("base64url"),
    }),
    false,
    "anything that is not a 64-byte r||s buffer must be refused"
  );
});

test("the same signature does not verify against a different nonce", async () => {
  const { publicKey, signature } = await genuineSignature("nonce-one");
  assert.equal(verifyDeviceSignature({ publicKey, nonce: "nonce-one", signature }), true);
  assert.equal(
    verifyDeviceSignature({ publicKey, nonce: "nonce-two", signature }),
    false,
    "a captured device signature must not be replayable against a fresh nonce"
  );
});

test("a tampered signature is refused", async () => {
  const { publicKey, signature, raw } = await genuineSignature("nonce-tamper");
  const flipped = Buffer.from(raw);
  flipped[0] ^= 0x01;
  assert.equal(
    verifyDeviceSignature({ publicKey, nonce: "nonce-tamper", signature: flipped.toString("base64url") }),
    false
  );
  // And the original still verifies, so the tamper — not the setup — caused it.
  assert.equal(verifyDeviceSignature({ publicKey, nonce: "nonce-tamper", signature }), true);
});

test("a signature from a DIFFERENT device does not verify", async () => {
  const a = await genuineSignature("nonce-shared");
  const b = await genuineSignature("nonce-shared");
  assert.equal(
    verifyDeviceSignature({ publicKey: a.publicKey, nonce: "nonce-shared", signature: b.signature }),
    false,
    "the signature must be bound to the registered public key, not merely well-formed"
  );
});

test("malformed input refuses rather than throwing", () => {
  const bad = [
    { publicKey: "", nonce: "n", signature: "AAAA" },
    { publicKey: "not-json", nonce: "n", signature: "AAAA" },
    { publicKey: '{"kty":"EC","crv":"P-256","x":"a","y":"b"}', nonce: "", signature: "AAAA" },
    { publicKey: '{"kty":"EC","crv":"P-256","x":"a","y":"b"}', nonce: "n", signature: "" },
    { publicKey: '{"kty":"EC","crv":"P-256","x":"a","y":"b"}', nonce: "n", signature: "!!!not-base64!!!" },
  ];
  for (const params of bad) {
    assert.equal(verifyDeviceSignature(params), false, JSON.stringify(params));
  }
});

test("parseDevicePublicKey accepts a well-formed P-256 JWK and canonicalises it", () => {
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: Buffer.alloc(32, 7).toString("base64url"),
    y: Buffer.alloc(32, 9).toString("base64url"),
  };
  const result = parseDevicePublicKey(JSON.stringify(jwk));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.jwk.kty, "EC");
    assert.equal(result.jwk.crv, "P-256");
    // Canonical: the stored column holds what this module produced, not the raw input.
    assert.deepEqual(JSON.parse(result.canonical), jwk);
  }
});

test("parseDevicePublicKey REFUSES a JWK carrying private material", () => {
  const withPrivate = {
    kty: "EC",
    crv: "P-256",
    x: Buffer.alloc(32, 7).toString("base64url"),
    y: Buffer.alloc(32, 9).toString("base64url"),
    d: Buffer.alloc(32, 1).toString("base64url"),
  };
  const result = parseDevicePublicKey(JSON.stringify(withPrivate));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.problem, "private_material_present");
    // Checked first, so the reason is unambiguous rather than reported as a curve issue.
  }
});

test("parseDevicePublicKey refuses the wrong shape, curve and coordinate lengths", () => {
  const cases: Array<[unknown, string]> = [
    ["not json at all", "not_json"],
    [null, "not_object"],
    [[] as unknown, "not_object"],
    ['"a string"', "not_object"],
    [{ kty: "RSA", crv: "P-256", x: "AA", y: "AA" }, "wrong_kty"],
    [{ kty: "EC", crv: "P-384", x: "AA", y: "AA" }, "wrong_crv"],
    [{ kty: "EC", crv: "P-256", x: 1, y: 2 }, "missing_coordinate"],
    // Right shape, wrong length: a coordinate must be exactly 32 bytes for P-256.
    [{ kty: "EC", crv: "P-256", x: "AAAA", y: "AAAA" }, "wrong_coordinate_length"],
  ];
  for (const [input, problem] of cases) {
    const result = parseDevicePublicKey(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) assert.equal(result.problem, problem, JSON.stringify(input));
  }
});

test("deviceKeyRegistered tells 'no key' apart from 'has a key'", () => {
  // A trusted row with no key must be treated as NOT device-bound, so it steps up.
  assert.equal(deviceKeyRegistered(null), false);
  assert.equal(deviceKeyRegistered(undefined), false);
  assert.equal(deviceKeyRegistered(""), false);
  assert.equal(deviceKeyRegistered('{"kty":"EC","crv":"P-256","x":"a","y":"b"}'), true);
});

// ---------------------------------------------------------------------------
// REAL BROWSER VECTORS (R-021 Part 2, rule 12).
//
// Captured from Chromium on the deploy-preview-91 origin. The public key below is
// the exported public half of a keypair generated with `extractable: false`, and
// each signature is what a real `crypto.subtle.sign` produced: one immediately,
// and one after a FULL PAGE RELOAD, signing with the CryptoKey read back out of
// IndexedDB in a fresh JS realm.
//
// This is the browser-to-server contract, and it is the one thing the Node-only
// suite cannot otherwise prove — that what a browser actually emits is what this
// module actually accepts. Curves, hashes and encodings agree in the abstract;
// these bytes are the evidence. Change the encoding, the hash, or the accepted JWK
// shape and this test fails here rather than at sign-in in production.
//
// Measured alongside them, in the browser: the private key reports
// `extractable: false`, `exportKey` on it throws InvalidAccessError, and BOTH
// properties survive the IndexedDB round trip (structured clone returns a CryptoKey
// that still refuses to export). That is the whole security property of Part 2 —
// there is no form of this key a victim could read out and relay.
const BROWSER_PUBLIC_KEY =
  '{"kty":"EC","crv":"P-256","x":"gEqe0BOd1d5IHFGbytDj9yY6hcuFMisxFDuny1p5Dj8","y":"qHHSwga1vreC-k8ftSrFTWfiwDBmIthH5idDMf4BSlw"}';
const BROWSER_SIGNATURE_LIVE =
  "V3bdBEqDL7t1LE-6vQ7_-ePfupbrIXcwsY3hb-4dWCqbx8Q-BdkGnF5MfMLKZjN7L8y7c5P1Qa66NijlvmxOEw";
const BROWSER_SIGNATURE_AFTER_RELOAD =
  "quXcb2JznvUv9ChfD8KshkLQ7MNOcOkhA80DhqsQcNahM6cJ-EjZmmmxZnxhgW0oIbCP7Vk6z4XzOKVcXybG9w";

test("a public key exported by a REAL BROWSER is accepted", () => {
  const parsed = parseDevicePublicKey(BROWSER_PUBLIC_KEY);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.jwk.crv, "P-256");
});

test("a signature captured from a REAL BROWSER verifies (browser-to-server contract)", () => {
  assert.equal(
    verifyDeviceSignature({
      publicKey: BROWSER_PUBLIC_KEY,
      nonce: "nonce-browser-2",
      signature: BROWSER_SIGNATURE_LIVE,
    }),
    true,
    "a real Chromium WebCrypto signature must verify through this module — if this fails, the browser emits something the server does not accept"
  );
});

test("a signature made AFTER A PAGE RELOAD, from the IndexedDB key, verifies", () => {
  // This is the persistence case: the key was written to IndexedDB, the page was
  // reloaded, and the CryptoKey came back in a fresh realm. It still signs, and the
  // signature is still the form the server accepts.
  assert.equal(
    verifyDeviceSignature({
      publicKey: BROWSER_PUBLIC_KEY,
      nonce: "nonce-after-reload",
      signature: BROWSER_SIGNATURE_AFTER_RELOAD,
    }),
    true
  );
});

test("the browser vectors are bound to their nonce, not merely well-formed", () => {
  assert.equal(
    verifyDeviceSignature({
      publicKey: BROWSER_PUBLIC_KEY,
      nonce: "nonce-after-reload",
      signature: BROWSER_SIGNATURE_LIVE,
    }),
    false
  );
  assert.equal(
    verifyDeviceSignature({
      publicKey: BROWSER_PUBLIC_KEY,
      nonce: "nonce-browser-2",
      signature: BROWSER_SIGNATURE_AFTER_RELOAD,
    }),
    false
  );
});
