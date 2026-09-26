import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function ActivityPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: activities } = await supabase
    .from("user_activities")
    .select(`
      *,
      offer:affiliate_offers(name, referral_url)
    `)
    .eq("user_id", user?.id)
    .order("created_at", { ascending: false });

  const clicks = activities?.filter((a) => a.activity_type === "click").length ?? 0;
  const signups = activities?.filter((a) => a.activity_type === "signup").length ?? 0;
  const purchases = activities?.filter((a) => a.activity_type === "purchase").length ?? 0;

  const stats = [
    { label: "Clicks", value: clicks },
    { label: "Signups", value: signups },
    { label: "Purchases", value: purchases },
  ];

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Activity</h1>
        <p className="text-muted-foreground mt-1">Your referral link clicks and engagements.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
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
                    <td>
                      <Badge variant="outline" className="capitalize">
                        {activity.activity_type}
                      </Badge>
                    </td>
                    <td>
                      {activity.offer?.name ? (
                        <a
                          href={activity.offer.referral_url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {activity.offer.name}
                        </a>
                      ) : (
                        "Direct"
                      )}
                    </td>
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
