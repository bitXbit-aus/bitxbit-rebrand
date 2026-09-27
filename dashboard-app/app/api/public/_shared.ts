import { NextResponse } from "next/server";

export const PUBLIC_CACHE_TTL = 300; // 5 minutes

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
