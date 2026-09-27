import { createServiceClient } from "@/lib/supabase/service";
import { publicJsonResponse, publicOptionsResponse } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("users")
    .select("id, referral_code, referred_by")
    .not("referral_code", "is", null);

  if (error) {
    return publicJsonResponse({ error: "Failed to load referrers" }, 500);
  }

  // Build a map of referrer user id -> count of referred users
  const referrerCounts = new Map<string, number>();
  const referralCodes = new Map<string, string>();

  for (const user of data ?? []) {
    if (user.referral_code) {
      referralCodes.set(user.id, user.referral_code);
    }
    if (user.referred_by) {
      referrerCounts.set(user.referred_by, (referrerCounts.get(user.referred_by) ?? 0) + 1);
    }
  }

  const leaderboard = Array.from(referrerCounts.entries())
    .map(([userId, count]) => ({
      referralCode: referralCodes.get(userId) ?? "unknown",
      referredCount: count,
    }))
    .filter((r) => r.referralCode !== "unknown")
    .sort((a, b) => b.referredCount - a.referredCount)
    .slice(0, 10);

  return publicJsonResponse({ leaderboard });
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
