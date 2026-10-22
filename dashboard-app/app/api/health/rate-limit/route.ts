import { NextResponse } from "next/server";
import { resolveRateLimitBackend } from "@/lib/rate-limit";
import { buildRateLimitHealth, rateLimitHealthSnapshot } from "@/lib/rate-limit-health";

/**
 * Rate-limit control health — NA-15.
 *
 * Exists because a degraded limiter could not report its own degradation: both
 * fallback paths logged via `console.error`, and Netlify's request logs return
 * `logs: []` even for requests with `has_function_invocation: true`, so nothing
 * was retained. A limiter that had silently become per-instance was therefore
 * indistinguishable, from outside, from one enforcing shared limits.
 *
 * This is a CONTROL-HEALTH probe, not a site-liveness probe. It returns 503 when
 * the limiter is degraded, deliberately: an endpoint whose entire purpose is to
 * raise the alarm must not answer 200 while the control is broken. Point
 * general site-liveness monitors at a different path so a degraded limiter does
 * not read as an outage.
 *
 * Safe to expose: it reports configuration and counters only. No credentials, no
 * connection strings, and deliberately NO raw error text — a Supabase error
 * message can carry the project URL, and this route is unauthenticated.
 */

// A cached diagnostic reports a state that may since have changed. That is not
// hypothetical here: NA-14 was a cached response making a control look healthy
// while it did nothing. Same mistake, different endpoint.
export const dynamic = "force-dynamic";

export async function GET() {
  const health = buildRateLimitHealth(
    resolveRateLimitBackend(),
    rateLimitHealthSnapshot()
  );

  const { httpStatus, ...body } = health;

  return NextResponse.json(body, {
    status: httpStatus,
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-ratelimit-degraded": String(health.degraded),
    },
  });
}
