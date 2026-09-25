import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { createProject } from "@/lib/actions";
import { formatCurrency } from "@/lib/utils";

export default async function AdminProjectsPage() {
  const supabase = createClient();
  const { data: projects } = await supabase.from("projects").select("*").order("display_order");

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Projects</h1>
        <p className="text-muted-foreground mt-1">Manage funded projects and initiatives.</p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Add Project</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createProject} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input name="name" placeholder="Project name" className="input" required />
            <select name="status" className="input">
              <option value="planning">Planning</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="paused">Paused</option>
            </select>
            <input name="fundingGoal" type="number" step="0.01" placeholder="Funding goal (AUD)" className="input" />
            <input name="impactStatement" placeholder="Impact statement" className="input" />
            <textarea name="description" placeholder="Description" className="input md:col-span-2 h-24" />
            <div className="md:col-span-2">
              <Button type="submit">Create Project</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {projects?.map((project) => (
          <Card key={project.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{project.name}</CardTitle>
                <Badge variant={project.status === "active" ? "default" : "secondary"}>{project.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{project.description}</p>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">
                    {formatCurrency(project.amount_allocated)}
                    {project.funding_goal ? ` / ${formatCurrency(project.funding_goal)}` : ""}
                  </span>
                </div>
                <Progress
                  value={
                    project.funding_goal && project.funding_goal > 0
                      ? Math.min((project.amount_allocated / project.funding_goal) * 100, 100)
                      : 0
                  }
                />
              </div>
              <p className="text-sm text-muted-foreground">{project.impact_statement}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
