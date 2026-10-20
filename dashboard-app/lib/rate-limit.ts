import { NextRequest, NextResponse } from "next/server";
import { MemoryRateLimitStore, RateLimitResult, RateLimitStore } from "./rate-limit-store";

let sharedStore: RateLimitStore | undefined;

/**
 * Returns the shared rate-limit store for this process. When Upstash Redis
 * credentials are configured, uses Redis so limits are shared across all
 * serverless function instances. Otherwise falls back to an in-memory store.
 */
export function getRateLimitStore(): RateLimitStore {
  if (!sharedStore) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
      // Dynamic import keeps the Redis dependency out of the default bundle
      // path and avoids eagerly loading it when only the memory store is used.
      const { UpstashRedisRateLimitStore } = require("./rate-limit-redis");
      sharedStore = new UpstashRedisRateLimitStore({ url, token });
    } else {
      sharedStore = new MemoryRateLimitStore();
    }
  }
  // sharedStore is always initialized above; TypeScript cannot see through the
  // dynamic require, so we assert non-null.
  return sharedStore!;
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
  // Netlify exposes the original client IP in a trusted, edge-controlled header.
  // Use it first so we never rely on a spoofable X-Forwarded-For chain.
  const netlifyClientIp = request.headers.get("x-nf-client-connection-ip");
  if (netlifyClientIp) {
    return netlifyClientIp;
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
    if (ip) {
      return ip;
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
