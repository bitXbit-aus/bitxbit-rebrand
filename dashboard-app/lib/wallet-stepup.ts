/**
 * Wallet step-up — the pure half (R-021 prevention, Part 1).
 *
 * Design: `docs/security/wallet-step-up-design.md`. Persistence: migration 029.
 *
 * ## What this decides
 *
 * A wallet signature is not enough to mint a session any more. It is enough only on
 * a device the account has already proved itself on; an unrecognised device must
 * first complete a code sent to the account's email.
 *
 * ## The security argument, in one line
 *
 * The code must be presented by the browser that is signing in — never as an
 * out-of-band "approve" action. An approval link would let the *victim* authorise
 * the *attacker's* pending attempt, because the attacker's browser is the one
 * waiting for a session.
 *
 * ## Kept pure on purpose
 *
 * No `next/*`, no `server-only`, no database: every function here is a value
 * transformation, so the security-relevant behaviour is unit-testable and cannot
 * hide behind a framework import. The routes do the I/O.
 */

import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";

/** Browser handle for device trust. Opaque — it carries no identity. */
export const DEVICE_COOKIE = "bx_wallet_device";

/** 90 days, per D2. Long enough to be invisible, short enough to age out. */
export const DEVICE_TTL_SECONDS = 90 * 24 * 60 * 60;

/** Matches the order of magnitude of the 300 s sign-in challenge. */
export const STEPUP_CODE_TTL_SECONDS = 600;

/** Enforced in SQL, restated here so the caller can describe it accurately. */
export const STEPUP_MAX_ATTEMPTS = 5;

export const STEPUP_CODE_LENGTH = 6;

export interface StepUpEnv {
  STEPUP_HMAC_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/**
 * Signing key for the code HMAC. Falls back to the service-role key, which is
 * server-only and present in every context, so the flow does not break between
 * merge and configuration. **Empty means no key, and every caller must treat that
 * as a refusal** — never as a wildcard.
 */
export function stepUpKey(env: StepUpEnv = process.env as StepUpEnv): string {
  return env.STEPUP_HMAC_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "";
}

/** 32 random bytes, base64url. ~256 bits of entropy. */
export function newDeviceId(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What is stored for a device. Hashing rather than signing: the cookie is a random
 * handle and the account binding lives in the row, so a signature would add nothing
 * — and it would make revocation impossible.
 */
export function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex");
}

/**
 * A 6-digit code, drawn from a CSPRNG.
 *
 * `randomInt` rather than `Math.random` — the code is a credential, and a
 * predictable one would be guessable regardless of the attempt limit.
 */
export function generateStepUpCode(): string {
  return String(randomInt(0, 10 ** STEPUP_CODE_LENGTH)).padStart(STEPUP_CODE_LENGTH, "0");
}

/**
 * HMAC, not a bare hash. Ten to the sixth candidate codes is a lookup table, so a
 * bare SHA-256 of the code would be reversible by anyone who read the database —
 * the key is what makes the stored value opaque.
 */
export function hashStepUpCode(code: string, key: string): string {
  if (!key) return "";
  return createHmac("sha256", key).update(code).digest("hex");
}

/**
 * Constant-time comparison for a stored HMAC against a candidate.
 *
 * Length is checked first because `timingSafeEqual` throws on a mismatch — a throw
 * here would surface as a 500 rather than as a refusal. (The SQL also compares the
 * values; that comparison is the one the attempt budget bounds. This one exists so
 * the decision is not made on a value the database echoed back.)
 */
export function stepUpCodeMatches(candidate: string, stored: string, key: string): boolean {
  if (!key || !candidate || !stored) return false;
  const expected = hashStepUpCode(candidate, key);
  if (expected.length !== stored.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(stored, "hex"));
  } catch {
    return false;
  }
}

/** Mirrors the statuses returned by `complete_wallet_stepup` (migration 029). */
export type StepUpStatus =
  | "not_found"
  | "consumed"
  | "expired"
  | "exhausted"
  | "invalid_code"
  | "ok";

/** Anything unrecognised is treated as a refusal, never as a success. */
export function parseStepUpStatus(value: unknown): StepUpStatus {
  switch (value) {
    case "ok":
    case "not_found":
    case "consumed":
    case "expired":
    case "exhausted":
    case "invalid_code":
      return value;
    default:
      return "not_found";
  }
}

/**
 * A short, human label for a device row. Deliberately coarse: a full user agent is
 * long, noisy, and would put more identifying detail in front of a member than
 * helps them recognise their own device.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").slice(0, 300);
  if (!ua) return "Unknown browser";

  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";

  const platform =
    /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Macintosh|Mac OS X/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : "";

  return platform ? `${browser} on ${platform}` : browser;
}

/**
 * A masked hint of where the code went, e.g. `m•••@protonmail.com`.
 *
 * Shown to a caller who has proved wallet control but not yet the second factor, so
 * it must not disclose more than enough to recognise the inbox. The local part is
 * masked; the domain is kept, because "which address is this going to?" is the
 * question the hint exists to answer.
 */
export function emailHint(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(1, Math.min(local.length - 1, 4)))}@${domain}`;
}

/** Cookie attributes for the device handle. */
export function deviceCookieOptions(maxAge: number = DEVICE_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
