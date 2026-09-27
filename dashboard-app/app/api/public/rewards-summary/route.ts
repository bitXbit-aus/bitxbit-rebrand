import { createServiceClient } from "@/lib/supabase/service";
import { publicJsonResponse, publicOptionsResponse } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();

  const { data: periods, error: periodsError } = await supabase
    .from("reward_periods")
    .select("id, start_date, end_date, total_income, status, created_at")
    .order("end_date", { ascending: false })
    .limit(12);

  if (periodsError) {
    return publicJsonResponse({ error: "Failed to load reward periods" }, 500);
  }

  const periodIds = (periods ?? []).map((p) => p.id);

  let totalDistributed = 0;
  let totalApproved = 0;
  let distributedCount = 0;

  if (periodIds.length > 0) {
    const { data: rewards, error: rewardsError } = await supabase
      .from("user_rewards")
      .select("status, bitxbit_amount")
      .in("reward_period_id", periodIds);

    if (rewardsError) {
      return publicJsonResponse({ error: "Failed to load reward summary" }, 500);
    }

    for (const r of rewards ?? []) {
      if (r.status === "distributed") {
        totalDistributed += Number(r.bitxbit_amount ?? 0);
        distributedCount += 1;
      } else if (r.status === "approved") {
        totalApproved += Number(r.bitxbit_amount ?? 0);
      }
    }
  }

  const totalIncome = (periods ?? []).reduce((sum, p) => sum + Number(p.total_income ?? 0), 0);

  return publicJsonResponse({
    periods: periods ?? [],
    summary: {
      totalIncome,
      totalDistributed,
      totalApproved,
      distributedCount,
      periodCount: periods?.length ?? 0,
    },
  });
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
