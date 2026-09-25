import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export default async function ActivityPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: activities } = await supabase
    .from("user_activities")
    .select(`
      *,
      offer:affiliate_offers(name)
    `)
    .eq("user_id", user?.id)
    .order("created_at", { ascending: false });

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Activity</h1>
        <p className="text-muted-foreground mt-1">Your referral link clicks and engagements.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Track your participation across offers.</CardDescription>
        </CardHeader>
        <CardContent>
          {activities && activities.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Offer</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((activity) => (
                  <tr key={activity.id}>
                    <td className="capitalize">{activity.activity_type}</td>
                    <td>{activity.offer?.name ?? "Direct"}</td>
                    <td>{formatDate(activity.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
