import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createIncome } from "@/lib/actions";
import { formatCurrency, formatDate } from "@/lib/utils";

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
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {income?.map((item) => (
                <tr key={item.id}>
                  <td className="font-medium">{item.source}</td>
                  <td>{formatCurrency(item.amount)}</td>
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
