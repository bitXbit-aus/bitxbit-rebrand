import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormWithToast } from "@/components/dashboard/form-with-toast";
import {
  createRewardPeriod,
  calculateRewards,
  approveRewards,
  distributeRewardsWithTx,
  getAirdropWalletBalanceAction,
  airdropRewards,
  sendTestAirdrop,
} from "@/lib/actions";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SolanaAddress } from "@/components/dashboard/solana-address";

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

  const { data: airdropTxs } = await supabase
    .from("user_rewards")
    .select("id, bitxbit_amount, estimated_aud_value, distribution_tx_hash, distributed_at, user:users(display_name, email), period:reward_periods(start_date, end_date)")
    .eq("status", "distributed")
    .not("distribution_tx_hash", "is", null)
    .order("distributed_at", { ascending: false })
    .limit(50);

  let airdropBalance = { sol: 0, token: 0 };
  try {
    airdropBalance = await getAirdropWalletBalanceAction();
  } catch {
    airdropBalance = { sol: 0, token: 0 };
  }

  const normalizedAirdropTxs = (airdropTxs ?? []).map((tx: any) => ({
    ...tx,
    user: Array.isArray(tx.user) ? tx.user[0] ?? null : tx.user,
    period: Array.isArray(tx.period) ? tx.period[0] ?? null : tx.period,
  }));

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
            <FormWithToast
              action={createRewardPeriod}
              successMessage="Reward period created"
              className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end"
            >
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
            </FormWithToast>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Airdrop Wallet</CardTitle>
            <CardDescription>Balance available for token distributions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="p-3 rounded-lg bg-muted">
                <div className="text-xs text-muted-foreground">bitxbit Balance</div>
                <div className="font-semibold">{airdropBalance.token.toFixed(4)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <div className="text-xs text-muted-foreground">SOL Balance</div>
                <div className="font-semibold">{airdropBalance.sol.toFixed(4)}</div>
              </div>
            </div>
            <FormWithToast
              action={sendTestAirdrop}
              successMessage="Test airdrop sent"
              errorMessage="Test airdrop failed"
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                name="walletAddress"
                placeholder="Test wallet address"
                className="input flex-1 text-sm"
                required
              />
              <Button type="submit" size="sm" variant="outline">Send 0.001 Test</Button>
            </FormWithToast>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6 mb-8">
        {periods?.map((period) => {
          const totals = totalsByPeriod.get(period.id);
          const canAirdrop = period.status === "approved" && (totals?.bitxbit ?? 0) > 0;
          const tokensNeeded = totals?.bitxbit ?? 0;
          const hasEnoughTokens = airdropBalance.token >= tokensNeeded;
          const solNeeded = (totals?.count ?? 0) * 0.005;
          const hasEnoughSol = airdropBalance.sol >= solNeeded;
          const canRunAirdrop = canAirdrop && hasEnoughTokens && hasEnoughSol;
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
                  <FormWithToast
                    action={calculateRewards.bind(null, period.id)}
                    successMessage="Rewards calculated"
                    errorMessage="Reward calculation failed"
                  >
                    <Button type="submit" size="sm" variant="outline">Calculate</Button>
                  </FormWithToast>
                  <FormWithToast
                    action={approveRewards.bind(null, period.id)}
                    successMessage="Rewards approved"
                    errorMessage="Could not approve rewards"
                  >
                    <Button type="submit" size="sm" variant="outline">Approve</Button>
                  </FormWithToast>
                  {canAirdrop && (
                    <FormWithToast
                      action={airdropRewards.bind(null, period.id)}
                      successMessage="Airdrop complete"
                      errorMessage="Airdrop failed"
                    >
                      <Button type="submit" size="sm" disabled={!canRunAirdrop}>
                        Airdrop Tokens
                      </Button>
                    </FormWithToast>
                  )}
                  <FormWithToast
                    action={distributeRewardsWithTx.bind(null, period.id)}
                    successMessage="Marked as distributed"
                    errorMessage="Could not mark distributed"
                    className="flex gap-2 items-end"
                  >
                    <input
                      name="txHash"
                      placeholder="Manual tx signature"
                      className="input text-sm w-48"
                      required
                    />
                    <Button type="submit" size="sm" variant="outline">Mark Distributed</Button>
                  </FormWithToast>
                </div>
                {canAirdrop && !canRunAirdrop && (
                  <div className="mt-3 text-xs text-amber-400">
                    {!hasEnoughTokens && (
                      <div>Insufficient bitxbit: wallet has {airdropBalance.token.toFixed(4)}, needs {tokensNeeded.toFixed(4)}</div>
                    )}
                    {!hasEnoughSol && (
                      <div>Insufficient SOL: wallet has {airdropBalance.sol.toFixed(4)}, needs ~{solNeeded.toFixed(4)}</div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Airdrop Transactions</CardTitle>
          <CardDescription>Recent on-chain distributions with Solscan links.</CardDescription>
        </CardHeader>
        <CardContent>
          {normalizedAirdropTxs && normalizedAirdropTxs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Period</th>
                    <th>bitxbit</th>
                    <th>Estimated</th>
                    <th>Date</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {normalizedAirdropTxs.map((tx: any) => (
                    <tr key={tx.id}>
                      <td>
                        <div className="font-medium">{tx.user?.display_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{tx.user?.email}</div>
                      </td>
                      <td>
                        {tx.period
                          ? `${formatDate(tx.period.start_date)} – ${formatDate(tx.period.end_date)}`
                          : "—"}
                      </td>
                      <td>{tx.bitxbit_amount ? tx.bitxbit_amount.toFixed(4) : "—"}</td>
                      <td>{formatCurrency(tx.estimated_aud_value)}</td>
                      <td>{tx.distributed_at ? formatDate(tx.distributed_at) : "—"}</td>
                      <td>
                        {tx.distribution_tx_hash ? (
                          <SolanaAddress address={tx.distribution_tx_hash} showCopy={false} />
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No airdrop transactions recorded yet.</p>
          )}
        </CardContent>
      </Card>

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
