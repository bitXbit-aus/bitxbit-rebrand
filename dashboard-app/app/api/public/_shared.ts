import { checkRateLimit, getClientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { NextResponse, type NextRequest } from "next/server";

export const PUBLIC_CACHE_TTL = 300; // 5 minutes

export const PUBLIC_RATE_LIMIT = {
  windowMs: 60_000, // 1 minute
  maxRequests: 60,
  keyPrefix: "api:public",
};

export async function checkPublicRateLimit(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const result = await checkRateLimit(identifier, PUBLIC_RATE_LIMIT);
  if (!result.allowed) {
    return rateLimitResponse(result.resetAt, identifier);
  }
  return null;
}

export function publicJsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": `public, s-maxage=${PUBLIC_CACHE_TTL}, stale-while-revalidate=${PUBLIC_CACHE_TTL * 2}`,
    },
  });
}

export function publicOptionsResponse() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
