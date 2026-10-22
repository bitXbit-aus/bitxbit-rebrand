import { NextRequest, NextResponse } from "next/server";
import { MemoryRateLimitStore, RateLimitResult, RateLimitStore } from "./rate-limit-store";
import { resolveClientIp } from "./client-ip";
import {
  buildRateLimitHealth,
  rateLimitHealthSnapshot,
  recordRateLimitDegradation,
} from "./rate-limit-health";

let sharedStore: RateLimitStore | undefined;

/**
 * Which backing store a deployment will use.
 *
 * Supabase Postgres is preferred because it is already part of the stack — no
 * extra account, no additional credential to hold or leak — and its single
 * atomic upsert gives the cross-instance guarantee the RateLimitStore interface
 * requires. Upstash remains supported for deployments that configure it.
 */
export type RateLimitBackend = "supabase" | "upstash" | "memory";

export function resolveRateLimitBackend(
  env: Record<string, string | undefined> = process.env
): RateLimitBackend {
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return "supabase";
  }
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return "upstash";
  }
  return "memory";
}

/**
 * Returns the shared rate-limit store for this process — shared across every
 * serverless instance, not merely within one. Falls back to an in-memory store,
 * loudly, when nothing shared is configured.
 */
export function getRateLimitStore(): RateLimitStore {
  if (!sharedStore) {
    sharedStore = createStore(resolveRateLimitBackend());
  }
  // createStore always returns a value; TypeScript cannot see through the
  // dynamic require, so we assert non-null.
  return sharedStore!;
}

function createStore(backend: RateLimitBackend): RateLimitStore {
  if (backend === "supabase") {
    // Dynamic requires keep each backend out of the bundle path unless selected.
    const { createServiceClient } = require("./supabase/service");
    const { SupabaseRateLimitStore } = require("./rate-limit-supabase");
    return new SupabaseRateLimitStore({ client: createServiceClient() });
  }

  if (backend === "upstash") {
    const { UpstashRedisRateLimitStore } = require("./rate-limit-redis");
    return new UpstashRedisRateLimitStore({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }

  // R-004: nothing shared is configured, so in-memory limits apply per instance
  // and an attacker spreading requests across instances receives a multiple of
  // the intended allowance. This used to happen silently, which made a degraded
  // control indistinguishable from a working one. Log it loudly.
  //
  // NA-15: the log alone was not enough — Netlify's request logs return nothing
  // even for requests that invoked the function, so this degradation was
  // invisible in production. Record it so it is also queryable from outside.
  //
  // Deliberately does NOT throw: refusing every rate-limited request because the
  // store is missing would take the site down — worse than a degraded limit.
  recordRateLimitDegradation("no-shared-store");

  if (process.env.NODE_ENV === "production") {
    console.error(
      "[rate-limit] DEGRADED: no shared store is configured (neither Supabase nor Upstash). " +
        "Falling back to an in-memory store, so rate limits are PER-INSTANCE and NOT shared " +
        "across instances. See R-004 in docs/security/risk-register.md."
    );
  }

  return new MemoryRateLimitStore();
}

/**
 * Test hook to inject a custom store. Calling without arguments restores the
 * default store selection.
 */
export function setRateLimitStore(store?: RateLimitStore): void {
  sharedStore = store;
}

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export function getClientIdentifier(request: NextRequest): string {
  // Resolution happens HERE, at the origin, from the raw forwarding chain — not
  // via a header supplied by the middleware. Measured 2026-10-21: a custom
  // request header set by the middleware is absent at the origin (as is a
  // client-forged copy of it), so the middleware cannot deliver the address and
  // must not be relied upon. The client is the hop immediately left of Netlify's
  // edge anchor; the leftmost `x-forwarded-for` entry is attacker-controlled and
  // must never be used. See lib/client-ip.ts — R-004.
  const resolved = resolveClientIp(request.headers);
  if (resolved) return resolved;

  // Last resort. `request.ip` is not populated on Netlify, so this is normally
  // "anonymous": one shared bucket. Coarse, but safe — it never lets a caller
  // choose its own key.
  return request.ip ?? "anonymous";
}

export async function checkRateLimit(
  identifier: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const key = `${options.keyPrefix ?? "rl"}:${identifier}`;
  const store = getRateLimitStore();
  return store.increment(key, options.windowMs, options.maxRequests);
}

export function rateLimitResponse(
  resetAt: number
): NextResponse<{
  error: string;
}> {
  // NA-15: state the store's health on the rejection itself, so a limiter that
  // is quietly per-instance is visible from the response and not only from a log
  // line that production does not keep.
  //
  // Composed through buildRateLimitHealth rather than reading degradedCount
  // directly: keying on runtime events alone reported `false` on a deployment
  // with NO shared store configured, i.e. the exact deployment the header exists
  // to warn about. Caught by executing the real route, not by a unit test.
  const degraded = buildRateLimitHealth(
    resolveRateLimitBackend(),
    rateLimitHealthSnapshot()
  ).degraded;

  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
        "x-ratelimit-degraded": String(degraded),
      },
    }
  );
}
