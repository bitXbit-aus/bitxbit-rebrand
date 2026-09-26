import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";

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

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Rewards</h1>
        <p className="text-muted-foreground mt-1">Your estimated and distributed bitxbit token rewards.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reward History</CardTitle>
          <CardDescription>All reward allocations across periods.</CardDescription>
        </CardHeader>
        <CardContent>
          {rewards && rewards.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Estimated (AUD)</th>
                  <th>bitxbit Amount</th>
                  <th>Status</th>
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
                    <td>{formatDate(reward.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No rewards yet. Participate in referrals to start earning.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
