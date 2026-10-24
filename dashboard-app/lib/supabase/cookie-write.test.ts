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