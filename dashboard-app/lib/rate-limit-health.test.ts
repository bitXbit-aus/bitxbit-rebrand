import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRateLimitHealth,
  rateLimitHealthSnapshot,
  recordRateLimitDegradation,
  resetRateLimitHealth,
} from "./rate-limit-health";

describe("rate-limit degradation registry", () => {
  beforeEach(() => {
    resetRateLimitHealth();
  });

  it("starts clean", () => {
    const snap = rateLimitHealthSnapshot();
    assert.equal(snap.degradedCount, 0);
    assert.equal(snap.lastDegradedAt, null);
    assert.equal(snap.lastReason, null);
    assert.equal(typeof snap.since, "number");
  });

  it("counts every event and keeps the most recent reason", () => {
    recordRateLimitDegradation("store-unavailable", 1000);
    recordRateLimitDegradation("invalid-payload", 2000);

    const snap = rateLimitHealthSnapshot();
    assert.equal(snap.degradedCount, 2);
    assert.equal(snap.lastReason, "invalid-payload");
    assert.equal(snap.lastDegradedAt, 2000);
  });

  it("resets to clean", () => {
    recordRateLimitDegradation("store-unavailable");
    resetRateLimitHealth();

    const snap = rateLimitHealthSnapshot();
    assert.equal(snap.degradedCount, 0);
    assert.equal(snap.lastReason, null);
    assert.equal(snap.lastDegradedAt, null);
  });
});

describe("buildRateLimitHealth", () => {
  beforeEach(() => {
    resetRateLimitHealth();
  });

  it("reports healthy for a shared backend with no failures", () => {
    const h = buildRateLimitHealth("supabase", rateLimitHealthSnapshot(), 5000);

    assert.equal(h.status, "ok");
    assert.equal(h.degraded, false);
    assert.equal(h.shared, true);
    assert.equal(h.backend, "supabase");
    assert.equal(h.degradedCount, 0);
    assert.equal(h.lastReason, null);
    assert.equal(h.checkedAt, 5000);
    assert.equal(h.httpStatus, 200);
  });

  it("treats upstash as a shared backend", () => {
    const h = buildRateLimitHealth("upstash", rateLimitHealthSnapshot());
    assert.equal(h.shared, true);
    assert.equal(h.degraded, false);
  });

  it("reports degraded for the in-memory backend even with no recorded event", () => {
    // The configuration itself is the degradation: limits are per-instance. This
    // must be visible before any request has failed, because it is permanent.
    const h = buildRateLimitHealth("memory", rateLimitHealthSnapshot());

    assert.equal(h.status, "degraded");
    assert.equal(h.degraded, true);
    assert.equal(h.shared, false);
    assert.equal(h.lastReason, "no-shared-store");
    assert.equal(h.httpStatus, 503);
  });

  it("reports degraded once a shared backend has fallen back at runtime", () => {
    recordRateLimitDegradation("store-unavailable", 7000);

    const h = buildRateLimitHealth("supabase", rateLimitHealthSnapshot(), 8000);

    assert.equal(h.status, "degraded");
    assert.equal(h.degraded, true);
    assert.equal(h.shared, true);
    assert.equal(h.degradedCount, 1);
    assert.equal(h.lastReason, "store-unavailable");
    assert.equal(h.lastDegradedAt, 7000);
    assert.equal(h.httpStatus, 503);
  });

  it("keeps a runtime reason distinct from the config-level one", () => {
    recordRateLimitDegradation("invalid-payload", 100);

    const h = buildRateLimitHealth("supabase", rateLimitHealthSnapshot());
    assert.equal(h.lastReason, "invalid-payload");
  });
});
