/**
 * Device-bound key — the server half of the closure of R-021 (design §4).
 *
 * Design: `docs/security/wallet-step-up-design.md` §4. Storage: the `public_key`
 * column reserved in migration 029 — **no new migration.**
 *
 * ## Why this closes the risk
 *
 * Part 1 raised the attack from one deception to two: the victim can still be
 * talked into relaying the emailed **code**. Part 2 removes the second thing they
 * could give away. At enrolment the browser generates an **ECDSA P-256 key with
 * `extractable: false`** and keeps the private key in IndexedDB; only the public
 * key is registered. The private key can be *used* by our origin's JavaScript but
 * cannot be *read* by any script, ours included — so there is no form the victim
 * can read out, paste, or type. The relay's second act stops existing rather than
 * getting harder.
 *
 * ## Deviation from the design doc, recorded
 *
 * §4 sketches a separate `POST /api/auth/wallet/device-challenge` endpoint issuing
 * its own nonce, with a table to hold it. **Not built that way, deliberately.** The
 * device key signs the **existing sign-in challenge nonce** instead. That nonce is
 * already fresh, TTL'd (300 s), single-use, and consumed by `verify_wallet_signin`
 * — so replay protection is inherited rather than re-implemented, and no table,
 * RPC or migration is required. The security property is identical: the attacker
 * relaying a wallet signature still has no device key, so it still cannot complete.
 * What is given up is an independent rate-limit/freshness boundary for the device
 * factor alone; the challenge endpoint's own limit covers issuance.
 *
 * ## The one implementation trap
 *
 * **WebCrypto emits ECDSA signatures as raw `r || s` (IEEE P-1363); Node's
 * `crypto.verify` expects DER unless told otherwise.** For P-256 the raw form is
 * exactly 64 bytes. Omitting `dsaEncoding` does not fail loudly — it makes every
 * *genuine* signature fail to verify, which would present as "the device key never
 * works". `DEVICE_SIGNATURE_ENCODING` below is load-bearing, and the tests assert
 * the positive direction (a real WebCrypto signature must verify) rather than only
 * the negative cases.
 *
 * ## Kept pure on purpose
 *
 * No `next/*`, no `server-only`, no database. Verification is a value
 * transformation, so it is unit-testable and cannot hide behind a framework import.
 */

import { createPublicKey, verify as cryptoVerify, type JsonWebKey as NodeJsonWebKey } from "crypto";

/** WebCrypto's raw `r || s` form. Setting this is the difference between working and not. */
export const DEVICE_SIGNATURE_ENCODING = "ieee-p1363" as const;

export const DEVICE_KEY_ALGORITHM = "ECDSA";
export const DEVICE_KEY_CURVE = "P-256";

/** P-256 raw signature: 32-byte r concatenated with 32-byte s. */
export const DEVICE_SIGNATURE_BYTES = 64;

/** A P-256 coordinate is 32 bytes. */
const COORDINATE_BYTES = 32;

export type DevicePublicKeyProblem =
  | "not_json"
  | "not_object"
  | "wrong_kty"
  | "wrong_crv"
  | "missing_coordinate"
  | "wrong_coordinate_length"
  | "private_material_present";

export interface DevicePublicKeyJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export type DevicePublicKeyResult =
  | { ok: true; jwk: DevicePublicKeyJwk; canonical: string }
  | { ok: false; problem: DevicePublicKeyProblem };

/** Strict base64url. `Buffer.from` silently ignores invalid characters, so pre-check. */
function decodeBase64Url(value: unknown): Buffer | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const buf = Buffer.from(value, "base64url");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Validates a JWK handed in by a browser at enrolment.
 *
 * The value is client-supplied and is stored, so it is validated by **shape and
 * curve** and nothing else is trusted. In particular `d` is refused outright: a JWK
 * carrying private material is either a mistake or an attempt to register something
 * the server can sign with, and neither belongs in a column read on every sign-in.
 */
export function parseDevicePublicKey(raw: unknown): DevicePublicKeyResult {
  let parsed: unknown;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, problem: "not_json" };
    }
  } else {
    parsed = raw;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problem: "not_object" };
  }
  const jwk = parsed as Record<string, unknown>;

  // A private key must never be accepted. Checked before anything else so the
  // reason is unambiguous in a log.
  if ("d" in jwk) return { ok: false, problem: "private_material_present" };

  if (jwk.kty !== "EC") return { ok: false, problem: "wrong_kty" };
  if (jwk.crv !== DEVICE_KEY_CURVE) return { ok: false, problem: "wrong_crv" };

  const x = jwk.x;
  const y = jwk.y;
  if (typeof x !== "string" || typeof y !== "string") {
    return { ok: false, problem: "missing_coordinate" };
  }

  const xBytes = decodeBase64Url(x);
  const yBytes = decodeBase64Url(y);
  if (!xBytes || !yBytes) return { ok: false, problem: "wrong_coordinate_length" };
  if (xBytes.length !== COORDINATE_BYTES || yBytes.length !== COORDINATE_BYTES) {
    return { ok: false, problem: "wrong_coordinate_length" };
  }

  const canonicalJwk: DevicePublicKeyJwk = {
    kty: "EC",
    crv: DEVICE_KEY_CURVE,
    x,
    y,
  };

  return {
    ok: true,
    jwk: canonicalJwk,
    // Canonical form stored in `public_key`, so the column holds a value this
    // module produced rather than whatever bytes arrived.
    canonical: JSON.stringify(canonicalJwk),
  };
}

/**
 * Verifies a device signature over a nonce.
 *
 * Every failure returns `false` — never throws. A thrown verification failure in a
 * route handler is indistinguishable from a server fault, and this is a gate: it
 * must refuse, legibly, by whichever branch.
 */
export function verifyDeviceSignature(params: {
  publicKey: string;
  nonce: string;
  signature: string;
}): boolean {
  const { publicKey, nonce, signature } = params;

  if (!publicKey || !nonce) return false;

  const parsedKey = parseDevicePublicKey(publicKey);
  if (!parsedKey.ok) return false;

  const signatureBytes = decodeBase64Url(signature);
  if (!signatureBytes) return false;
  // Reject before handing anything to the verifier: a wrong-length buffer cannot be
  // a P-256 `r || s`, and Node would otherwise have to be trusted to reject it.
  if (signatureBytes.length !== DEVICE_SIGNATURE_BYTES) return false;

  try {
    // `createPublicKey` wants Node's own JsonWebKey type; ours is the validated
    // subset (kty/crv/x/y, no private material), so the cast is the safe direction.
    const key = createPublicKey({ key: parsedKey.jwk as unknown as NodeJsonWebKey, format: "jwk" });
    return cryptoVerify(
      "sha256",
      Buffer.from(nonce, "utf8"),
      { key, dsaEncoding: DEVICE_SIGNATURE_ENCODING },
      signatureBytes
    );
  } catch {
    // An unusable stored key (corrupt row, unexpected curve) refuses; it does not
    // crash a sign-in request.
    return false;
  }
}

/**
 * A trusted device row is only usable as a device-bound factor when it actually
 * holds a key. A row without one — every device enrolled before Part 2, and every
 * row where enrolment's key registration failed — must **step up** instead, which
 * is the safe direction: it costs a code, it does not mint a session.
 */
export function deviceKeyRegistered(publicKey: string | null | undefined): boolean {
  return typeof publicKey === "string" && publicKey.length > 0;
}
