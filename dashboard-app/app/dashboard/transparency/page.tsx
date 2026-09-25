import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function TransparencyPage() {
  const supabase = createClient();

  const { data: reports } = await supabase
    .from("transparency_reports")
    .select("*")
    .order("report_year", { ascending: false })
    .order("report_month", { ascending: false });

  const { data: income } = await supabase
    .from("affiliate_income")
    .select("amount, date_received")
    .order("date_received", { ascending: false })
    .limit(12);

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Transparency</h1>
        <p className="text-muted-foreground mt-1">Public ledger of affiliate income and allocations.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Allocation Model</CardTitle>
            <CardDescription>How income is distributed across the ecosystem.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { label: "Community Rewards", value: 40, color: "bg-blue-500" },
                { label: "Liquidity", value: 25, color: "bg-emerald-500" },
                { label: "Buybacks", value: 15, color: "bg-purple-500" },
                { label: "Projects", value: 10, color: "bg-amber-500" },
                { label: "Operations", value: 10, color: "bg-slate-500" },
              ].map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{item.label}</span>
                    <span className="text-muted-foreground">{item.value}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full`} style={{ width: `${item.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4">These are placeholder figures until confirmed by the team.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Income</CardTitle>
            <CardDescription>Last 12 affiliate income entries.</CardDescription>
          </CardHeader>
          <CardContent>
            {income && income.length > 0 ? (
              <div className="space-y-3">
                {income.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{formatDate(item.date_received)}</span>
                    <span className="font-medium">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No income recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transparency Reports</CardTitle>
          <CardDescription>Monthly public reports.</CardDescription>
        </CardHeader>
        <CardContent>
          {reports && reports.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Total Income</th>
                  <th>Status</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td>{report.report_month} {report.report_year}</td>
                    <td>{formatCurrency(report.total_income)}</td>
                    <td>{report.published_at ? "Published" : "Draft"}</td>
                    <td>{formatDate(report.published_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No reports published yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
