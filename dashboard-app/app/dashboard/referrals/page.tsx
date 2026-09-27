import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/dashboard/copy-button";
import { ReferralsSkeleton } from "@/components/dashboard/referrals-skeleton";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/utils";
import { Users, MousePointer, TrendingUp, UserPlus } from "lucide-react";

interface ReferralWithStats {
  id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
  wallet_address: string | null;
  activities: number;
  rewards: number;
  bonus: number;
}

export default function ReferralsPage() {
  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Referrals</h1>
        <p className="text-muted-foreground mt-1">
          Invite others and earn a 5% bonus on their reward-generating activity.
        </p>
      </div>

      <Suspense fallback={<ReferralsSkeleton />}>
        <ReferralsData />
      </Suspense>
    </div>
  );
}

async function ReferralsData() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: currentUser } = await supabase
    .from("users")
    .select("referral_code")
    .eq("id", user.id)
    .single();

  const referralCode = currentUser?.referral_code;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.bitxbit.com.au";
  const referralLink = referralCode ? `${appUrl}/auth/signup?ref=${referralCode}` : null;

  const { data: referrals } = await supabase
    .from("users")
    .select("id, display_name, email, created_at, wallet_address")
    .eq("referred_by", user.id)
    .order("created_at", { ascending: false });

  const referralIds = referrals?.map((r) => r.id) ?? [];

  let activities: { user_id: string; activity_type: string }[] = [];
  let rewards: { user_id: string; estimated_aud_value: number | null }[] = [];

  if (referralIds.length > 0) {
    const [activitiesRes, rewardsRes] = await Promise.all([
      supabase
        .from("user_activities")
        .select("user_id, activity_type")
        .in("user_id", referralIds),
      supabase
        .from("user_rewards")
        .select("user_id, estimated_aud_value")
        .in("user_id", referralIds),
    ]);
    activities = activitiesRes.data ?? [];
    rewards = rewardsRes.data ?? [];
  }

  const referralsWithStats: ReferralWithStats[] = (referrals ?? []).map((referral) => {
    const userActivities = activities.filter((a) => a.user_id === referral.id);
    const userRewards = rewards.filter((r) => r.user_id === referral.id);
    const rewardsTotal = userRewards.reduce(
      (sum, r) => sum + (r.estimated_aud_value ?? 0),
      0
    );

    return {
      id: referral.id,
      display_name: referral.display_name,
      email: referral.email,
      created_at: referral.created_at,
      wallet_address: referral.wallet_address,
      activities: userActivities.length,
      rewards: rewardsTotal,
      bonus: rewardsTotal * 0.05,
    };
  });

  const totalClicks = activities.filter((a) => a.activity_type === "click").length;
  const totalBonus = referralsWithStats.reduce((sum, r) => sum + r.bonus, 0);

  const stats = [
    { label: "Referred Members", value: referralsWithStats.length, icon: Users },
    { label: "Referral Clicks", value: totalClicks, icon: MousePointer },
    { label: "Est. 5% Bonus", value: formatCurrency(totalBonus), icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-border/50 bg-card/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted-foreground">{stat.label}</div>
                <stat.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Referral Link</CardTitle>
          <CardDescription>Share this link to invite new members.</CardDescription>
        </CardHeader>
        <CardContent>
          {referralLink ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <Input value={referralLink} readOnly className="flex-1 bg-muted/30" />
              <CopyButton text={referralLink} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Your referral code is being generated.</p>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            You earn 5% of the reward-generating activity from anyone who joins through your link.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Referred Members</CardTitle>
          <CardDescription>People who joined using your link and the value they&apos;ve generated.</CardDescription>
        </CardHeader>
        <CardContent>
          {referralsWithStats.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Joined</th>
                    <th>Activities</th>
                    <th>Rewards Generated</th>
                    <th>Your Bonus</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {referralsWithStats.map((referral) => (
                    <tr key={referral.id}>
                      <td>
                        <div className="font-medium">{referral.display_name ?? "Anonymous"}</div>
                        <div className="text-xs text-muted-foreground">{referral.email}</div>
                      </td>
                      <td>
                        <div>{formatDate(referral.created_at)}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatRelativeTime(referral.created_at)}
                        </div>
                      </td>
                      <td>{referral.activities}</td>
                      <td>{formatCurrency(referral.rewards)}</td>
                      <td>{formatCurrency(referral.bonus)}</td>
                      <td>
                        <Badge variant={referral.wallet_address ? "default" : "outline"}>
                          {referral.wallet_address ? "Wallet connected" : "No wallet"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <UserPlus className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No referrals yet</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Share your link to start building your network.
              </p>
              {referralLink && <CopyButton text={referralLink} label="Copy Link" />}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
