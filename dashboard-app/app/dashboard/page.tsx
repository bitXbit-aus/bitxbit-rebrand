import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Activity, DollarSign, Users, Wallet } from "lucide-react";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch member stats
  const { data: activities } = await supabase
    .from("user_activities")
    .select("id")
    .eq("user_id", user?.id);

  const { data: rewards } = await supabase
    .from("user_rewards")
    .select("estimated_aud_value, status")
    .eq("user_id", user?.id);

  const totalActivities = activities?.length ?? 0;
  const pendingRewards = rewards?.filter((r) => r.status === "pending").length ?? 0;
  const totalEarned = rewards?.reduce((sum, r) => sum + (r.estimated_aud_value ?? 0), 0) ?? 0;

  const stats = [
    { name: "Your Activities", value: totalActivities, icon: Activity, format: formatNumber },
    { name: "Pending Rewards", value: pendingRewards, icon: Wallet, format: formatNumber },
    { name: "Estimated Earnings", value: totalEarned, icon: DollarSign, format: formatCurrency },
  ];

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your participation in the bitXbit ecosystem.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {stats.map((stat) => (
          <Card key={stat.name}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.name}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.format(stat.value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Ecosystem Flow</CardTitle>
            <CardDescription>How referral income supports the community.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { label: "Community Rewards", value: 40, color: "bg-blue-500" },
                { label: "Liquidity", value: 25, color: "bg-emerald-500" },
                { label: "Buybacks", value: 15, color: "bg-purple-500" },
                { label: "Projects", value: 10, color: "bg-amber-500" },
                { label: "Operations", value: 10, color: "bg-slate-500" },
              ].map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{item.label}</span>
                    <span className="text-muted-foreground">{item.value}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full`} style={{ width: `${item.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest Opportunities</CardTitle>
            <CardDescription>New referral links added recently.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Visit the Referrals page on the marketing site to explore all available opportunities.</p>
              <a
                href="https://bitxbit.com.au/referrals"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm text-primary hover:underline"
              >
                Explore Referrals →
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
