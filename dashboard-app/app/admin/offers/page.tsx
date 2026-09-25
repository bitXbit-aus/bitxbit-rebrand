import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createOffer, deleteOffer } from "@/lib/actions";
import Link from "next/link";

export default async function AdminOffersPage() {
  const supabase = createClient();
  const { data: offers } = await supabase.from("affiliate_offers").select("*, category:categories(name)").order("display_order");
  const { data: categories } = await supabase.from("categories").select("id, name").order("display_order");

  return (
    <div className="dashboard-container">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Affiliate Offers</h1>
          <p className="text-muted-foreground mt-1">Manage referral and affiliate links.</p>
        </div>
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
            <div className="flex items-center gap-4">
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
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Status</th>
                <th>Rewards</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {offers?.map((offer) => (
                <tr key={offer.id}>
                  <td className="font-medium">{offer.name}</td>
                  <td>{offer.category?.name ?? "—"}</td>
                  <td>
                    <Badge variant={offer.active ? "default" : "secondary"}>{offer.active ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td>
                    <Badge variant={offer.reward_eligible ? "default" : "outline"}>{offer.reward_eligible ? "Eligible" : "N/A"}</Badge>
                  </td>
                  <td>
                    <form action={deleteOffer.bind(null, offer.id)}>
                      <Button variant="destructive" size="sm" type="submit">Delete</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
