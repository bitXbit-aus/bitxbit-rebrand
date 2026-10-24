import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const RESOLVE_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: "api:resolve-referral",
};

const MAX_CODE_LENGTH = 64;

export async function GET(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, RESOLVE_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.resetAt, identifier);
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
