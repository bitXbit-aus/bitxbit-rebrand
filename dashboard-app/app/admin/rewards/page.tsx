import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function AdminRewardsPage() {
  const supabase = createClient();
  const { data: rewards } = await supabase
    .from("user_rewards")
    .select(`
      *,
      user:users(display_name, email),
      period:reward_periods(start_date, end_date)
    `)
    .order("created_at", { ascending: false });

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Rewards</h1>
        <p className="text-muted-foreground mt-1">Review and manage user reward allocations.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Rewards</CardTitle>
        </CardHeader>
        <CardContent>
          {rewards && rewards.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Period</th>
                  <th>Estimated</th>
                  <th>bitxbit</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {rewards.map((reward) => (
                  <tr key={reward.id}>
                    <td>
                      <div className="font-medium">{reward.user?.display_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{reward.user?.email}</div>
                    </td>
                    <td>
                      {reward.period
                        ? `${formatDate(reward.period.start_date)} – ${formatDate(reward.period.end_date)}`
                        : "—"}
                    </td>
                    <td>{formatCurrency(reward.estimated_aud_value)}</td>
                    <td>{reward.bitxbit_amount ? reward.bitxbit_amount.toFixed(4) : "—"}</td>
                    <td>
                      <Badge variant={reward.status === "distributed" ? "default" : "secondary"}>{reward.status}</Badge>
                    </td>
                    <td>{formatDate(reward.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No rewards in the system yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
