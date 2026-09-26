import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { Activity, DollarSign, Gift, Users, Wallet } from "lucide-react";
import Link from "next/link";

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

  const { data: referrals } = await supabase
    .from("users")
    .select("id")
    .eq("referred_by", user?.id);

  const { data: recentActivities } = await supabase
    .from("user_activities")
    .select(`
      *,
      offer:affiliate_offers(name)
    `)
    .eq("user_id", user?.id)
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: featuredOffers } = await supabase
    .from("affiliate_offers")
    .select(`
      *,
      category:categories(name)
    `)
    .eq("active", true)
    .eq("reward_eligible", true)
    .order("display_order", { ascending: true })
    .limit(3);

  const { data: offerStats } = await supabase
    .from("user_activities")
    .select("offer_id, activity_type")
    .eq("user_id", user?.id);

  const totalActivities = activities?.length ?? 0;
  const pendingRewards = rewards?.filter((r) => r.status === "pending").length ?? 0;
  const totalEarned = rewards?.reduce((sum, r) => sum + (r.estimated_aud_value ?? 0), 0) ?? 0;

  const stats = [
    { name: "Your Activities", value: totalActivities, icon: Activity, format: formatNumber },
    { name: "Pending Rewards", value: pendingRewards, icon: Wallet, format: formatNumber },
    { name: "Estimated Earnings", value: totalEarned, icon: DollarSign, format: formatCurrency },
    { name: "Referrals", value: referrals?.length ?? 0, icon: Users, format: formatNumber },
  ];

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your participation in the bitXbit ecosystem.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Featured Opportunities</CardTitle>
            <CardDescription>Reward-eligible referral links hand-picked for you.</CardDescription>
          </CardHeader>
          <CardContent>
            {featuredOffers && featuredOffers.length > 0 ? (
              <div className="space-y-3">
                {featuredOffers.map((offer) => {
                  const clicks = offerStats?.filter((s) => s.offer_id === offer.id && s.activity_type === "click").length ?? 0;
                  return (
                    <Link
                      key={offer.id}
                      href={`/dashboard/offers#${offer.category?.name.toLowerCase().replace(/\s+/g, "-") ?? "all"}`}
                      className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
                    >
                      <div>
                        <p className="font-medium text-sm">{offer.name}</p>
                        <p className="text-xs text-muted-foreground">{offer.category?.name ?? "Offer"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {clicks > 0 && (
                          <span className="text-xs text-muted-foreground">{clicks} click{clicks === 1 ? "" : "s"}</span>
                        )}
                        <Gift className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  );
                })}
                <Link
                  href="/dashboard/offers"
                  className="inline-flex items-center text-sm text-primary hover:underline pt-2"
                >
                  Browse all offers →
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No offers available yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Your latest referral link clicks.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivities && recentActivities.length > 0 ? (
              <div className="space-y-3">
                {recentActivities.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-center justify-between py-2 border-b border-border last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium capitalize">{activity.activity_type}</p>
                      <p className="text-xs text-muted-foreground">
                        {activity.offer?.name ?? "Direct"}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(activity.created_at)}
                    </span>
                  </div>
                ))}
                <Link
                  href="/dashboard/activity"
                  className="inline-flex items-center text-sm text-primary hover:underline pt-2"
                >
                  View all activity →
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No activity yet. Visit an offer to start tracking.
              </p>
            )}
          </CardContent>
        </Card>
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
            <CardTitle>Next Steps</CardTitle>
            <CardDescription>Get the most out of bitXbit.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Link
                href="/dashboard/offers"
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
              >
                <span className="text-sm font-medium">Explore referral offers</span>
                <span className="text-primary text-sm">→</span>
              </Link>
              <Link
                href="/dashboard/wallet"
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
              >
                <span className="text-sm font-medium">Connect your Solana wallet</span>
                <span className="text-primary text-sm">→</span>
              </Link>
              <Link
                href="/dashboard/transparency"
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
              >
                <span className="text-sm font-medium">View transparency reports</span>
                <span className="text-primary text-sm">→</span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
