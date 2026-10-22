import assert from "node:assert/strict";
import test from "node:test";

import { actionError } from "./action-result";

// The contract these tests defend: an action that returns nothing is a SUCCESS,
// and only a truthy `error` field is a refusal. Getting this backwards would make
// every existing form in the app either silently report success on a refusal, or
// report an error on an ordinary save.

test("undefined (the existing convention) is success", () => {
  assert.equal(actionError(undefined), null);
});

test("null is success", () => {
  assert.equal(actionError(null), null);
});

test("an object with no error field is success", () => {
  assert.equal(actionError({}), null);
  assert.equal(actionError({ success: true }), null);
});

test("a non-object return is success", () => {
  assert.equal(actionError("something"), null);
  assert.equal(actionError(42), null);
  assert.equal(actionError(true), null);
  assert.equal(actionError([]), null);
});

test("an empty or falsy error is NOT a refusal", () => {
  // Without this, `{ error: "" }` would raise a destructive toast with no text,
  // and `{ error: null }` would turn every successful call into a failure.
  assert.equal(actionError({ error: "" }), null);
  assert.equal(actionError({ error: null }), null);
  assert.equal(actionError({ error: undefined }), null);
  assert.equal(actionError({ error: 0 }), null);
  assert.equal(actionError({ error: false }), null);
});

test("a populated error is returned verbatim", () => {
  assert.equal(
    actionError({ error: "Test airdrops are disabled in this environment by the Phase 1 safety guard." }),
    "Test airdrops are disabled in this environment by the Phase 1 safety guard."
  );
});

test("a non-string error is stringified rather than dropped", () => {
  assert.equal(actionError({ error: 503 }), "503");
  assert.equal(actionError({ error: new Error("boom") }), "Error: boom");
});

test("error alongside success still reports the error", () => {
  // A refusal must never be masked by a success flag on the same object.
  assert.equal(actionError({ success: true, error: "refused" }), "refused");
});
