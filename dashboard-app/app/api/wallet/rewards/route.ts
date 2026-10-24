import { createClient } from "@/lib/supabase/server";
import { withAuthNoStore } from "@/lib/supabase/response-cache";
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { NextResponse, type NextRequest } from "next/server";

const WALLET_REWARDS_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 60,
  keyPrefix: "api:wallet-rewards",
};

export async function GET(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, WALLET_REWARDS_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.resetAt);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // `createClient()` can refresh the session, which writes an auth cookie through
  // `cookies()` — and that API cannot set response headers. Middleware cannot see a
  // `Set-Cookie` added downstream either, so this response is marked here. A
  // structural test fails if a new auth-bearing route handler forgets to.
  if (!user) {
    return withAuthNoStore(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const { data: rewards, error } = await supabase
    .from("user_rewards")
    .select("id, bitxbit_amount, estimated_aud_value, distribution_tx_hash, distributed_at, period:reward_periods(start_date, end_date)")
    .eq("user_id", user.id)
    .eq("status", "distributed")
    .order("distributed_at", { ascending: false });

  if (error) {
    console.error("Failed to load wallet rewards:", error);
    return withAuthNoStore(NextResponse.json({ error: "Failed to load rewards" }, { status: 500 }));
  }

  return withAuthNoStore(NextResponse.json({ rewards: rewards ?? [] }));
}
