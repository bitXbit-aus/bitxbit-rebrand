import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Activity, DollarSign, Gift, Users } from "lucide-react";

export async function StatsCards() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: activities }, { data: rewards }, { data: referrals }] = await Promise.all([
    supabase.from("user_activities").select("id").eq("user_id", user?.id),
    supabase.from("user_rewards").select("estimated_aud_value, status").eq("user_id", user?.id),
    supabase.from("users").select("id").eq("referred_by", user?.id),
  ]);

  const totalActivities = activities?.length ?? 0;
  const pendingRewards = rewards?.filter((r) => r.status === "pending").length ?? 0;
  const totalEarned = rewards?.reduce((sum, r) => sum + (r.estimated_aud_value ?? 0), 0) ?? 0;
  const referralCount = referrals?.length ?? 0;

  const stats = [
    { name: "Your Activities", value: totalActivities, icon: Activity, format: formatNumber },
    { name: "Pending Rewards", value: pendingRewards, icon: Gift, format: formatNumber },
    { name: "Estimated Earnings", value: totalEarned, icon: DollarSign, format: formatCurrency },
    { name: "Referrals", value: referralCount, icon: Users, format: formatNumber },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat) => (
        <Card key={stat.name} className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{stat.name}</CardTitle>
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <stat.icon className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat.format(stat.value)}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
