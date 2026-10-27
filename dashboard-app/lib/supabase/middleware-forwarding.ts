import { NextResponse, type NextRequest } from "next/server";
import { withClientIp } from "../client-ip";

/**
 * Build the production middleware continuation response from the CURRENT request
 * headers. This must run after every Supabase `setAll`: mutating
 * `request.cookies` updates its Cookie header, and `NextResponse.next` serialises
 * that header into `x-middleware-request-cookie` for downstream rendering.
 *
 * Extracted so the exact NextRequest -> NextResponse boundary is executable with
 * real Next.js objects. A fake cookie store cannot prove header forwarding.
 */
export function buildForwardingResponse(request: NextRequest, clientIp: string | null): NextResponse {
  return NextResponse.next({
    request: {
      // Built fresh at each invocation; never capture a pre-refresh Headers snapshot.
      headers: withClientIp(new Headers(request.headers), clientIp),
    },
  });
}
