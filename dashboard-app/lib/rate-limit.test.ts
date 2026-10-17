import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, getClientIdentifier } from "./rate-limit";

function makeRequest(headers: Record<string, string>, ip?: string): any {
  return {
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    ip: ip ?? null,
  };
}

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

describe("client identifier", () => {
  it("prefers the Netlify trusted client IP header", () => {
    const req = makeRequest(
      {
        "x-nf-client-connection-ip": "1.2.3.4",
        "x-forwarded-for": "9.9.9.9",
      },
      "7.7.7.7"
    );
    assert.equal(getClientIdentifier(req as any), "1.2.3.4");
  });

  it("uses X-Forwarded-For only when TRUST_PROXY is enabled", () => {
    process.env.TRUST_PROXY = "true";
    const req = makeRequest({ "x-forwarded-for": "5.5.5.5, 6.6.6.6" }, "7.7.7.7");
    assert.equal(getClientIdentifier(req as any), "5.5.5.5");
    delete process.env.TRUST_PROXY;
  });

  it("falls back to request.ip when proxy headers are untrusted", () => {
    delete process.env.TRUST_PROXY;
    const req = makeRequest({ "x-forwarded-for": "5.5.5.5" }, "7.7.7.7");
    assert.equal(getClientIdentifier(req as any), "7.7.7.7");
  });

  it("returns anonymous when no IP is available", () => {
    delete process.env.TRUST_PROXY;
    const req = makeRequest({});
    assert.equal(getClientIdentifier(req as any), "anonymous");
  });
});
