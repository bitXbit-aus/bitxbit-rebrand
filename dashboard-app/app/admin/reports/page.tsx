import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { Download, TrendingUp, Users, MousePointer, DollarSign } from "lucide-react";

export default async function AdminReportsPage() {
  const supabase = createClient();

  const { data: income } = await supabase
    .from("affiliate_income")
    .select("*")
    .order("date_received", { ascending: false });

  const { data: activities } = await supabase
    .from("user_activities")
    .select("activity_type, created_at, offer_id, user_id")
    .order("created_at", { ascending: false });

  const { data: offers } = await supabase
    .from("affiliate_offers")
    .select("id, name");

  const { count: totalUsers } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true });

  // Income summary
  const totalIncome = income?.reduce((sum, i) => sum + (i.amount || 0), 0) ?? 0;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthlyIncome = income
    ?.filter((i) => i.date_received.startsWith(thisMonth))
    .reduce((sum, i) => sum + (i.amount || 0), 0) ?? 0;

  // Activity summary
  const totalActivities = activities?.length ?? 0;
  const clicks = activities?.filter((a) => a.activity_type === "click").length ?? 0;
  const signups = activities?.filter((a) => a.activity_type === "signup").length ?? 0;
  const purchases = activities?.filter((a) => a.activity_type === "purchase").length ?? 0;

  // Per-offer activity
  const offerClicks = new Map<string, number>();
  activities?.forEach((a) => {
    if (a.offer_id && a.activity_type === "click") {
      offerClicks.set(a.offer_id, (offerClicks.get(a.offer_id) || 0) + 1);
    }
  });

  const topOffers = Array.from(offerClicks.entries())
    .map(([id, count]) => ({
      id,
      name: offers?.find((o) => o.id === id)?.name ?? "Unknown offer",
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Active users (with any activity)
  const activeUserIds = new Set(activities?.map((a) => a.user_id) ?? []);

  // CSV export
  const csvRows = [
    ["Source", "Amount", "Currency", "Date Received", "Notes"],
    ...(income?.map((i) => [
      i.source,
      i.amount.toString(),
      i.currency,
      i.date_received,
      i.notes ?? "",
    ]) ?? []),
  ];
  const csvContent = csvRows.map((r) => r.map((cell) => `"${cell}"`).join(",")).join("\n");

  const stats = [
    { name: "Total Users", value: totalUsers ?? 0, icon: Users, format: formatNumber },
    { name: "Active Users", value: activeUserIds.size, icon: Users, format: formatNumber },
    { name: "Total Income", value: totalIncome, icon: DollarSign, format: formatCurrency },
    { name: "Income This Month", value: monthlyIncome, icon: TrendingUp, format: formatCurrency },
    { name: "Total Clicks", value: clicks, icon: MousePointer, format: formatNumber },
    { name: "Signups / Purchases", value: `${signups} / ${purchases}`, icon: Users, format: (v: string) => v },
  ];

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Reports</h1>
        <p className="text-muted-foreground mt-1">Analytics, exports and ecosystem overview.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {stats.map((stat) => (
          <Card key={stat.name}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.name}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.format(stat.value as never)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Top Offers by Clicks</CardTitle>
            <CardDescription>Most engaged referral links.</CardDescription>
          </CardHeader>
          <CardContent>
            {topOffers.length > 0 ? (
              <div className="space-y-3">
                {topOffers.map((offer, index) => (
                  <div key={offer.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">#{index + 1}</Badge>
                      <span className="font-medium text-sm">{offer.name}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{offer.count} clicks</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No offer clicks recorded yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export</CardTitle>
            <CardDescription>Download ecosystem data.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Export all {income?.length ?? 0} affiliate income records as CSV.
            </p>
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`}
              download="bitxbit-income.csv"
            >
              <Button>
                <Download className="h-4 w-4 mr-2" />
                Download Income CSV
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Income Records</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Date</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {income?.map((item) => (
                <tr key={item.id}>
                  <td className="font-medium">{item.source}</td>
                  <td>{formatCurrency(item.amount)}</td>
                  <td>{item.currency}</td>
                  <td>{formatDate(item.date_received)}</td>
                  <td className="max-w-xs truncate">{item.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
