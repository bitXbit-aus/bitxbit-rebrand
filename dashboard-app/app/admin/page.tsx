import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { DollarSign, Users, PiggyBank, HandCoins, Tag, Layers } from "lucide-react";

export default async function AdminOverviewPage() {
  const supabase = createClient();

  const { count: totalUsers } = await supabase.from("users").select("*", { count: "exact", head: true });
  const { count: activeOffers } = await supabase.from("affiliate_offers").select("*", { count: "exact", head: true }).eq("active", true);
  const { count: categories } = await supabase.from("categories").select("*", { count: "exact", head: true });
  const { data: income } = await supabase.from("affiliate_income").select("amount");
  const { data: pendingRewards } = await supabase.from("user_rewards").select("id").eq("status", "pending");
  const { data: projects } = await supabase.from("projects").select("amount_allocated");

  const totalIncome = income?.reduce((sum, i) => sum + (i.amount || 0), 0) ?? 0;
  const totalProjects = projects?.reduce((sum, p) => sum + (p.amount_allocated || 0), 0) ?? 0;

  const stats = [
    { name: "Total Users", value: totalUsers ?? 0, icon: Users, format: formatNumber },
    { name: "Active Offers", value: activeOffers ?? 0, icon: Tag, format: formatNumber },
    { name: "Categories", value: categories ?? 0, icon: Layers, format: formatNumber },
    { name: "Total Income", value: totalIncome, icon: DollarSign, format: formatCurrency },
    { name: "Pending Rewards", value: pendingRewards?.length ?? 0, icon: HandCoins, format: formatNumber },
    { name: "Projects Funded", value: totalProjects, icon: PiggyBank, format: formatCurrency },
  ];

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Admin Overview</h1>
        <p className="text-muted-foreground mt-1">High-level metrics for the bitXbit ecosystem.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Quick Links</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: "Offers", href: "/admin/offers" },
                { name: "Categories", href: "/admin/categories" },
                { name: "Income", href: "/admin/income" },
                { name: "Rewards", href: "/admin/rewards" },
                { name: "Users", href: "/admin/users" },
                { name: "Referrals", href: "/admin/referrals" },
                { name: "Projects", href: "/admin/projects" },
                { name: "Reports", href: "/admin/reports" },
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
            <CardTitle>System Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Database</span>
              <span className="text-emerald-400 font-medium">Connected</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Auth Provider</span>
              <span className="text-emerald-400 font-medium">Supabase Auth</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Wallet Integration</span>
              <span className="text-emerald-400 font-medium">Solana Adapter</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
