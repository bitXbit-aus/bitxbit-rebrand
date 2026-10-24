import assert from "node:assert/strict";
import test from "node:test";

import { safeAuthNextPath } from "./auth-redirect";

test("accepts same-origin application paths", () => {
  assert.equal(safeAuthNextPath("/dashboard"), "/dashboard");
  assert.equal(safeAuthNextPath("/dashboard/offers?page=2#active"), "/dashboard/offers?page=2#active");
});

test("defaults absent and non-path destinations", () => {
  assert.equal(safeAuthNextPath(null), "/dashboard");
  assert.equal(safeAuthNextPath("@evil.example"), "/dashboard");
  assert.equal(safeAuthNextPath("https://evil.example"), "/dashboard");
});

test("rejects protocol-relative and backslash-normalised external redirects", () => {
  assert.equal(safeAuthNextPath("//evil.example/path"), "/dashboard");
  assert.equal(safeAuthNextPath("/\\evil.example/path"), "/dashboard");
});