import { NextRequest, NextResponse } from "next/server";
import { getClientIdentifier } from "@/lib/rate-limit";
import { CLIENT_IP_HEADER, resolveClientIp } from "@/lib/client-ip";

/**
 * TEMPORARY diagnostic — R-004 client-identifier investigation.
 *
 * Purpose: show which forwarding headers the **origin serverless function**
 * actually receives, so the identifier can be fixed from evidence instead of
 * from assumptions about platform behaviour. The previous attempt reasoned that
 * `x-nf-client-connection-ip` was correct at the edge and corrupted only by the
 * edge -> origin hop; that was falsified (the header already carried an edge-node
 * address at the edge).
 *
 * Fail-closed by design: returns 404 with no body unless `DIAG_HEADERS_TOKEN` is
 * configured **and** the caller supplies it in `x-diag-token`. With the variable
 * unset the route is completely inert, so it can be committed before anyone
 * decides to activate it.
 *
 * REMOVE THIS ROUTE once the investigation concludes. It exists to be deleted.
 *
 * NOTE: the folder must NOT be underscore-prefixed. Next.js treats `_`-prefixed
 * folders as private and excludes them from routing, so an earlier
 * `app/api/_diag/...` path returned Next's 404 page and was never registered.
 */

export const dynamic = "force-dynamic";

/** Headers that could carry a client address, or corroborate one. */
const INTERESTING = [
  "x-nf-client-connection-ip",
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "x-nf-request-id",
  "x-nf-geo",
  "x-country",
  "user-agent",
];

export async function GET(request: NextRequest) {
  const expected = process.env.DIAG_HEADERS_TOKEN;
  if (!expected) {
    // Not activated. Indistinguishable from a route that does not exist.
    return new NextResponse(null, { status: 404 });
  }

  const supplied = request.headers.get("x-diag-token");
  if (!supplied || supplied !== expected) {
    return new NextResponse(null, { status: 404 });
  }

  const selected: Record<string, string | null> = {};
  for (const name of INTERESTING) {
    selected[name] = request.headers.get(name);
  }

  // Any other header whose name suggests it might carry an address.
  const ipLike: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    if (/ip|forward|real|client|country|geo/i.test(name)) {
      ipLike[name] = value;
    }
  });

  return NextResponse.json(
    {
      // What this function sees. Compare against the platform's own request log
      // (client_address / connection_address) for the same request id.
      selectedHeaders: selected,
      ipLikeHeaders: ipLike,
      // How the app would currently resolve the client, and what each layer says.
      clientIpHeaderFromMiddleware: request.headers.get(CLIENT_IP_HEADER),
      resolveClientIpAtOrigin: resolveClientIp(request.headers),
      getClientIdentifierResult: getClientIdentifier(request),
      nextRequestIp:
        (request as unknown as { ip?: string | undefined }).ip ?? null,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
