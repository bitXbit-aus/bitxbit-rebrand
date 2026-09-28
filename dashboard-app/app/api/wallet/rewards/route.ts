import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: rewards, error } = await supabase
    .from("user_rewards")
    .select("id, bitxbit_amount, estimated_aud_value, distribution_tx_hash, distributed_at, period:reward_periods(start_date, end_date)")
    .eq("user_id", user.id)
    .eq("status", "distributed")
    .order("distributed_at", { ascending: false });

  if (error) {
    console.error("Failed to load wallet rewards:", error);
    return NextResponse.json({ error: "Failed to load rewards" }, { status: 500 });
  }

  return NextResponse.json({ rewards: rewards ?? [] });
}
