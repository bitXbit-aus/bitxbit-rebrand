import { createServiceClient } from "@/lib/supabase/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber, formatDate } from "@/lib/utils";
import {
  DollarSign,
  Users,
  PiggyBank,
  HandCoins,
  Tag,
  Layers,
  MousePointerClick,
  TrendingUp,
  Activity,
} from "lucide-react";

export default async function AdminOverviewPage() {
  const supabase = createServiceClient();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    { count: totalUsers },
    { count: activeOffers },
    { count: categories },
    { data: income },
    { data: incomeThisMonth },
    { data: pendingRewards },
    { data: projects },
    { data: clicks },
    { data: recentUsers },
    { data: topReferrers },
    { data: recentActivity },
  ] = await Promise.all([
    supabase.from("users").select("*", { count: "exact", head: true }),
    supabase.from("affiliate_offers").select("*", { count: "exact", head: true }).eq("active", true),
    supabase.from("categories").select("*", { count: "exact", head: true }),
    supabase.from("affiliate_income").select("amount"),
    supabase.from("affiliate_income").select("amount").gte("date_received", startOfMonth),
    supabase.from("user_rewards").select("id").eq("status", "pending"),
    supabase.from("projects").select("amount_allocated"),
    supabase.from("user_activities").select("id", { count: "exact", head: true }).eq("activity_type", "click"),
    supabase
      .from("users")
      .select("id, display_name, email, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("users")
      .select("id, display_name, email, referral_code, referred_users:users!referred_by(count)")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("user_activities")
      .select("id, activity_type, created_at, users(display_name, email), affiliate_offers(name)")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const totalIncome = income?.reduce((sum, i) => sum + (i.amount || 0), 0) ?? 0;
  const monthIncome = incomeThisMonth?.reduce((sum, i) => sum + (i.amount || 0), 0) ?? 0;
  const totalProjects = projects?.reduce((sum, p) => sum + (p.amount_allocated || 0), 0) ?? 0;

  const stats = [
    { name: "Total Users", value: totalUsers ?? 0, icon: Users, format: formatNumber },
    { name: "Active Offers", value: activeOffers ?? 0, icon: Tag, format: formatNumber },
    { name: "Categories", value: categories ?? 0, icon: Layers, format: formatNumber },
    { name: "Total Income", value: totalIncome, icon: DollarSign, format: formatCurrency },
    { name: "Income This Month", value: monthIncome, icon: TrendingUp, format: formatCurrency },
    { name: "Pending Rewards", value: pendingRewards?.length ?? 0, icon: HandCoins, format: formatNumber },
    { name: "Projects Funded", value: totalProjects, icon: PiggyBank, format: formatCurrency },
    { name: "Offer Clicks", value: (clicks as number | null) ?? 0, icon: MousePointerClick, format: formatNumber },
  ];

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Admin Overview</h1>
        <p className="text-muted-foreground mt-1">High-level metrics for the bitXbit ecosystem.</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Quick Links</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { name: "Analytics", href: "/admin/analytics" },
                { name: "Offers", href: "/admin/offers" },
                { name: "Categories", href: "/admin/categories" },
                { name: "Income", href: "/admin/income" },
                { name: "Rewards", href: "/admin/rewards" },
                { name: "Users", href: "/admin/users" },
                { name: "Referrals", href: "/admin/referrals" },
                { name: "Projects", href: "/admin/projects" },
                { name: "Transparency", href: "/admin/transparency-updates" },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-center p-4 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm font-medium"
                >
                  {link.name}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Signups</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentUsers?.map((user) => (
                <div key={user.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium truncate max-w-[160px]">
                    {user.display_name || user.email || "Unnamed"}
                  </span>
                  <span className="text-muted-foreground text-xs">{formatDate(user.created_at)}</span>
                </div>
              ))}
              {!recentUsers?.length && <p className="text-sm text-muted-foreground">No signups yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Top Referrers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topReferrers?.map((user: any) => {
                const count = Array.isArray(user.referred_users)
                  ? user.referred_users.length
                  : Number(user.referred_users?.count ?? 0);
                return (
                  <div key={user.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium truncate max-w-[200px]">
                      {user.display_name || user.email || "Unnamed"}
                    </span>
                    <span className="text-muted-foreground text-xs">{count} referred</span>
                  </div>
                );
              })}
              {!topReferrers?.length && <p className="text-sm text-muted-foreground">No referrers yet.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivity?.map((activity: any) => (
                <div key={activity.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="capitalize">{activity.activity_type}</span>
                    {activity.affiliate_offers?.name && (
                      <span className="text-muted-foreground truncate max-w-[120px]">
                        • {activity.affiliate_offers.name}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs">{formatDate(activity.created_at)}</span>
                </div>
              ))}
              {!recentActivity?.length && <p className="text-sm text-muted-foreground">No activity yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
