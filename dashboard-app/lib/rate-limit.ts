import { NextRequest, NextResponse } from "next/server";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const inMemoryStore = new Map<string, RateLimitEntry>();

function cleanupExpiredEntries(now: number) {
  for (const [key, entry] of inMemoryStore.entries()) {
    if (entry.resetAt <= now) {
      inMemoryStore.delete(key);
    }
  }
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

export function checkRateLimit(
  identifier: string,
  options: RateLimitOptions
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  cleanupExpiredEntries(now);

  const key = `${options.keyPrefix ?? "rl"}:${identifier}`;
  const entry = inMemoryStore.get(key);

  if (!entry || entry.resetAt <= now) {
    const resetAt = now + options.windowMs;
    inMemoryStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: options.maxRequests - 1, resetAt };
  }

  if (entry.count >= options.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: options.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
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
