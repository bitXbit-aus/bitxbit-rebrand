import { createClient } from "@/lib/supabase/server";
import { RewardsChart } from "./rewards-chart";

export async function RewardsChartLoader() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: periods } = await supabase
    .from("reward_periods")
    .select(`
      id,
      start_date,
      end_date,
      status,
      user_rewards!inner(estimated_aud_value, status)
    `)
    .eq("user_rewards.user_id", user?.id)
    .order("end_date", { ascending: false })
    .limit(12);

  const normalized = (periods ?? []).map((p: any) => ({
    id: p.id,
    start_date: p.start_date,
    end_date: p.end_date,
    status: p.status,
    user_rewards: p.user_rewards ?? [],
  }));

  return <RewardsChart periods={normalized} />;
}
