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
 * TEMPORARY NA-14 diagnostic — remove once the root cause is established.
 *
 * This route was observed not to enforce its rate limit (zero 429s across 38,
 * 38, 120 and 35 requests) and never to write a counter row, while three sibling
 * routes enforced at their exact limits in the same minute. Caching was ruled
 * out: Netlify's own request records show both cache results as `miss`.
 *
 * The remaining candidate is that the `check_rate_limit` RPC fails for this
 * invocation and `SupabaseRateLimitStore` swallows the error and degrades to
 * per-instance memory. The store's own catch makes that invisible, so this probe
 * calls the RPC directly and reports the raw result.
 *
 * It uses a SEPARATE probe key so it cannot perturb the real counter.
 */
async function na14Diagnostic(identifier: string, storeResult: unknown) {
  const backend = resolveRateLimitBackend();

  let directRpc: { data: unknown; error: string | null } = {
    data: null,
    error: null,
  };
  try {
    const svc = createServiceClient();
    const { data, error } = await svc.rpc("check_rate_limit", {
      p_key: "probe:na14:direct",
      p_window_ms: 60_000,
      p_max_requests: 3,
    });
    directRpc = {
      data,
      error: error ? (error.message ?? "error with no message") : null,
    };
  } catch (e) {
    directRpc = {
      data: null,
      error: `threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return {
    backend,
    identifier,
    storeResult,
    directRpc,
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  };
}

export async function GET(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, RESOLVE_RATE_LIMIT);

  // TEMPORARY: gated on an explicit opt-in param so normal responses are
  // untouched. Delete together with the diagnostic above.
  if (new URL(request.url).searchParams.get("na14") === "1") {
    return NextResponse.json(await na14Diagnostic(identifier, rateLimit), {
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
