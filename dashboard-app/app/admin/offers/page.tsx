import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormWithToast } from "@/components/dashboard/form-with-toast";
import { createOffer, updateOffer, deleteOffer } from "@/lib/actions";

export default async function AdminOffersPage() {
  const supabase = createClient();
  const { data: offers } = await supabase
    .from("affiliate_offers")
    .select("*, category:categories(name)")
    .order("display_order")
    .order("created_at", { ascending: false });
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
          <FormWithToast
            action={createOffer}
            successMessage="Offer created"
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <input name="name" placeholder="Offer name" className="input" required />
            <select name="categoryId" className="input">
              <option value="">No category</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input name="referralUrl" placeholder="Referral URL" className="input" required />
            <input name="logoUrl" placeholder="Logo URL (optional)" className="input" />
            <input name="benefitText" placeholder="Benefit text" className="input" />
            <input name="displayOrder" type="number" placeholder="Display order" className="input" defaultValue="0" />
            <input name="description" placeholder="Description" className="input md:col-span-2" />
            <div className="flex items-center gap-6 md:col-span-2">
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
          </FormWithToast>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Offers</CardTitle>
          <CardDescription>{offers?.length ?? 0} offers in the system.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {offers?.map((offer) => (
              <Card key={offer.id} className="border-border bg-card/50">
                <CardHeader>
                  <div className="flex items-center justify-between gap-4">
                    <CardTitle className="text-lg">{offer.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      {offer.reward_eligible && <Badge variant="outline">Reward</Badge>}
                      <Badge variant={offer.active ? "default" : "secondary"}>{offer.active ? "Active" : "Inactive"}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <FormWithToast
                    action={updateOffer.bind(null, offer.id)}
                    successMessage="Offer updated"
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Name</label>
                        <input name="name" defaultValue={offer.name} className="input w-full" required />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Category</label>
                        <select name="categoryId" defaultValue={offer.category_id ?? ""} className="input w-full">
                          <option value="">None</option>
                          {categories?.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs text-muted-foreground">Referral URL</label>
                        <input name="referralUrl" defaultValue={offer.referral_url} className="input w-full" required />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs text-muted-foreground">Logo URL</label>
                        <input name="logoUrl" defaultValue={offer.logo_url ?? ""} className="input w-full" />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs text-muted-foreground">Description</label>
                        <input name="description" defaultValue={offer.description ?? ""} className="input w-full" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Benefit text</label>
                        <input name="benefitText" defaultValue={offer.benefit_text ?? ""} className="input w-full" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Display order</label>
                        <input name="displayOrder" type="number" defaultValue={offer.display_order} className="input w-full" />
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="rewardEligible" defaultChecked={offer.reward_eligible} />
                        Reward eligible
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="active" defaultChecked={offer.active} />
                        Active
                      </label>
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-border">
                      <Button type="submit" size="sm">Save Changes</Button>
                      <FormWithToast
                        action={deleteOffer.bind(null, offer.id)}
                        successMessage="Offer deleted"
                        errorMessage="Could not delete offer"
                      >
                        <Button variant="destructive" size="sm" type="submit">Delete</Button>
                      </FormWithToast>
                    </div>
                  </FormWithToast>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
