import { createServiceClient } from "@/lib/supabase/service";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
  resolveRateLimitBackend,
} from "@/lib/rate-limit";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const RESOLVE_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: "api:resolve-referral",
};

const MAX_CODE_LENGTH = 64;

/**
 * TEMPORARY NA-14 cache-layer probe — remove once the layer is pinned.
 *
 * Established so far: the rate-limit result is served STALE (an expired window
 * still reported `resetAt` 82.5 s in the past), and the row is written once and
 * never advances. The store is fine; the response is replayed.
 *
 * This isolates WHERE. Three channels, each on its own probe key so their
 * counters cannot interfere, and each called twice so a within-request
 * memoisation shows up as well as cross-request caching:
 *
 *   1. the store path (`checkRateLimit` -> supabase-js -> patched fetch);
 *   2. a raw `fetch` with `cache: "no-store"` — bypasses supabase-js entirely;
 *   3. a raw `fetch` with no cache option (whatever Next.js defaults to).
 *
 * If (2) advances while (1) is frozen, the Supabase client's fetch is being
 * cached and the fix is to force `no-store` on it. If all three are frozen the
 * replay is happening outside the app.
 */
async function na14CacheProbe(identifier: string) {
  const nowMs = Date.now();
  const opts = { windowMs: 60_000, maxRequests: 3, keyPrefix: "probe:na14store" };

  const store1 = await checkRateLimit("chan", opts);
  const store2 = await checkRateLimit("chan", opts);

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/check_rate_limit`;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  const rawCall = async (key: string, cache?: RequestCache) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: svcKey,
        Authorization: `Bearer ${svcKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_key: key,
        p_window_ms: 60_000,
        p_max_requests: 3,
      }),
      ...(cache ? { cache } : {}),
    });
    return res.json();
  };

  const rawNoStore1 = await rawCall("probe:na14:rawnostore", "no-store");
  const rawNoStore2 = await rawCall("probe:na14:rawnostore", "no-store");
  const rawDefault1 = await rawCall("probe:na14:rawdefault");

  return {
    backend: resolveRateLimitBackend(),
    identifier,
    nowMs,
    store1,
    store2,
    rawNoStore1,
    rawNoStore2,
    rawDefault1,
  };
}

export async function GET(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, RESOLVE_RATE_LIMIT);

  // TEMPORARY: gated on an explicit opt-in param. Delete with the probe above.
  if (new URL(request.url).searchParams.get("na14") === "2") {
    return NextResponse.json(await na14CacheProbe(identifier), {
      headers: { "cache-control": "no-store" },
    });
  }

  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.resetAt);
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json(
      { error: "Missing referral code" },
      { status: 400 }
    );
  }

  const normalizedCode = code.trim().toLowerCase();
  if (normalizedCode.length === 0 || normalizedCode.length > MAX_CODE_LENGTH) {
    return NextResponse.json(
      { error: "Invalid referral code" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // Referral codes are stored in lowercase. Only fall back to id lookup for UUID-shaped refs
  // so we don't compare a UUID column to non-UUID text (which causes PostgREST to error).
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedCode);

  let query = supabase.from("users").select("id, display_name, referral_code");

  if (isUuid) {
    query = query.or(`referral_code.eq.${normalizedCode},id.eq.${normalizedCode}`);
  } else {
    query = query.eq("referral_code", normalizedCode);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Referrer not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}
