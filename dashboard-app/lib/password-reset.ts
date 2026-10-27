/**
 * Password-recovery helpers.
 *
 * Recovery is part of auth, not an extra: seven of the eight production accounts
 * sign in with a password, and before this route existed a forgotten password
 * locked a member out permanently (there was no reset path at all).
 *
 * Two properties are load-bearing here and are unit-tested, because both are
 * invisible to a build, a type-check or a green CI run:
 *
 * 1. **Enumeration safety.** The response shown to a caller must be identical
 *    whether or not the address has an account. GoTrue already returns no error
 *    for an unknown email, but a page that surfaces `error.message` would turn
 *    any future error that names the user into an account-existence oracle — so
 *    every non-rate-limit outcome maps to one generic message.
 * 2. **One host allowlist.** The recovery link is routed through the existing
 *    `/auth/callback` (which reuses `safeAuthNextPath` and the deployment host
 *    policy) rather than a second callback that could drift from it.
 */

/** The single generic outcome. Identical for a real address and an unknown one. */
export const RESET_REQUEST_MESSAGE =
  "If an account exists for that email address, a password reset link is on its way. Check your inbox and your spam folder.";

/**
 * The only message that is allowed to differ. A rate-limit signal says nothing
 * about whether the address exists, so surfacing it does not leak membership —
 * and it is more honest than a silent success that will never arrive.
 */
export const RESET_RATE_LIMIT_MESSAGE =
  "Too many password reset requests from this connection. Please wait a few minutes and try again.";

/** The subset of a Supabase auth error this logic judges on. */
export interface ResetErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

/**
 * Build the redirect target for the recovery email.
 *
 * Points at `/auth/callback?next=/auth/reset-password`: the callback exchanges
 * the recovery code for a session, validates the deployment host, and only then
 * continues to `next`. `next` is a constant here and is re-validated by
 * `safeAuthNextPath` on arrival, so it cannot be used as an open redirect.
 */
export function buildPasswordResetRedirect(appUrl: string): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/auth/callback?next=${encodeURIComponent(RESET_PASSWORD_PATH)}`;
}

/** The page the recovery link ultimately lands on. */
export const RESET_PASSWORD_PATH = "/auth/reset-password";

function isRateLimited(error: ResetErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 429) return true;
  if (error.code === "over_email_send_rate_limit") return true;
  // GoTrue surfaces the rate limit either as `code` or in the message, and the
  // code uses underscores ("over_email_send_rate_limit") while the message uses
  // spaces ("Email rate limit exceeded") — normalise before matching so both
  // spellings are recognised.
  const text = `${error.code ?? ""} ${error.message ?? ""}`.replace(/_/g, " ");
  return /rate limit|too many|security purposes/i.test(text);
}

export interface ResetRequestOutcome {
  kind: "requested" | "rate_limited";
  message: string;
}

/**
 * Decide what the user is told after requesting a reset.
 *
 * ANY non-rate-limit error — including one that names the user, e.g.
 * "User not found" — maps to the same generic message. That is the whole point:
 * the error text must never reach the caller, or the page becomes an oracle for
 * "does this address have an account?".
 */
export function resolveResetRequestOutcome(
  error?: ResetErrorLike | null
): ResetRequestOutcome {
  if (isRateLimited(error)) {
    return { kind: "rate_limited", message: RESET_RATE_LIMIT_MESSAGE };
  }
  return { kind: "requested", message: RESET_REQUEST_MESSAGE };
}

/** Client-side minimum for a NEW password. Mirrors the reset form copy. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Validate a new password before calling `updateUser`. Returns an error string,
 * or null when acceptable. Kept pure so it is unit-testable.
 */
export function validateNewPassword(
  password: string,
  confirmation: string
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmation) {
    return "The two passwords do not match.";
  }
  return null;
}
