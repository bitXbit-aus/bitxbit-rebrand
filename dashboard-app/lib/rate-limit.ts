import { NextRequest, NextResponse } from "next/server";
import { MemoryRateLimitStore, RateLimitResult, RateLimitStore } from "./rate-limit-store";
import { CLIENT_IP_HEADER, isValidIp } from "./client-ip";

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
  // Deliberately does NOT throw: refusing every rate-limited request because the
  // store is missing would take the site down — worse than a degraded limit.
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
  // The middleware resolves the client address at the edge and forwards it in
  // this header, because the edge -> origin hop replaces
  // `x-nf-client-connection-ip` with the hop's own address — which made the
  // limiter key on an infrastructure IP, so every client behind an edge node
  // shared one bucket. See lib/client-ip.ts — R-004.
  //
  // Trustworthy only because the middleware overwrites this header
  // unconditionally before any route runs; a client-supplied value cannot
  // survive. Every source below is validated as a bare IP so a malformed or
  // forged value can never become a rate-limit key.
  const fromMiddleware = request.headers.get(CLIENT_IP_HEADER);
  if (isValidIp(fromMiddleware)) {
    return (fromMiddleware as string).trim();
  }

  // Fallback for a request that somehow bypassed the middleware. Correct only
  // when the route is reached without the extra edge hop.
  const netlifyClientIp = request.headers.get("x-nf-client-connection-ip");
  if (isValidIp(netlifyClientIp)) {
    return (netlifyClientIp as string).trim();
  }

  // Only trust X-Forwarded-For when the deployment explicitly runs behind a
  // trusted proxy. Without this guard a client can bypass per-IP rate limiting
  // by sending an arbitrary forwarded header.
  const trustProxy =
    process.env.TRUST_PROXY === "true" ||
    process.env.RATE_LIMIT_TRUST_PROXY === "true";
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim();
    if (isValidIp(ip)) {
      return ip as string;
    }
  }

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
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
      },
    }
  );
}
