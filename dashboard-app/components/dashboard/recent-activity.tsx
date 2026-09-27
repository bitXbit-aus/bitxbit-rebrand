import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

const activityLabels: Record<string, string> = {
  click: "Clicked referral link",
  signup: "Signed up via referral",
  purchase: "Completed purchase",
  other: "Activity recorded",
};

export async function RecentActivity() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: recentActivities } = await supabase
    .from("user_activities")
    .select(`id, activity_type, created_at, offer:affiliate_offers(name)`)
    .eq("user_id", user?.id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!recentActivities || recentActivities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Your latest referral link clicks.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No activity yet. Visit an offer to start tracking.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Your latest referral link clicks.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {recentActivities.map((activity: any) => (
            <div
              key={activity.id}
              className="flex items-center justify-between py-2 border-b border-border last:border-0"
            >
              <div>
                <p className="text-sm font-medium">{activityLabels[activity.activity_type] ?? activity.activity_type}</p>
                <p className="text-xs text-muted-foreground">{activity.offer?.name ?? "Direct"}</p>
              </div>
              <span className="text-xs text-muted-foreground">{formatDate(activity.created_at)}</span>
            </div>
          ))}
          <Link
            href="/dashboard/activity"
            className="inline-flex items-center text-sm text-primary hover:underline pt-2"
          >
            View all activity →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
