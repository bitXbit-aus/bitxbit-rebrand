import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createIncome, updateIncome, deleteIncome } from "@/lib/actions";

export default async function AdminIncomePage() {
  const supabase = createClient();
  const { data: income } = await supabase
    .from("affiliate_income")
    .select("*")
    .order("date_received", { ascending: false });
  const { data: offers } = await supabase.from("affiliate_offers").select("id, name").eq("active", true);

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Income</h1>
        <p className="text-muted-foreground mt-1">Track affiliate income manually.</p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Record Income</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createIncome} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input name="source" placeholder="Source (e.g. Exchange)" className="input" required />
            <select name="offerId" className="input">
              <option value="">No linked offer</option>
              {offers?.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <input name="amount" type="number" step="0.01" placeholder="Amount" className="input" required />
            <input name="currency" defaultValue="AUD" placeholder="Currency" className="input" />
            <input name="dateReceived" type="date" className="input" required />
            <input name="notes" placeholder="Notes" className="input" />
            <div className="md:col-span-3">
              <Button type="submit">Record Income</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Income History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {income?.map((item) => (
              <div key={item.id} className="p-4 rounded-lg border border-border bg-card/50">
                <form action={updateIncome.bind(null, item.id)}>
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Source</label>
                      <input name="source" defaultValue={item.source} className="input w-full" required />
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Linked Offer</label>
                      <select name="offerId" defaultValue={item.offer_id ?? ""} className="input w-full">
                        <option value="">None</option>
                        {offers?.map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Amount</label>
                      <input name="amount" type="number" step="0.01" defaultValue={item.amount} className="input w-full" required />
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Currency</label>
                      <input name="currency" defaultValue={item.currency} className="input w-full" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Date</label>
                      <input name="dateReceived" type="date" defaultValue={item.date_received} className="input w-full" required />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
                      <input name="notes" defaultValue={item.notes ?? ""} className="input w-full" />
                    </div>
                    <div className="md:col-span-12 flex justify-end gap-2 border-t border-border pt-3">
                      <Button type="submit" size="sm">Save Changes</Button>
                    </div>
                  </div>
                </form>
                <div className="flex justify-end mt-2">
                  <form action={deleteIncome.bind(null, item.id)}>
                    <Button variant="destructive" size="sm" type="submit">Delete Income</Button>
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
