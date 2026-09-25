import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function AdminAllocationsPage() {
  const supabase = createClient();
  const { data: models } = await supabase.from("allocation_models").select("*").order("effective_date", { ascending: false });

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Allocations</h1>
        <p className="text-muted-foreground mt-1">View and manage allocation models.</p>
      </div>

      <div className="grid gap-6">
        {models?.map((model) => (
          <Card key={model.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{model.name}</CardTitle>
                {model.is_active && <Badge>Active</Badge>}
              </div>
              <CardDescription>Effective from {model.effective_date}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { label: "Community Rewards", value: model.community_rewards_pct, color: "bg-blue-500" },
                  { label: "Liquidity", value: model.liquidity_pct, color: "bg-emerald-500" },
                  { label: "Buybacks", value: model.buybacks_pct, color: "bg-purple-500" },
                  { label: "Projects", value: model.projects_pct, color: "bg-amber-500" },
                  { label: "Operations", value: model.operations_pct, color: "bg-slate-500" },
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
