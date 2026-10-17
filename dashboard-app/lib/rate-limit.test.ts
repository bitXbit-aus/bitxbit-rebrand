import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  getClientIdentifier,
  setRateLimitStore,
} from "./rate-limit";
import { MemoryRateLimitStore, RateLimitResult, RateLimitStore } from "./rate-limit-store";

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
    // Isolate each test to a fresh in-memory store.
    setRateLimitStore(new MemoryRateLimitStore());
  });

  it("allows requests up to the limit and then blocks", async () => {
    const key = `rate-limit-test-${Date.now()}`;
    const first = await checkRateLimit(key, options);
    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 2);

    const second = await checkRateLimit(key, options);
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 1);

    const third = await checkRateLimit(key, options);
    assert.equal(third.allowed, true);
    assert.equal(third.remaining, 0);

    const fourth = await checkRateLimit(key, options);
    assert.equal(fourth.allowed, false);
    assert.equal(fourth.remaining, 0);
  });

  it("tracks different identifiers independently", async () => {
    const now = Date.now();
    const a = await checkRateLimit(`a-${now}`, options);
    const b = await checkRateLimit(`b-${now}`, options);
    assert.equal(a.allowed, true);
    assert.equal(b.allowed, true);
  });

  it("resets the counter after the window expires", async () => {
    const key = `rate-limit-reset-${Date.now()}`;
    const shortWindow = { ...options, windowMs: 10 };

    await checkRateLimit(key, shortWindow);
    await checkRateLimit(key, shortWindow);
    await checkRateLimit(key, shortWindow);

    const blocked = await checkRateLimit(key, shortWindow);
    assert.equal(blocked.allowed, false);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const reset = await checkRateLimit(key, shortWindow);
    assert.equal(reset.allowed, true);
  });

  it("uses the configured shared store across calls", async () => {
    // A fake shared store proves that checkRateLimit delegates to the store
    // abstraction rather than a hard-coded in-memory map.
    let capturedKey: string | undefined;
    const fakeStore: RateLimitStore = {
      async increment(
        key: string,
        _windowMs: number,
        _maxRequests: number
      ): Promise<RateLimitResult> {
        capturedKey = key;
        return { allowed: true, remaining: 7, resetAt: Date.now() + 1000 };
      },
    };
    setRateLimitStore(fakeStore);

    const result = await checkRateLimit("shared-client", options);
    assert.equal(capturedKey, "test:shared-client");
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 7);
  });
});

describe("MemoryRateLimitStore", () => {
  it("allows increments up to the limit and then blocks", async () => {
    const store = new MemoryRateLimitStore();
    const r1 = await store.increment("k", 60_000, 2);
    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 1);

    const r2 = await store.increment("k", 60_000, 2);
    assert.equal(r2.allowed, true);
    assert.equal(r2.remaining, 0);

    const r3 = await store.increment("k", 60_000, 2);
    assert.equal(r3.allowed, false);
    assert.equal(r3.remaining, 0);
  });

  it("expires counters after the window", async () => {
    const store = new MemoryRateLimitStore();
    await store.increment("k", 10, 1);
    const blocked = await store.increment("k", 10, 1);
    assert.equal(blocked.allowed, false);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const reset = await store.increment("k", 10, 1);
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
