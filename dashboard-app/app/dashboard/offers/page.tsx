import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OfferCard } from "@/components/offers/offer-card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface Offer {
  id: string;
  name: string;
  description: string | null;
  benefit_text: string | null;
  referral_url: string;
  reward_eligible: boolean;
  category_id: string | null;
  display_order: number;
  category: { name: string } | null;
}

export default async function OffersPage() {
  const supabase = createClient();

  const { data: categories } = await supabase
    .from("categories")
    .select("*")
    .eq("active", true)
    .order("display_order", { ascending: true });

  const { data: offers } = await supabase
    .from("affiliate_offers")
    .select(`
      *,
      category:categories(name)
    `)
    .eq("active", true)
    .order("display_order", { ascending: true });

  const typedOffers = (offers as Offer[] | null) ?? [];

  interface CategoryWithOffers {
    id: string;
    name: string;
    slug: string;
    offers: Offer[];
  }

  const offersByCategory: CategoryWithOffers[] =
    categories?.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      offers: typedOffers.filter((offer) => offer.category_id === category.id),
    })) ?? [];

  const uncategorized = typedOffers.filter((offer) => !offer.category_id);

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Referral Offers</h1>
        <p className="text-muted-foreground mt-1">
          Explore trusted offers. Every click supports the bitXbit ecosystem.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="#all">
          <Badge variant="outline" className="cursor-pointer hover:bg-muted">
            All
          </Badge>
        </Link>
        {categories?.map((category) => (
          <Link key={category.id} href={`#${category.slug}`}>
            <Badge variant="outline" className="cursor-pointer hover:bg-muted">
              {category.name}
            </Badge>
          </Link>
        ))}
      </div>

      {offersByCategory?.map((category) =>
        category.offers.length > 0 ? (
          <div key={category.id} id={category.slug} className="mb-10">
            <h2 className="text-xl font-semibold text-white mb-4">{category.name}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {category.offers.map((offer) => (
                <OfferCard key={offer.id} offer={offer} />
              ))}
            </div>
          </div>
        ) : null
      )}

      {uncategorized.length > 0 && (
        <div id="all" className="mb-10">
          <h2 className="text-xl font-semibold text-white mb-4">More Opportunities</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {uncategorized.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
            ))}
          </div>
        </div>
      )}

      {(typedOffers.length === 0) && (
        <Card>
          <CardHeader>
            <CardTitle>No offers yet</CardTitle>
            <CardDescription>
              Check back soon — new referral opportunities are being added.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Admin users can add offers from the admin panel.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
