import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RESET_PASSWORD_PATH,
  RESET_RATE_LIMIT_MESSAGE,
  RESET_REQUEST_MESSAGE,
  buildPasswordResetRedirect,
  resolveResetRequestOutcome,
  validateNewPassword,
  MIN_PASSWORD_LENGTH,
} from "./password-reset";

test("reset redirect is absolute, not a bare relative path", () => {
  const url = buildPasswordResetRedirect("https://app.bitxbit.com.au");
  // `new URL` only succeeds on an absolute URL; a relative value would throw.
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
});

test("reset redirect encodes next and points at /auth/callback", () => {
  const url = buildPasswordResetRedirect("https://app.bitxbit.com.au");
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://app.bitxbit.com.au");
  assert.equal(parsed.pathname, "/auth/callback");
  assert.equal(parsed.searchParams.get("next"), RESET_PASSWORD_PATH);
});

test("reset redirect tolerates a trailing slash on the app url", () => {
  const withSlash = buildPasswordResetRedirect("https://app.bitxbit.com.au/");
  const withoutSlash = buildPasswordResetRedirect("https://app.bitxbit.com.au");
  assert.equal(withSlash, withoutSlash);
});

test("the next value is a safe absolute path (no open redirect)", () => {
  const url = buildPasswordResetRedirect("https://app.bitxbit.com.au");
  const next = new URL(url).searchParams.get("next")!;
  assert.ok(next.startsWith("/"), "next must be root-relative");
  assert.ok(!next.startsWith("//"), "next must not be protocol-relative");
  assert.ok(!next.includes("\\"), "next must not contain a backslash");
});

// --- Enumeration safety: the core property ---------------------------------

test("a successful request and an unknown-address error are indistinguishable", () => {
  const success = resolveResetRequestOutcome(null);
  const unknownAddress = resolveResetRequestOutcome({
    status: 400,
    code: "user_not_found",
    message: "User not found",
  });
  assert.deepEqual(success, unknownAddress);
  assert.equal(success.message, RESET_REQUEST_MESSAGE);
});

test("an error whose text names the user is never surfaced", () => {
  // Mutation guard: if the page ever returns error.message, this fails.
  const leaky = resolveResetRequestOutcome({
    status: 422,
    code: "email_exists_error",
    message: "A user with this email address has already been registered",
  });
  assert.equal(leaky.message, RESET_REQUEST_MESSAGE);
  assert.ok(!leaky.message.includes("already been registered"));
});

test("every non-rate-limit error collapses to the one generic message", () => {
  const cases = [
    null,
    undefined,
    { status: 400, message: "User not found" },
    { status: 422, message: "Invalid email" },
    { status: 500, message: "Internal error" },
    { message: "Password is too weak" },
  ];
  for (const error of cases) {
    assert.equal(
      resolveResetRequestOutcome(error).message,
      RESET_REQUEST_MESSAGE,
      `unexpected message for ${JSON.stringify(error)}`
    );
  }
});

test("rate limiting is the only distinguished outcome, and it leaks nothing", () => {
  const limited = resolveResetRequestOutcome({
    status: 429,
    code: "over_email_send_rate_limit",
    message: "Email rate limit exceeded",
  });
  assert.equal(limited.kind, "rate_limited");
  assert.equal(limited.message, RESET_RATE_LIMIT_MESSAGE);

  assert.equal(
    resolveResetRequestOutcome({ code: "over_email_send_rate_limit" }).kind,
    "rate_limited"
  );
  assert.equal(resolveResetRequestOutcome({ status: 429 }).kind, "rate_limited");
  assert.equal(
    resolveResetRequestOutcome({ message: "Email rate limit exceeded" }).kind,
    "rate_limited"
  );
  assert.equal(
    resolveResetRequestOutcome({
      message: "For security purposes, you can only request this once every 60 seconds",
    }).kind,
    "rate_limited"
  );
});

test("rate-limit copy mentions no account state", () => {
  const lower = RESET_RATE_LIMIT_MESSAGE.toLowerCase();
  for (const word of ["account", "exist", "registered", "found"]) {
    assert.ok(!lower.includes(word), `rate-limit copy must not contain "${word}"`);
  }
});

// --- New-password validation ------------------------------------------------

test("a short password is rejected regardless of confirmation", () => {
  const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
  assert.match(validateNewPassword(short, short) ?? "", /at least/);
});

test("mismatched passwords are rejected", () => {
  assert.match(
    validateNewPassword("correct-horse", "correct-horse-battery") ?? "",
    /do not match/
  );
});

test("an acceptable password returns null", () => {
  assert.equal(validateNewPassword("correct-horse", "correct-horse"), null);
});
