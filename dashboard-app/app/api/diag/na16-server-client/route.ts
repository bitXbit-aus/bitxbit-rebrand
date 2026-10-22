import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

/**
 * TEMPORARY NA-16 measurement instrument — REMOVE once the measurement is taken.
 *
 * NA-16 asks whether `lib/supabase/server.ts` shares NA-14's fetch-caching flaw.
 * It cannot be settled by reasoning: NA-14's cause was a cached response through
 * the Supabase client, and `createServerClient` resolves fetch through the same
 * bare global `fetch` (`resolveFetch` in supabase-js). So it is measured.
 *
 * Every path through the server client drivable from outside returns an upstream
 * ERROR — an unauthenticated request never reaches the network at all
 * (`auth.getUser()` short-circuits with no session), and a forged session yields
 * a 401 from `/auth/v1/user`. Next.js will not cache an error response, so a 401
 * cannot detect caching. This route supplies the missing case: an anon-readable
 * read that returns **200**.
 *
 * The app is deliberately NOT asked to report on itself. Ground truth is
 * Supabase's own edge logs, which record every `/rest/v1/` request with its path
 * and method. The check is whether that upstream count scales with the number of
 * app requests (not cached) or stays flat (cached).
 *
 * ## The positive control
 *
 * A negative result is worthless unless the method can produce a positive. So the
 * same request also issues a raw `fetch` with `cache: "force-cache"` — a fetch
 * that IS expected to be cached — and reports its `date` and `age` response
 * headers. If the control's `date` stays frozen across requests while the server
 * client's upstream count scales 1:1, then the method detects caching and the
 * server client genuinely does not cache.
 *
 * The control uses `limit=2` so its cache key cannot collide with the reads under
 * test (`limit=1`).
 *
 * Exposure: returns no data, no identifiers and no configuration — only whether
 * reads completed and the control's own response headers. It takes no parameters,
 * so it cannot be pointed anywhere, and it is rate-limited so it cannot be used
 * to generate database load.
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

  // --- the path under test: the REAL server client, same read twice ---
  const supabase = createClient();
  const first = await supabase.from("users").select("id").limit(1);
  const second = await supabase.from("users").select("id").limit(1);

  // --- positive control: a fetch that is explicitly expected to be cached ---
  const url =
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/users?select=id&limit=2`;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const control = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "force-cache",
  });

  return NextResponse.json(
    {
      ok: true,
      serverClientReads: 2,
      first: first.error ? "error" : "ok",
      second: second.error ? "error" : "ok",
      control: {
        status: control.status,
        // A cached response keeps the ORIGINAL date; a fresh one advances.
        date: control.headers.get("date"),
        age: control.headers.get("age"),
      },
    },
    { headers: { "cache-control": "no-store" } }
  );
}
