import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createOffer, updateOffer, deleteOffer } from "@/lib/actions";

export default async function AdminOffersPage() {
  const supabase = createClient();
  const { data: offers } = await supabase.from("affiliate_offers").select("*, category:categories(name)").order("display_order");
  const { data: categories } = await supabase.from("categories").select("id, name").order("display_order");

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Affiliate Offers</h1>
        <p className="text-muted-foreground mt-1">Manage referral and affiliate links.</p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Add New Offer</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createOffer} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input name="name" placeholder="Offer name" className="input" required />
            <select name="categoryId" className="input">
              <option value="">No category</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input name="referralUrl" placeholder="Referral URL" className="input" required />
            <input name="description" placeholder="Description" className="input" />
            <input name="benefitText" placeholder="Benefit text" className="input" />
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="rewardEligible" defaultChecked />
                Reward eligible
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked />
                Active
              </label>
            </div>
            <div className="md:col-span-2">
              <Button type="submit">Create Offer</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Offers</CardTitle>
          <CardDescription>{offers?.length ?? 0} offers in the system.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {offers?.map((offer) => (
              <div key={offer.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 rounded-lg border border-border bg-card/50 items-end">
                <form action={updateOffer.bind(null, offer.id)} className="contents">
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
                    <input name="name" defaultValue={offer.name} className="input w-full" required />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
                    <select name="categoryId" defaultValue={offer.category_id ?? ""} className="input w-full">
                      <option value="">None</option>
                      {categories?.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Referral URL</label>
                    <input name="referralUrl" defaultValue={offer.referral_url} className="input w-full" required />
                  </div>
                  <div className="md:col-span-3 flex items-center gap-4 pb-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="rewardEligible" defaultChecked={offer.reward_eligible} />
                      Reward
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={offer.active} />
                      Active
                    </label>
                  </div>
                  <div className="md:col-span-6">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                    <input name="description" defaultValue={offer.description ?? ""} className="input w-full" />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Benefit text</label>
                    <input name="benefitText" defaultValue={offer.benefit_text ?? ""} className="input w-full" />
                  </div>
                  <div className="md:col-span-2 flex justify-end">
                    <Button type="submit" size="sm">Save</Button>
                  </div>
                </form>
                <div className="md:col-span-12 flex justify-end border-t border-border pt-3">
                  <form action={deleteOffer.bind(null, offer.id)}>
                    <Button variant="destructive" size="sm" type="submit">Delete Offer</Button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
