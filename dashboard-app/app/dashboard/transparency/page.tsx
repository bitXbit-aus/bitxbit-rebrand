import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function TransparencyPage() {
  const supabase = createClient();

  const { data: model } = await supabase
    .from("allocation_models")
    .select("*")
    .eq("is_active", true)
    .order("effective_date", { ascending: false })
    .limit(1)
    .single();

  const { data: reports } = await supabase
    .from("transparency_reports")
    .select("*")
    .not("published_at", "is", null)
    .order("report_year", { ascending: false })
    .order("report_month", { ascending: false });

  const { data: income } = await supabase
    .from("affiliate_income")
    .select("amount, date_received")
    .order("date_received", { ascending: false })
    .limit(12);

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .order("display_order", { ascending: true });

  const totalIncome = income?.reduce((sum, item) => sum + (item.amount || 0), 0) ?? 0;

  const allocationItems = model
    ? [
        { label: "Community Rewards", value: model.community_rewards_pct, color: "bg-blue-500" },
        { label: "Liquidity", value: model.liquidity_pct, color: "bg-emerald-500" },
        { label: "Buybacks", value: model.buybacks_pct, color: "bg-purple-500" },
        { label: "Projects", value: model.projects_pct, color: "bg-amber-500" },
        { label: "Operations", value: model.operations_pct, color: "bg-slate-500" },
      ]
    : [];

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
            <CardDescription>{model ? model.name : "No active model configured."}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {allocationItems.map((item) => (
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
            <p className="text-xs text-muted-foreground mt-4">Effective from {model ? formatDate(model.effective_date) : "—"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Income</CardTitle>
            <CardDescription>Last {income?.length ?? 0} affiliate income entries.</CardDescription>
          </CardHeader>
          <CardContent>
            {income && income.length > 0 ? (
              <div className="space-y-3">
                <div className="flex justify-between text-sm font-medium">
                  <span>Total shown</span>
                  <span>{formatCurrency(totalIncome)}</span>
                </div>
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

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Funded Projects</CardTitle>
          <CardDescription>Regenerative initiatives supported by the community.</CardDescription>
        </CardHeader>
        <CardContent>
          {projects && projects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects.map((project) => (
                <div key={project.id} className="p-4 rounded-lg border border-border bg-card/50">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold">{project.name}</h3>
                    <span className="text-xs text-muted-foreground capitalize">{project.status}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{project.impact_statement}</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Allocated</span>
                    <span className="font-medium">{formatCurrency(project.amount_allocated)}</span>
                  </div>
                  {project.funding_goal && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Goal</span>
                      <span className="font-medium">{formatCurrency(project.funding_goal)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No projects funded yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transparency Reports</CardTitle>
          <CardDescription>Published monthly reports.</CardDescription>
        </CardHeader>
        <CardContent>
          {reports && reports.length > 0 ? (
            <div className="space-y-4">
              {reports.map((report) => (
                <div key={report.id} className="p-4 rounded-lg border border-border bg-card/50">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold">{report.report_month} {report.report_year}</h3>
                    <span className="text-xs text-muted-foreground">{formatDate(report.published_at)}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Total Income</span>
                    <span className="font-medium">{formatCurrency(report.total_income)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{report.summary_text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No reports published yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
