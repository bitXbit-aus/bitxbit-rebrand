import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Download } from "lucide-react";

export default async function AdminReportsPage() {
  const supabase = createClient();
  const { data: income } = await supabase.from("affiliate_income").select("*").order("date_received", { ascending: false });

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

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Reports</h1>
        <p className="text-muted-foreground mt-1">Export and review ecosystem data.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Income Export</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">Download all affiliate income records as CSV.</p>
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`}
              download="bitxbit-income.csv"
            >
              <Button>
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Records</span>
              <span className="font-medium">{income?.length ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Amount</span>
              <span className="font-medium">
                {formatCurrency(income?.reduce((sum, i) => sum + (i.amount || 0), 0) ?? 0)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Date Range</span>
              <span className="font-medium">
                {income && income.length > 0
                  ? `${formatDate(income[income.length - 1].date_received)} – ${formatDate(income[0].date_received)}`
                  : "—"}
              </span>
            </div>
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
