import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SupabaseRateLimitStore,
  parseRateLimitResult,
  type RateLimitRpcClient,
} from "./rate-limit-supabase";
import { MemoryRateLimitStore, type RateLimitStore } from "./rate-limit-store";

interface RecordedCall {
  fn: string;
  args: Record<string, unknown>;
}

function fakeClient(result: {
  data?: unknown;
  error?: { message?: string } | null;
}): RateLimitRpcClient & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
      });
    },
  };
}

describe("parseRateLimitResult", () => {
  it("accepts a well-formed payload", () => {
    assert.deepEqual(
      parseRateLimitResult({ allowed: true, remaining: 4, resetAt: 1_700_000_000_000 }),
      { allowed: true, remaining: 4, resetAt: 1_700_000_000_000 }
    );
  });

  it("never reports a negative remaining count", () => {
    const result = parseRateLimitResult({ allowed: false, remaining: -3, resetAt: 1 });
    assert.equal(result.remaining, 0);
  });

  it("rejects anything it cannot trust", () => {
    // A permissive default here would be indistinguishable from a working limiter.
    assert.throws(() => parseRateLimitResult(null));
    assert.throws(() => parseRateLimitResult(undefined));
    assert.throws(() => parseRateLimitResult("allowed"));
    assert.throws(() => parseRateLimitResult({}));
    assert.throws(() => parseRateLimitResult({ allowed: "true", remaining: 1, resetAt: 1 }));
    assert.throws(() => parseRateLimitResult({ allowed: true, remaining: "1", resetAt: 1 }));
    assert.throws(() => parseRateLimitResult({ allowed: true, remaining: 1, resetAt: "1" }));
    assert.throws(() => parseRateLimitResult({ allowed: true, remaining: 1 }));
    assert.throws(() => parseRateLimitResult({ allowed: true, remaining: NaN, resetAt: 1 }));
    assert.throws(() => parseRateLimitResult({ allowed: true, remaining: 1, resetAt: Infinity }));
  });
});

describe("SupabaseRateLimitStore", () => {
  it("calls the check_rate_limit RPC with the expected arguments", async () => {
    const client = fakeClient({ data: { allowed: true, remaining: 2, resetAt: 99 } });
    const store = new SupabaseRateLimitStore({ client });

    const result = await store.increment("rl:1.2.3.4", 60_000, 3);

    assert.deepEqual(result, { allowed: true, remaining: 2, resetAt: 99 });
    assert.deepEqual(client.calls, [
      {
        fn: "check_rate_limit",
        args: { p_key: "rl:1.2.3.4", p_window_ms: 60_000, p_max_requests: 3 },
      },
    ]);
  });

  it("propagates a denial", async () => {
    const client = fakeClient({ data: { allowed: false, remaining: 0, resetAt: 42 } });
    const store = new SupabaseRateLimitStore({ client });

    assert.deepEqual(await store.increment("k", 1_000, 1), {
      allowed: false,
      remaining: 0,
      resetAt: 42,
    });
  });

  it("degrades to the fallback store when the RPC errors", async () => {
    const client = fakeClient({ error: { message: "connection refused" } });
    const fallback = new MemoryRateLimitStore();
    const errors: unknown[] = [];
    const store = new SupabaseRateLimitStore({
      client,
      fallback,
      onError: (e) => errors.push(e),
    });

    const result = await store.increment("rl:fallback", 60_000, 2);

    // The fallback still limits (per instance) rather than permitting freely.
    assert.equal(result.allowed, true);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /connection refused/);
  });

  it("degrades rather than allowing when the payload is malformed", async () => {
    const client = fakeClient({ data: { unexpected: true } });
    const errors: unknown[] = [];
    const store = new SupabaseRateLimitStore({
      client,
      fallback: new MemoryRateLimitStore(),
      onError: (e) => errors.push(e),
    });

    const result = await store.increment("rl:malformed", 60_000, 1);

    assert.equal(result.allowed, true, "fallback should allow the first request");
    assert.equal(errors.length, 1, "a malformed payload must be reported, not ignored");

    // The key point: a malformed payload is treated as a failure, so the second
    // call is still denied by the fallback instead of being waved through.
    const second = await store.increment("rl:malformed", 60_000, 1);
    assert.equal(second.allowed, false);
  });

  it("degrades when the RPC returns no data at all", async () => {
    const client = fakeClient({ data: null });
    const errors: unknown[] = [];
    const store = new SupabaseRateLimitStore({
      client,
      fallback: new MemoryRateLimitStore(),
      onError: (e) => errors.push(e),
    });

    await store.increment("rl:null", 60_000, 5);
    assert.equal(errors.length, 1);
  });

  it("defaults to an in-memory fallback when none is supplied", async () => {
    const client = fakeClient({ error: { message: "boom" } });
    const store = new SupabaseRateLimitStore({ client, onError: () => {} });

    assert.equal((await store.increment("a", 60_000, 1)).allowed, true);
    assert.equal((await store.increment("a", 60_000, 1)).allowed, false);
  });

  it("throttles repeated error reporting", async () => {
    let clock = 1_000_000;
    const client = fakeClient({ error: { message: "db down" } });
    const errors: unknown[] = [];
    const store = new SupabaseRateLimitStore({
      client,
      fallback: new MemoryRateLimitStore(),
      onError: (e) => errors.push(e),
      now: () => clock,
    });

    await store.increment("k", 60_000, 100);
    await store.increment("k", 60_000, 100);
    await store.increment("k", 60_000, 100);
    assert.equal(errors.length, 1, "repeated failures inside the interval must not re-log");

    clock += 60_001;
    await store.increment("k", 60_000, 100);
    assert.equal(errors.length, 2, "after the interval a failure is reported again");
  });

  it("does not consult the fallback when the RPC succeeds", async () => {
    let fallbackCalls = 0;
    const countingFallback: RateLimitStore = {
      async increment() {
        fallbackCalls += 1;
        return { allowed: false, remaining: 0, resetAt: 0 };
      },
    };
    const client = fakeClient({ data: { allowed: true, remaining: 9, resetAt: 5 } });
    const store = new SupabaseRateLimitStore({ client, fallback: countingFallback });

    const result = await store.increment("k", 60_000, 10);

    assert.equal(result.allowed, true);
    assert.equal(fallbackCalls, 0);
  });
});
