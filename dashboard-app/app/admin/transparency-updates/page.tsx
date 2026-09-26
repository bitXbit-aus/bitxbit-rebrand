import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createTransparencyReport, publishTransparencyReport, unpublishTransparencyReport } from "@/lib/actions";
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
          <CardTitle>Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {reports?.map((report) => (
              <div key={report.id} className="p-4 rounded-lg border border-border bg-card/50">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="font-semibold">{report.report_month} {report.report_year}</h3>
                    <p className="text-xs text-muted-foreground">{formatDate(report.published_at)}</p>
                  </div>
                  <Badge variant={report.published_at ? "default" : "secondary"}>
                    {report.published_at ? "Published" : "Draft"}
                  </Badge>
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Total Income</span>
                  <span className="font-medium">{formatCurrency(report.total_income)}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-4">{report.summary_text}</p>
                <div className="flex gap-2">
                  {report.published_at ? (
                    <form action={unpublishTransparencyReport.bind(null, report.id)}>
                      <Button type="submit" size="sm" variant="outline">Unpublish</Button>
                    </form>
                  ) : (
                    <form action={publishTransparencyReport.bind(null, report.id)}>
                      <Button type="submit" size="sm">Publish</Button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
