import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "./rate-limit";

describe("rate limiting", () => {
  const options = {
    windowMs: 60_000,
    maxRequests: 3,
    keyPrefix: "test",
  };

  beforeEach(() => {
    // Clear the in-memory store via module reset is not possible without loader hooks;
    // use unique keys per test instead.
  });

  it("allows requests up to the limit and then blocks", () => {
    const key = `rate-limit-test-${Date.now()}`;
    const first = checkRateLimit(key, options);
    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 2);

    const second = checkRateLimit(key, options);
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 1);

    const third = checkRateLimit(key, options);
    assert.equal(third.allowed, true);
    assert.equal(third.remaining, 0);

    const fourth = checkRateLimit(key, options);
    assert.equal(fourth.allowed, false);
    assert.equal(fourth.remaining, 0);
  });

  it("tracks different identifiers independently", () => {
    const now = Date.now();
    const a = checkRateLimit(`a-${now}`, options);
    const b = checkRateLimit(`b-${now}`, options);
    assert.equal(a.allowed, true);
    assert.equal(b.allowed, true);
  });

  it("resets the counter after the window expires", async () => {
    const key = `rate-limit-reset-${Date.now()}`;
    const shortWindow = { ...options, windowMs: 10 };

    checkRateLimit(key, shortWindow);
    checkRateLimit(key, shortWindow);
    checkRateLimit(key, shortWindow);

    const blocked = checkRateLimit(key, shortWindow);
    assert.equal(blocked.allowed, false);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const reset = checkRateLimit(key, shortWindow);
    assert.equal(reset.allowed, true);
  });
});
