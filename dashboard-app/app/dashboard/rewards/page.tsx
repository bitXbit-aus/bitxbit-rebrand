import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Clock, Coins, DollarSign, Download, Wallet } from "lucide-react";
import Link from "next/link";
import { RewardsPageChart } from "./rewards-page-chart";

export default async function RewardsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: rewards } = await supabase
    .from("user_rewards")
    .select(`
      *,
      period:reward_periods(start_date, end_date)
    `)
    .eq("user_id", user?.id)
    .order("created_at", { ascending: false });

  const totalEarned = rewards?.reduce((sum, r) => sum + (r.estimated_aud_value ?? 0), 0) ?? 0;
  const totalBitxbit = rewards?.reduce((sum, r) => sum + (r.bitxbit_amount ?? 0), 0) ?? 0;
  const distributed = rewards?.filter((r) => r.status === "distributed").length ?? 0;
  const pending = rewards?.filter((r) => r.status === "pending").length ?? 0;

  const chartData = (rewards ?? [])
    .filter((r) => r.period)
    .map((r) => ({
      name: `${formatDate(r.period.start_date)} – ${formatDate(r.period.end_date)}`,
      aud: r.estimated_aud_value ?? 0,
      bitxbit: r.bitxbit_amount ?? 0,
      status: r.status,
    }))
    .reverse();

  const stats = [
    { name: "Total Estimated (AUD)", value: formatCurrency(totalEarned), icon: DollarSign },
    { name: "Total bitxbit", value: totalBitxbit.toFixed(4), icon: Coins },
    { name: "Pending", value: pending, icon: Clock },
    { name: "Distributed", value: distributed, icon: Wallet },
  ];

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Rewards</h1>
        <p className="text-muted-foreground mt-1">Your estimated and distributed bitxbit token rewards.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Card key={stat.name} className="border-border/50 bg-card/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted-foreground">{stat.name}</div>
                <stat.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {chartData.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Reward Trend</CardTitle>
            <CardDescription>Your estimated rewards across periods.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <RewardsPageChart data={chartData} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Reward History</CardTitle>
            <CardDescription>All reward allocations across periods.</CardDescription>
          </div>
          {rewards && rewards.length > 0 && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/rewards">Export CSV</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {rewards && rewards.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Estimated (AUD)</th>
                    <th>bitxbit Amount</th>
                    <th>Status</th>
                    <th>Tx Hash</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {rewards.map((reward) => (
                    <tr key={reward.id}>
                      <td>
                        {reward.period
                          ? `${formatDate(reward.period.start_date)} – ${formatDate(reward.period.end_date)}`
                          : "—"}
                      </td>
                      <td>{formatCurrency(reward.estimated_aud_value)}</td>
                      <td>{reward.bitxbit_amount ? reward.bitxbit_amount.toFixed(4) : "—"}</td>
                      <td>
                        <Badge variant={reward.status === "distributed" ? "default" : "secondary"}>
                          {reward.status}
                        </Badge>
                      </td>
                      <td className="font-mono text-xs max-w-xs truncate">
                        {reward.distribution_tx_hash ? (
                          <a
                            href={`https://solscan.io/tx/${reward.distribution_tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {reward.distribution_tx_hash.slice(0, 12)}...
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{formatDate(reward.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Coins className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No rewards yet</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Participate in referrals to start earning bitxbit rewards.
              </p>
              <Button asChild>
                <Link href="/dashboard/offers">Explore Offers</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
