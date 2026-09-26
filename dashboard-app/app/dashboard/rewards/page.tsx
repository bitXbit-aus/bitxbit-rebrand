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

  const totalEarned = rewards?.reduce((sum, r) => sum + (r.estimated_aud_value ?? 0), 0) ?? 0;
  const totalBitxbit = rewards?.reduce((sum, r) => sum + (r.bitxbit_amount ?? 0), 0) ?? 0;
  const distributed = rewards?.filter((r) => r.status === "distributed").length ?? 0;
  const pending = rewards?.filter((r) => r.status === "pending").length ?? 0;

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Rewards</h1>
        <p className="text-muted-foreground mt-1">Your estimated and distributed bitxbit token rewards.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Total Estimated (AUD)</div>
            <div className="text-2xl font-bold">{formatCurrency(totalEarned)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Total bitxbit</div>
            <div className="text-2xl font-bold">{totalBitxbit.toFixed(4)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Pending</div>
            <div className="text-2xl font-bold">{pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Distributed</div>
            <div className="text-2xl font-bold">{distributed}</div>
          </CardContent>
        </Card>
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
          ) : (
            <p className="text-sm text-muted-foreground">No rewards yet. Participate in referrals to start earning.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
