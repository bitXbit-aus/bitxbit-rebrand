import type { RateLimitBackend } from "./rate-limit";

/**
 * Rate-limit degradation registry — NA-15.
 *
 * The problem this exists to solve: a degraded rate-limit store could not report
 * its own degradation. Both degradation paths logged via `console.error`, and
 * Netlify's request logs return `logs: []` even for requests with
 * `has_function_invocation: true`, so a `LogText` filter returns nothing. The
 * only evidence that limits had silently become per-instance was that the limits
 * behaved differently — which is precisely the failure mode R-004 existed to
 * remove, present in the degradation path itself.
 *
 * So degradation is recorded in process memory and exposed on a surface an
 * operator (or a monitor) can query from outside, without reading logs. This
 * module deliberately depends on nothing but a type from `rate-limit.ts`, so the
 * reporting layer cannot be taken down by the thing it reports on.
 *
 * KNOWN LIMITATION, stated rather than hidden: this registry is per-process, and
 * a serverless deployment has many processes. A probe therefore observes the
 * instance that served it. That is adequate because the dominant failure modes
 * are global — a missing configuration affects every instance identically, and a
 * shared-store outage affects every instance at once. A transient failure on one
 * instance can still be missed by a single probe, which is why the surface
 * reports a running count and a timestamp rather than a bare boolean: repeated
 * probes accumulate evidence. It is not a substitute for monitoring the positive
 * signal (counter rows advancing in the shared store).
 */

/** Why the limiter is not using a healthy shared store. */
export type RateLimitDegradationReason =
  /** Nothing shared is configured: limits are per-instance and not shared. */
  | "no-shared-store"
  /** The shared store errored; this request fell back to per-instance limits. */
  | "store-unavailable"
  /** The shared store answered with a payload that cannot be trusted. */
  | "invalid-payload";

export interface RateLimitHealthSnapshot {
  /** Degradation events observed by THIS process since it started. */
  degradedCount: number;
  lastDegradedAt: number | null;
  lastReason: RateLimitDegradationReason | null;
  /**
   * Requests that could not be attributed to a client and fell into the shared
   * `anonymous` bucket. Tracked SEPARATELY from store degradation on purpose:
   * the store can be perfectly healthy while client-IP resolution is failing,
   * and conflating the two would report a 503 for a limiter that is working.
   */
  unresolvedClientCount: number;
  lastUnresolvedClientAt: number | null;
  /** When this process began tracking. */
  since: number;
}

export interface RateLimitHealth extends RateLimitHealthSnapshot {
  status: "ok" | "degraded";
  degraded: boolean;
  /** False when the backend is per-instance, i.e. limits are not shared. */
  shared: boolean;
  backend: RateLimitBackend;
  checkedAt: number;
  /** HTTP status the surface should return: 503 when degraded, 200 otherwise. */
  httpStatus: number;
}

let degradedCount = 0;
let lastDegradedAt: number | null = null;
let lastReason: RateLimitDegradationReason | null = null;
let unresolvedClientCount = 0;
let lastUnresolvedClientAt: number | null = null;
const since = Date.now();

/**
 * Record one degradation event. Called from the limiter's failure paths — never
 * from a success path, so a non-zero count always means something went wrong.
 */
export function recordRateLimitDegradation(
  reason: RateLimitDegradationReason,
  now: number = Date.now()
): void {
  degradedCount += 1;
  lastDegradedAt = now;
  lastReason = reason;
}

export function rateLimitHealthSnapshot(): RateLimitHealthSnapshot {
  return {
    degradedCount,
    lastDegradedAt,
    lastReason,
    unresolvedClientCount,
    lastUnresolvedClientAt,
    since,
  };
}

/**
 * Record one request that could not be attributed to a client.
 *
 * Why this exists: when client-IP resolution fails, every such request shares one
 * `anonymous` bucket. That is deliberately fail-closed (a caller can never choose
 * its own key), but it means a single caller could exhaust the bucket for
 * everyone. The failure was previously invisible, so it is now recorded and
 * exposed on the health surface — the same fix pattern used for R-004/NA-15.
 */
export function recordUnresolvedClient(now: number = Date.now()): void {
  unresolvedClientCount += 1;
  lastUnresolvedClientAt = now;
}

/** Test hook. Production code never resets the registry. */
export function resetRateLimitHealth(): void {
  degradedCount = 0;
  lastDegradedAt = null;
  lastReason = null;
  unresolvedClientCount = 0;
  lastUnresolvedClientAt = null;
}

/**
 * Compose the health view. Pure, so the surface is testable without a Next.js
 * runtime and the decision logic lives here rather than in the route.
 *
 * Degraded means either of:
 *  - the configured backend is not shared (a permanent, configuration-level
 *    degradation), or
 *  - at least one request has fallen back at runtime.
 */
export function buildRateLimitHealth(
  backend: RateLimitBackend,
  snapshot: RateLimitHealthSnapshot,
  now: number = Date.now()
): RateLimitHealth {
  const shared = backend !== "memory";
  const degraded = !shared || snapshot.degradedCount > 0;

  return {
    status: degraded ? "degraded" : "ok",
    degraded,
    shared,
    backend,
    degradedCount: snapshot.degradedCount,
    lastDegradedAt: snapshot.lastDegradedAt,
    unresolvedClientCount: snapshot.unresolvedClientCount,
    lastUnresolvedClientAt: snapshot.lastUnresolvedClientAt,
    // When nothing shared is configured the reason is knowable even before any
    // request has been made, so report it rather than leaving the field null.
    lastReason: snapshot.lastReason ?? (shared ? null : "no-shared-store"),
    since: snapshot.since,
    checkedAt: now,
    httpStatus: degraded ? 503 : 200,
  };
}
