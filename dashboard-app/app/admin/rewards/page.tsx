import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createRewardPeriod,
  calculateRewards,
  approveRewards,
  distributeRewardsWithTx,
  getAirdropWalletBalanceAction,
  airdropRewards,
} from "@/lib/actions";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function AdminRewardsPage() {
  const supabase = createClient();
  const { data: periods } = await supabase
    .from("reward_periods")
    .select("*, allocation_model:allocation_models(name, community_rewards_pct)")
    .order("created_at", { ascending: false });
  const { data: models } = await supabase.from("allocation_models").select("id, name").eq("is_active", true);
  const { data: rewards } = await supabase
    .from("user_rewards")
    .select("*, user:users(display_name, email), period:reward_periods(start_date, end_date)")
    .order("created_at", { ascending: false })
    .limit(100);

  const totalsByPeriod = new Map<string, { count: number; aud: number; bitxbit: number }>();
  rewards?.forEach((r) => {
    const current = totalsByPeriod.get(r.reward_period_id) || { count: 0, aud: 0, bitxbit: 0 };
    current.count += 1;
    current.aud += r.estimated_aud_value || 0;
    current.bitxbit += r.bitxbit_amount || 0;
    totalsByPeriod.set(r.reward_period_id, current);
  });

  let airdropBalance = { sol: 0, token: 0 };
  try {
    airdropBalance = await getAirdropWalletBalanceAction();
  } catch {
    airdropBalance = { sol: 0, token: 0 };
  }

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Reward Periods</h1>
        <p className="text-muted-foreground mt-1">Create periods, calculate rewards, approve and distribute.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Create Reward Period</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createRewardPeriod} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-sm font-medium mb-1">Start Date</label>
                <input name="startDate" type="date" className="input w-full" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">End Date</label>
                <input name="endDate" type="date" className="input w-full" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Allocation Model</label>
                <select name="allocationModelId" className="input w-full" required>
                  <option value="">Select model</option>
                  {models?.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-3">
                <Button type="submit">Create Period</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Airdrop Wallet</CardTitle>
            <CardDescription>Balance available for token distributions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-muted">
                <div className="text-xs text-muted-foreground">bitxbit Balance</div>
                <div className="font-semibold">{airdropBalance.token.toFixed(4)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <div className="text-xs text-muted-foreground">SOL Balance</div>
                <div className="font-semibold">{airdropBalance.sol.toFixed(4)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6 mb-8">
        {periods?.map((period) => {
          const totals = totalsByPeriod.get(period.id);
          const canAirdrop = period.status === "approved" && (totals?.bitxbit ?? 0) > 0;
          return (
            <Card key={period.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{formatDate(period.start_date)} – {formatDate(period.end_date)}</CardTitle>
                    <CardDescription>
                      Model: {period.allocation_model?.name ?? "None"} · Community rewards: {period.allocation_model?.community_rewards_pct ?? 0}%
                    </CardDescription>
                  </div>
                  <Badge variant={period.status === "distributed" ? "default" : "secondary"}>{period.status}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-xs text-muted-foreground">Total Income</div>
                    <div className="font-semibold">{formatCurrency(period.total_income)}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-xs text-muted-foreground">Recipients</div>
                    <div className="font-semibold">{totals?.count ?? 0}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-xs text-muted-foreground">Estimated AUD</div>
                    <div className="font-semibold">{formatCurrency(totals?.aud ?? 0)}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-xs text-muted-foreground">bitxbit</div>
                    <div className="font-semibold">{(totals?.bitxbit ?? 0).toFixed(4)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 items-end">
                  <form action={calculateRewards.bind(null, period.id)}>
                    <Button type="submit" size="sm" variant="outline">Calculate</Button>
                  </form>
                  <form action={approveRewards.bind(null, period.id)}>
                    <Button type="submit" size="sm" variant="outline">Approve</Button>
                  </form>
                  {canAirdrop && (
                    <form action={airdropRewards.bind(null, period.id)}>
                      <Button type="submit" size="sm">Airdrop Tokens</Button>
                    </form>
                  )}
                  <form action={distributeRewardsWithTx.bind(null, period.id)} className="flex gap-2 items-end">
                    <input
                      name="txHash"
                      placeholder="Manual tx signature"
                      className="input text-sm w-48"
                      required
                    />
                    <Button type="submit" size="sm" variant="outline">Mark Distributed</Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Reward Records</CardTitle>
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
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No rewards calculated yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
