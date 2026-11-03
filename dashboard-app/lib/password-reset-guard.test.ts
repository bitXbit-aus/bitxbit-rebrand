import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Structural guard for the recovery-intent marker.
//
// Background, because these assertions look fussy without it.
//
// `/auth/reset-password` used to check only that *a* session existed, and the form
// changed the password from the browser with `supabase.auth.updateUser`. Wallet
// sign-in mints an ordinary session through the passwordless plumbing, and was
// measured (2026-11-03, staging) to be the same session CLASS as a genuine recovery
// session — `amr=[{"method":"otp"}]` — with the password change accepted by the
// provider even though production has
// `security_update_password_require_current_password` and
// `..._require_reauthentication` both ON:
//
//   * the current-password check is SKIPPED when `session.IsRecovery()` is true,
//     which covers `otp`, `magiclink` and `recovery` sessions;
//   * the reauthentication check only asks for a nonce when the session is older
//     than 24 hours.
//
// So a held wallet key could set an email password: the wallet became a recovery
// credential. The fix binds the INTENT ("this session arrived via a reset link")
// with an HMAC marker set by `/auth/callback`, verified in the Server Action.
//
// Two properties make the difference between a fix and a gesture, and both are
// asserted here because neither is visible to tsc, the build, or CI:
//
//   1. THE ENFORCEMENT IS SERVER-SIDE. A check in the page or the client component
//      only decides what to render; anyone with a session can post to the auth
//      endpoint directly. If `updateUser` reappears in the client form, the guard
//      is decoration.
//   2. THE MARKER IS VERIFIED BEFORE THE PASSWORD IS TOUCHED. Order matters: a
//      verification that happens after the write has authorised nothing.
//
// The cryptographic behaviour itself (wrong user, tampering, expiry, key) is tested
// behaviourally in password-reset-marker.test.ts. These are the wiring assertions.

const APP_ROOT = join(__dirname, "..");

const read = (...parts: string[]) => readFileSync(join(APP_ROOT, ...parts), "utf8");

const callback = read("app", "auth", "callback", "route.ts");
const page = read("app", "auth", "reset-password", "page.tsx");
const action = read("app", "auth", "reset-password", "actions.ts");
const form = read("app", "auth", "reset-password", "reset-password-form.tsx");

test("the client form does NOT change the password itself", () => {
  // The regression that matters most: client-side updateUser cannot be guarded
  // server-side at all.
  //
  // Matched as a CALL, not as a bare word: the comment above explains the history
  // and legitimately contains the identifier, so a word-shaped assertion would fail
  // on prose and — worse — a future prose-only edit could make it pass while the
  // call returned.
  assert.equal(
    /\bupdateUser\s*\(/.test(form),
    false,
    "the reset form must not call updateUser — the password change belongs in the Server Action, " +
      "where the marker can be verified on the server"
  );
  assert.equal(
    /from\s+["']@\/lib\/supabase\/client["']/.test(form),
    false,
    "the reset form must not import the browser Supabase client; the password change no longer happens in the browser"
  );
  assert.match(form, /useActionState/, "the form must submit through the Server Action");
});

test("the Server Action verifies the marker BEFORE it changes the password", () => {
  const verifyAt = action.indexOf("verifyResetMarker(");
  const updateAt = action.indexOf("updateUser(");
  assert.notEqual(verifyAt, -1, "the action must verify the marker");
  assert.notEqual(updateAt, -1, "the action must be the thing that changes the password");
  assert.ok(
    verifyAt < updateAt,
    "the marker must be verified before updateUser is called — a check after the write authorises nothing"
  );
  assert.match(action, /^"use server";/, "the action file must be a Server Action");
  // The verification must be the guard's own condition. Asserting only that the call
  // is PRESENT would pass for `if (false && !verifyResetMarker(...))` — a neutered
  // guard that reads as enforced.
  assert.match(
    action,
    /if \(!verifyResetMarker\(/,
    "the marker verification must be the direct condition of the refusal"
  );
  assert.match(
    action,
    /return \{ error: RESET_NOT_AUTHORISED_MESSAGE \}/,
    "a missing/invalid marker must return the refusal, not fall through"
  );
});

test("the reset page requires the marker and does not render the form without it", () => {
  const verifyAt = page.indexOf("verifyResetMarker(");
  const renderAt = page.indexOf("<ResetPasswordForm");
  assert.notEqual(verifyAt, -1, "the page must verify the marker");
  assert.ok(
    verifyAt < renderAt,
    "the page must verify the marker before rendering the form"
  );
  assert.match(page, /redirect\("\/auth\/login\?error=reset_required"\)/);
  assert.match(
    page,
    /if \(!verifyResetMarker\(/,
    "the page's marker verification must be the direct condition of its redirect"
  );
});

test("the callback sets the marker ONLY for the reset path", () => {
  const conditionAt = callback.indexOf("next === RESET_PASSWORD_PATH");
  const setAt = callback.indexOf("response.cookies.set(");
  assert.notEqual(conditionAt, -1, "the callback must gate the marker on the sanitised next path");
  assert.notEqual(setAt, -1, "the callback must set the marker");
  assert.ok(
    conditionAt < setAt,
    "the cookie write must sit inside the path condition, not beside it"
  );
  // `next` must be the sanitised value, never the raw query string.
  assert.equal(
    /cookies\.set\([^)]*searchParams/.test(callback),
    false,
    "the marker must key off the sanitised next, not the raw query parameter"
  );
});

test("the marker cookie is httpOnly and scoped to the page that consumes it", () => {
  assert.match(callback, /httpOnly:\s*true/);
  assert.match(callback, /path:\s*RESET_PASSWORD_PATH/);
  assert.match(callback, /sameSite:\s*"lax"/);
  // A marker that outlives the flow is a standing authorisation to set a password.
  assert.match(callback, /maxAge/, "the marker must expire");
});

test("the marker is spent after use, deleted with the path it was written with", () => {
  // `cookies().delete(name)` targets "/" by default, which does NOT remove a cookie
  // scoped to /auth/reset-password — a silent no-op that leaves a live marker.
  assert.match(
    action,
    /delete\(\{\s*name:\s*PASSWORD_RESET_COOKIE,\s*path:\s*RESET_PASSWORD_PATH\s*\}\)/,
    "the delete must name the same path the cookie was set with, or it removes nothing"
  );
});

test("there is exactly ONE definition of the reset path", () => {
  // Two copies of a security-relevant constant are two chances to disagree, and the
  // failure mode is a marker issued for one path being honoured on another.
  const resetLib = read("lib", "password-reset.ts");
  const markerLib = read("lib", "password-reset-marker.ts");
  assert.match(resetLib, /export const RESET_PASSWORD_PATH = "\/auth\/reset-password"/);
  assert.equal(
    /export const RESET_PASSWORD_PATH\s*=/.test(markerLib),
    false,
    "password-reset-marker.ts must re-export the path, not redefine it"
  );
  assert.match(markerLib, /export \{ RESET_PASSWORD_PATH \}/);
});
