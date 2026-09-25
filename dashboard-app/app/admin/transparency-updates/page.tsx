import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createTransparencyReport } from "@/lib/actions";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function AdminTransparencyPage() {
  const supabase = createClient();
  const { data: reports } = await supabase
    .from("transparency_reports")
    .select("*")
    .order("report_year", { ascending: false })
    .order("report_month", { ascending: false });

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Transparency Updates</h1>
        <p className="text-muted-foreground mt-1">Publish monthly transparency reports.</p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Publish Report</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createTransparencyReport} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input name="reportMonth" placeholder="Month (e.g. January)" className="input" required />
            <input name="reportYear" type="number" placeholder="Year" className="input" required />
            <input name="totalIncome" type="number" step="0.01" placeholder="Total Income (AUD)" className="input" />
            <textarea name="summaryText" placeholder="Summary text" className="input md:col-span-3 h-24" />
            <div className="md:col-span-3">
              <Button type="submit">Publish Report</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Published Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="data-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Total Income</th>
                <th>Published</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {reports?.map((report) => (
                <tr key={report.id}>
                  <td className="font-medium">{report.report_month} {report.report_year}</td>
                  <td>{formatCurrency(report.total_income)}</td>
                  <td>{formatDate(report.published_at)}</td>
                  <td className="max-w-sm truncate">{report.summary_text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
