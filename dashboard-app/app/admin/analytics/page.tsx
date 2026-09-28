import { createServiceClient } from "@/lib/supabase/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { OfferClicksChart } from "@/components/dashboard/offer-clicks-chart";
import { MousePointerClick, Calendar, TrendingUp, Eye } from "lucide-react";

interface ClickActivity {
  id: string;
  created_at: string;
  offer_id: string | null;
  affiliate_offers: { name: string } | null;
  users: { display_name: string | null; email: string | null } | null;
}

interface OfferRow {
  id: string;
  name: string;
  category?: { name: string } | { name: string }[] | null;
}

export default async function AdminAnalyticsPage() {
  const supabase = createServiceClient();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

  const [{ data: clicks }, { data: offersRaw }, { data: recentClicks }] = await Promise.all([
    supabase
      .from("user_activities")
      .select("id, created_at, offer_id, affiliate_offers(name)")
      .eq("activity_type", "click"),
    supabase
      .from("affiliate_offers")
      .select("id, name, category:categories(name)")
      .order("display_order"),
    supabase
      .from("user_activities")
      .select("id, created_at, offer_id, affiliate_offers(name), users(display_name, email)")
      .eq("activity_type", "click")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const typedClicks = (clicks ?? []) as unknown as ClickActivity[];
  const typedRecent = (recentClicks ?? []) as unknown as ClickActivity[];
  const offers = (offersRaw ?? []) as unknown as OfferRow[];

  const offerMap = new Map(offers.map((o) => [o.id, o]));

  const allTimeByOffer = new Map<string, number>();
  const last30ByOffer = new Map<string, number>();

  typedClicks.forEach((click) => {
    const offerId = click.offer_id ?? "uncategorised";
    allTimeByOffer.set(offerId, (allTimeByOffer.get(offerId) || 0) + 1);
    if (click.created_at >= thirtyDaysAgoIso) {
      last30ByOffer.set(offerId, (last30ByOffer.get(offerId) || 0) + 1);
    }
  });

  function categoryName(offer: OfferRow) {
    const cat = offer.category;
    if (Array.isArray(cat)) return cat[0]?.name ?? "Uncategorised";
    return cat?.name ?? "Uncategorised";
  }

  const tableData = offers
    .map((offer) => ({
      id: offer.id,
      name: offer.name,
      category: categoryName(offer),
      allTime: allTimeByOffer.get(offer.id) || 0,
      last30: last30ByOffer.get(offer.id) || 0,
    }))
    .sort((a, b) => b.allTime - a.allTime);

  const chartData = tableData
    .filter((o) => o.allTime > 0)
    .slice(0, 10)
    .map((o) => ({ name: o.name, clicks: o.allTime }));

  const totalAllTime = typedClicks.length;
  const totalLast30 = typedClicks.filter((c) => c.created_at >= thirtyDaysAgoIso).length;

  const topOffer = tableData[0];

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Analytics</h1>
        <p className="text-muted-foreground mt-1">Offer clicks, referrals, and ecosystem activity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Clicks</CardTitle>
            <MousePointerClick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalAllTime)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clicks Last 30 Days</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalLast30)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Offers</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(offers?.length ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Top Offer</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold truncate">{topOffer?.name ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{topOffer ? `${formatNumber(topOffer.allTime)} clicks` : ""}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Offers by Clicks</CardTitle>
          </CardHeader>
          <CardContent>
            <OfferClicksChart data={chartData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Offer Click Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 font-medium text-muted-foreground">Offer</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Category</th>
                    <th className="text-right py-2 font-medium text-muted-foreground">30d</th>
                    <th className="text-right py-2 font-medium text-muted-foreground">All Time</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((offer) => (
                    <tr key={offer.id} className="border-b border-border/50">
                      <td className="py-2 font-medium">{offer.name}</td>
                      <td className="py-2 text-muted-foreground">{offer.category}</td>
                      <td className="py-2 text-right">{formatNumber(offer.last30)}</td>
                      <td className="py-2 text-right">{formatNumber(offer.allTime)}</td>
                    </tr>
                  ))}
                  {tableData.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-muted-foreground">No offers found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Clicks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium text-muted-foreground">Time</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">Offer</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">Member</th>
                </tr>
              </thead>
              <tbody>
                {typedRecent.map((click) => (
                  <tr key={click.id} className="border-b border-border/50">
                    <td className="py-2 text-muted-foreground">
                      {new Date(click.created_at).toLocaleString("en-AU", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-2 font-medium">{click.affiliate_offers?.name ?? "Unknown offer"}</td>
                    <td className="py-2 text-muted-foreground">
                      {click.users?.display_name || click.users?.email || "Anonymous"}
                    </td>
                  </tr>
                ))}
                {typedRecent.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-muted-foreground">No recent clicks.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
