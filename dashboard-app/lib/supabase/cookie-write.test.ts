import assert from "node:assert/strict";
import test from "node:test";

import {
  handleServerCookieWriteError,
  isReadOnlyServerComponentCookieError,
} from "./cookie-write";

test("recognises Next's read-only Server Component cookie error", () => {
  const error = new Error(
    "Cookies can only be modified in a Server Action or Route Handler. Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options"
  );
  error.name = "ReadonlyRequestCookiesError";

  assert.equal(isReadOnlyServerComponentCookieError(error), true);
  assert.doesNotThrow(() => handleServerCookieWriteError(error));
});

test("recognises the real error thrown by the pinned Next.js runtime", () => {
  // Import the runtime class itself: a synthetic message-only test would not catch
  // a mismatch between our classifier and the pinned Next.js implementation.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ReadonlyRequestCookiesError } = require(
    "next/dist/server/web/spec-extension/adapters/request-cookies"
  );

  let actual: unknown;
  try {
    ReadonlyRequestCookiesError.callable();
  } catch (error) {
    actual = error;
  }

  assert.ok(actual instanceof Error);
  assert.equal(isReadOnlyServerComponentCookieError(actual), true);
  assert.doesNotThrow(() => handleServerCookieWriteError(actual));
});

test("does not classify unrelated cookie failures as render-time read-only errors", () => {
  const error = new Error("cookie header exceeds the platform limit");

  assert.equal(isReadOnlyServerComponentCookieError(error), false);
  assert.throws(() => handleServerCookieWriteError(error), error);
});

test("rethrows non-Error failures too", () => {
  assert.equal(isReadOnlyServerComponentCookieError("write failed"), false);
  assert.throws(
    () => handleServerCookieWriteError("write failed"),
    (error) => error === "write failed"
  );
});