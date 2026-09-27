import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Gift } from "lucide-react";
import Link from "next/link";

export async function FeaturedOffers() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: featuredOffers }, { data: offerStats }] = await Promise.all([
    supabase
      .from("affiliate_offers")
      .select(`id, name, category:categories(name), reward_eligible, active, display_order`)
      .eq("active", true)
      .eq("reward_eligible", true)
      .order("display_order", { ascending: true })
      .limit(4),
    supabase
      .from("user_activities")
      .select("offer_id, activity_type")
      .eq("user_id", user?.id),
  ]);

  if (!featuredOffers || featuredOffers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Featured Opportunities</CardTitle>
          <CardDescription>Reward-eligible referral links hand-picked for you.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No offers available yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Featured Opportunities</CardTitle>
        <CardDescription>Reward-eligible referral links hand-picked for you.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {featuredOffers.map((offer: any) => {
            const clicks = offerStats?.filter((s) => s.offer_id === offer.id && s.activity_type === "click").length ?? 0;
            return (
              <Link
                key={offer.id}
                href={`/dashboard/offers#${offer.category?.name?.toLowerCase().replace(/\s+/g, "-") ?? "all"}`}
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
      </CardContent>
    </Card>
  );
}
