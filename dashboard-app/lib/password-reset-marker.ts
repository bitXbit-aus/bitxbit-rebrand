/**
 * Password-reset **intent** marker.
 *
 * ## The defect this closes
 *
 * `/auth/reset-password` used to check only that *a* session existed, and the form
 * called `supabase.auth.updateUser({ password })` from the browser. A wallet
 * sign-in mints an ordinary session — `/api/auth/wallet/verify` reuses the
 * project's passwordless plumbing (`generateLink({ type: "magiclink" })` then
 * `verifyOtp`), so a wallet session is the same *class* of session as a
 * magic-link one.
 *
 * Measured against the provider (2026-11-03, staging): a wallet-class session
 * carried `amr=[{"method":"otp"}]` — **identical to a genuine recovery session**
 * and different from a password session — and a `PUT /auth/v1/user` with no
 * `current_password` and no nonce changed the password. Verified by password
 * grant: the new password was accepted and the old one rejected.
 *
 * That means a held wallet key could set an email password, which makes the wallet
 * a full recovery credential — the opposite of what the security documentation
 * claimed, and a promotion of sign-in into account takeover.
 *
 * ## Why the provider's own controls do not cover it
 *
 * Production has `security_update_password_require_current_password` and
 * `..._require_reauthentication` both ON, and neither helps here:
 *
 * - the current-password check is **skipped when `session.IsRecovery()` is true**,
 *   which is true for `otp`, `magiclink` and `recovery` sessions — exactly the
 *   class the wallet flow mints;
 * - the reauthentication check only asks for a nonce when the session is **older
 *   than 24 hours**, so a freshly minted wallet session is exempt.
 *
 * Staging has both settings OFF, so staging cannot detect this class at all —
 * which is the second reason the guard has to live in the application.
 *
 * ## The shape of the fix, and the one thing it cannot be
 *
 * The marker binds the **intent** — "this session arrived by following a password
 * reset link" — to the user it was issued for. `/auth/callback` sets it, and only
 * when the sanitised `next` is exactly `/auth/reset-password`; the page requires it
 * to render the form, and the Server Action re-verifies it before touching the
 * password, because a page-level check alone is bypassable by calling the API.
 *
 * It deliberately does **not** key on the session class. The measured `amr` of a
 * genuine recovery session is `otp`, the same as the wallet session's, so
 * "require `amr.method === 'recovery'`" would break the very flow it was meant to
 * protect. Intent, not class, is the discriminator that actually exists.
 *
 * ## Key
 *
 * Prefers a dedicated `PASSWORD_RESET_MARKER_SECRET` and falls back to
 * `SUPABASE_SERVICE_ROLE_KEY`, which is server-only and present in every context.
 * HMAC-SHA256 with a high-entropy key is safe for this use (no length-extension
 * exposure), and the fallback avoids adding a deployment dependency that would
 * break the live reset flow between merge and configuration. **Fails closed**: no
 * key means no marker verifies.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { RESET_PASSWORD_PATH } from "./password-reset";

/** Cookie carrying the marker. Scoped to the page that uses it. */
export const PASSWORD_RESET_COOKIE = "bx_pwreset";

/** Long enough for a user to choose a password, short enough to be harmless. */
export const RESET_MARKER_TTL_SECONDS = 1800;

/** Bump only with a matching change to the payload shape. */
const MARKER_VERSION = "v1";

/**
 * The path the marker authorises, compared against the sanitised `next`.
 *
 * Re-exported rather than redefined: two copies of a security-relevant constant
 * are two chances for them to disagree, and the failure mode is a marker issued
 * for one path being honoured on another.
 */
export { RESET_PASSWORD_PATH };

export interface MarkerEnv {
  PASSWORD_RESET_MARKER_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/**
 * Resolve the signing key. Empty string means "no key", which every verifier
 * treats as a refusal rather than as a wildcard.
 */
export function resetMarkerKey(env: MarkerEnv = process.env as MarkerEnv): string {
  return env.PASSWORD_RESET_MARKER_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function sign(userId: string, expiresAt: number, key: string): string {
  return createHmac("sha256", key)
    .update(`${MARKER_VERSION}.${userId}.${expiresAt}`)
    .digest("hex");
}

/**
 * Build the cookie value for a user. `now` is injected so the TTL is testable
 * without clock manipulation.
 */
export function createResetMarker(
  userId: string,
  key: string,
  now: number = Date.now()
): { value: string; maxAge: number } {
  const expiresAt = Math.floor(now / 1000) + RESET_MARKER_TTL_SECONDS;
  return {
    value: `${MARKER_VERSION}.${expiresAt}.${sign(userId, expiresAt, key)}`,
    maxAge: RESET_MARKER_TTL_SECONDS,
  };
}

/**
 * Verify a cookie value against the user it must belong to.
 *
 * Every failure is a plain `false`: absent, malformed, wrong version, expired,
 * wrong user, or wrong key. The comparison is timing-safe, and the length is
 * checked first because `timingSafeEqual` throws on a length mismatch — a throw
 * here would surface as a 500 rather than a refusal.
 */
export function verifyResetMarker(
  value: string | undefined | null,
  userId: string,
  key: string,
  now: number = Date.now()
): boolean {
  if (!key) return false;
  if (!value || !userId) return false;

  const parts = value.split(".");
  if (parts.length !== 3) return false;

  const [version, expiresRaw, provided] = parts;
  if (version !== MARKER_VERSION) return false;

  if (!/^\d+$/.test(expiresRaw)) return false;
  const expiresAt = Number(expiresRaw);
  if (expiresAt * 1000 <= now) return false;

  const expected = sign(userId, expiresAt, key);
  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    // A non-hex value of the right length still reaches here.
    return false;
  }
}
