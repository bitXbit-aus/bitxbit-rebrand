import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

/**
 * TEMPORARY NA-16 measurement instrument — REMOVE once the measurement is taken.
 *
 * NA-16 asks whether `lib/supabase/server.ts` shares NA-14's fetch-caching flaw.
 * It cannot be settled by reasoning: NA-14's cause was a cached response through
 * the Supabase client, and `createServerClient` resolves fetch through the same
 * bare global `fetch` (`resolveFetch` in supabase-js). So it must be measured.
 *
 * Every path through the server client that can be driven from outside returns
 * an upstream ERROR — an unauthenticated request never reaches the network at all
 * (`auth.getUser()` short-circuits with no session), and a forged session yields
 * a 401 from `/auth/v1/user`. Next.js will not cache an error response, so a 401
 * cannot detect caching. This route supplies the missing case: an anon-readable
 * read that returns **200**.
 *
 * It performs the SAME read TWICE, so both cross-request caching and
 * within-request deduplication are visible.
 *
 * The app is deliberately NOT asked to report on itself. The ground truth is
 * Supabase's own edge logs, which record every `/rest/v1/` request with its path
 * and method. The check is whether that upstream count scales with the number of
 * app requests (not cached) or stays flat (cached).
 *
 * Exposure: this returns no data, no identifiers and no configuration — only
 * whether two reads completed. It takes no parameters, so it cannot be pointed
 * anywhere. It is rate-limited so it cannot be used to generate database load.
 */

export const dynamic = "force-dynamic";

const NA16_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: "api:diag-na16",
};

export async function GET(request: NextRequest) {
  // A brake, not a security control: there is nothing here to protect. It keeps
  // scanners and crawlers from exercising the instrument by accident.
  if (request.headers.get("x-na16-probe") !== "server-client-cache") {
    return new NextResponse(null, { status: 404 });
  }

  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, NA16_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.resetAt);
  }

  const supabase = createClient();

  // Identical reads through the REAL server client. If the underlying fetch is
  // cached, the second produces no upstream request and repeats across requests
  // do not either.
  const first = await supabase.from("users").select("id").limit(1);
  const second = await supabase.from("users").select("id").limit(1);

  return NextResponse.json(
    {
      ok: true,
      reads: 2,
      first: first.error ? "error" : "ok",
      second: second.error ? "error" : "ok",
    },
    { headers: { "cache-control": "no-store" } }
  );
}
