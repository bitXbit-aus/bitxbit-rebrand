import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Trophy, Users, MousePointer, TrendingUp } from "lucide-react";

export default async function AdminReferralsPage() {
  const supabase = createClient();

  const { data: users } = await supabase
    .from("users")
    .select("id, display_name, email, referral_code, created_at");

  const { data: referrals } = await supabase
    .from("users")
    .select("id, referred_by, display_name, email, created_at");

  const { data: activities } = await supabase
    .from("user_activities")
    .select("user_id, activity_type");

  const { data: rewards } = await supabase
    .from("user_rewards")
    .select("user_id, estimated_aud_value");

  const referralCounts = new Map<string, number>();
  const referralClicks = new Map<string, number>();
  const referralRewards = new Map<string, number>();

  referrals?.forEach((ref) => {
    if (ref.referred_by) {
      referralCounts.set(ref.referred_by, (referralCounts.get(ref.referred_by) || 0) + 1);
    }
  });

  activities?.forEach((a) => {
    const referrer = referrals?.find((r) => r.id === a.user_id)?.referred_by;
    if (referrer && a.activity_type === "click") {
      referralClicks.set(referrer, (referralClicks.get(referrer) || 0) + 1);
    }
  });

  rewards?.forEach((r) => {
    const referrer = referrals?.find((ref) => ref.id === r.user_id)?.referred_by;
    if (referrer) {
      referralRewards.set(referrer, (referralRewards.get(referrer) || 0) + (r.estimated_aud_value ?? 0));
    }
  });

  const leaderboard = users
    ?.map((user) => ({
      ...user,
      count: referralCounts.get(user.id) || 0,
      clicks: referralClicks.get(user.id) || 0,
      rewards: referralRewards.get(user.id) || 0,
      bonus: (referralRewards.get(user.id) || 0) * 0.05,
    }))
    .filter((u) => u.count > 0)
    .sort((a, b) => b.count - a.count);

  const totalReferrals = referrals?.filter((r) => r.referred_by).length ?? 0;
  const totalReferralRewards = Array.from(referralRewards.values()).reduce((sum, v) => sum + v, 0);

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Referrals</h1>
        <p className="text-muted-foreground mt-1">Leaderboard and referral ecosystem metrics.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Total Referrals</div>
                <div className="text-2xl font-bold">{formatNumber(totalReferrals)}</div>
              </div>
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Total Referral Clicks</div>
                <div className="text-2xl font-bold">
                  {formatNumber(Array.from(referralClicks.values()).reduce((sum, v) => sum + v, 0))}
                </div>
              </div>
              <MousePointer className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Est. 5% Bonuses</div>
                <div className="text-2xl font-bold">{formatCurrency(totalReferralRewards * 0.05)}</div>
              </div>
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            <CardTitle>Top Referrers</CardTitle>
          </div>
          <CardDescription>Members ranked by number of successful referrals.</CardDescription>
        </CardHeader>
        <CardContent>
          {leaderboard && leaderboard.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Member</th>
                  <th>Referrals</th>
                  <th>Clicks</th>
                  <th>Ref. Rewards (AUD)</th>
                  <th>Est. 5% Bonus</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((u, index) => (
                  <tr key={u.id}>
                    <td>
                      <Badge variant={index < 3 ? "default" : "outline"}>#{index + 1}</Badge>
                    </td>
                    <td>
                      <div className="font-medium">{u.display_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td>{u.count}</td>
                    <td>{u.clicks}</td>
                    <td>{formatCurrency(u.rewards)}</td>
                    <td>{formatCurrency(u.bonus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No referrals recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
