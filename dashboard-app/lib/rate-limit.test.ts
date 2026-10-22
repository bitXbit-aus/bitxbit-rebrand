import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  getClientIdentifier,
  getRateLimitStore,
  rateLimitResponse,
  resolveRateLimitBackend,
  setRateLimitStore,
} from "./rate-limit";
import { MemoryRateLimitStore, RateLimitResult, RateLimitStore } from "./rate-limit-store";
import { rateLimitHealthSnapshot, resetRateLimitHealth } from "./rate-limit-health";

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
  // Measured production chain: real client 206.83.119.2, Netlify's anchor
  // holding an edge-node address.
  const ANCHOR = "3.107.102.194";
  const CLIENT = "206.83.119.2";
  const CHAIN = `${CLIENT}, ${ANCHOR}, 13.55.15.16`;

  it("keys on the real client, not on Netlify's edge address", () => {
    // The regression this guards: the anchor holds an edge-node address, so
    // keying on it made every client behind an edge node share one bucket.
    const req = makeRequest(
      { "x-nf-client-connection-ip": ANCHOR, "x-forwarded-for": CHAIN },
      "7.7.7.7"
    );
    assert.equal(getClientIdentifier(req as any), CLIENT);
  });

  it("is NOT fooled by a forged forwarded chain", () => {
    // Netlify preserves and PREPENDS a client-supplied chain, so the leftmost
    // entry is attacker-chosen. Using it would hand callers their own bucket.
    const req = makeRequest(
      {
        "x-nf-client-connection-ip": ANCHOR,
        "x-forwarded-for": `1.2.3.4, ${CLIENT}, ${ANCHOR}, 16.176.74.16`,
      },
      "7.7.7.7"
    );
    assert.equal(getClientIdentifier(req as any), CLIENT);
    assert.notEqual(getClientIdentifier(req as any), "1.2.3.4");
  });

  it("ignores a client-supplied x-bitxbit-client-ip — no bucket selection", () => {
    // This header was meant to carry the middleware's value, but it is absent at
    // the origin (measured), so nothing may be read from it: a forged copy must
    // not become the rate-limit key.
    const req = makeRequest(
      {
        "x-bitxbit-client-ip": "9.9.9.9",
        "x-nf-client-connection-ip": ANCHOR,
        "x-forwarded-for": CHAIN,
      },
      "7.7.7.7"
    );
    assert.equal(getClientIdentifier(req as any), CLIENT);
    assert.notEqual(getClientIdentifier(req as any), "9.9.9.9");
  });

  it("rejects a non-IP anchor rather than keying on it", () => {
    const req = makeRequest({ "x-nf-client-connection-ip": "not-an-ip" }, "7.7.7.7");
    assert.equal(getClientIdentifier(req as any), "7.7.7.7");
  });

  it("uses X-Forwarded-For only when TRUST_PROXY is enabled, and the rightmost entry", () => {
    process.env.TRUST_PROXY = "true";
    const req = makeRequest({ "x-forwarded-for": "5.5.5.5, 6.6.6.6" }, "7.7.7.7");
    assert.equal(getClientIdentifier(req as any), "6.6.6.6");
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

describe("rate-limit store selection (R-004 fallback visibility)", () => {
  const saved = {
    nodeEnv: process.env.NODE_ENV,
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalError = console.error;
  // NODE_ENV is typed read-only in @types/node, so mutate through a widened view.
  const env = process.env as unknown as Record<string, string | undefined>;

  function restore() {
    console.error = originalError;
    for (const [key, value] of [
      ["NODE_ENV", saved.nodeEnv],
      ["UPSTASH_REDIS_REST_URL", saved.url],
      ["UPSTASH_REDIS_REST_TOKEN", saved.token],
      ["NEXT_PUBLIC_SUPABASE_URL", saved.supabaseUrl],
      ["SUPABASE_SERVICE_ROLE_KEY", saved.supabaseKey],
    ] as const) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    setRateLimitStore(undefined);
  }

  /** Silences console.error and records what would have been logged. */
  function captureErrors(): string[] {
    const calls: string[] = [];
    console.error = (...args: any[]) => void calls.push(args.map(String).join(" "));
    return calls;
  }

  it("logs loudly in production when no shared store is configured", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    env.NODE_ENV = "production";
    const calls = captureErrors();
    try {
      setRateLimitStore(undefined); // force store re-selection
      const store = getRateLimitStore();

      assert.ok(store instanceof MemoryRateLimitStore, "should degrade to the memory store");
      assert.equal(calls.length, 1, "should warn exactly once");
      assert.match(calls[0], /DEGRADED/);
      assert.match(calls[0], /PER-INSTANCE/);

      // The store is memoised, so the warning must not repeat per request.
      getRateLimitStore();
      assert.equal(calls.length, 1, "warning is emitted once per process, not per call");
    } finally {
      restore();
    }
  });

  it("stays quiet outside production", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    env.NODE_ENV = "test";
    const calls = captureErrors();
    try {
      setRateLimitStore(undefined);
      getRateLimitStore();
      assert.equal(calls.length, 0, "a silent fallback is acceptable outside production");
    } finally {
      restore();
    }
  });

  it("warns only if BOTH Upstash values are missing", () => {
    env.NODE_ENV = "production";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const calls = captureErrors();
    try {
      setRateLimitStore(undefined);
      getRateLimitStore();
      // Half-configured still degrades to memory, so it must still warn.
      assert.equal(calls.length, 1);
      assert.match(calls[0], /DEGRADED/);
    } finally {
      restore();
    }
  });

  it("records the degradation so it is visible without reading logs (NA-15)", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    env.NODE_ENV = "production";
    captureErrors();
    resetRateLimitHealth();
    try {
      setRateLimitStore(undefined); // force store re-selection
      getRateLimitStore();

      // The log is not evidence: production retained none of it. The registry
      // is, because it is queryable from outside the process.
      const snap = rateLimitHealthSnapshot();
      assert.equal(snap.degradedCount, 1, "selecting the memory store is a degradation");
      assert.equal(snap.lastReason, "no-shared-store");
    } finally {
      resetRateLimitHealth();
      restore();
    }
  });

  it("marks the rejection path degraded when no shared store is configured (NA-15)", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetRateLimitHealth();
    try {
      const response = rateLimitResponse(Date.now() + 30_000);

      assert.equal(response.status, 429);
      assert.ok(response.headers.get("retry-after"), "the existing contract must be intact");
      // Keying on runtime events alone reported "false" here — a 429 from a
      // per-instance limiter claiming to be healthy. Executing the real route is
      // what exposed it.
      assert.equal(
        response.headers.get("x-ratelimit-degraded"),
        "true",
        "a per-instance limiter must not report itself healthy"
      );
    } finally {
      resetRateLimitHealth();
      restore();
    }
  });

  it("marks the rejection path healthy when a shared store is configured (NA-15)", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    resetRateLimitHealth();
    try {
      const response = rateLimitResponse(Date.now() + 30_000);
      assert.equal(response.headers.get("x-ratelimit-degraded"), "false");
    } finally {
      resetRateLimitHealth();
      restore();
    }
  });
});

describe("rate-limit backend selection", () => {
  it("prefers Supabase when it is configured", () => {
    assert.equal(
      resolveRateLimitBackend({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
      }),
      "supabase"
    );
  });

  it("falls back to Upstash when Supabase is not configured", () => {
    assert.equal(
      resolveRateLimitBackend({
        UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "token",
      }),
      "upstash"
    );
  });

  it("requires both Supabase values before choosing Supabase", () => {
    assert.equal(
      resolveRateLimitBackend({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" }),
      "memory"
    );
    assert.equal(
      resolveRateLimitBackend({ SUPABASE_SERVICE_ROLE_KEY: "service-key" }),
      "memory"
    );
  });

  it("requires both Upstash values before choosing Upstash", () => {
    // A half-configured Redis would otherwise fail on every request.
    assert.equal(
      resolveRateLimitBackend({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io" }),
      "memory"
    );
    assert.equal(resolveRateLimitBackend({}), "memory");
  });

  it("treats empty strings as unconfigured", () => {
    assert.equal(
      resolveRateLimitBackend({
        NEXT_PUBLIC_SUPABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
      }),
      "memory"
    );
  });
});
