import { createServiceClient } from "@/lib/supabase/service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminActivityTable } from "@/components/admin/activity-table";
import { ActivityType } from "@/types";

interface AdminActivityItem {
  id: string;
  activity_type: ActivityType;
  source_url: string | null;
  created_at: string;
  user: { id: string; email: string | null; display_name: string | null } | null;
  offer: { name: string | null; referral_url: string | null } | null;
}

export default async function AdminActivityPage() {
  const supabase = createServiceClient();

  const { data: activities, error } = await supabase
    .from("user_activities")
    .select(
      `
      id,
      activity_type,
      source_url,
      created_at,
      user:users(id, email, display_name),
      offer:affiliate_offers(name, referral_url)
    `
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load activity:", error);
  }

  // Supabase returns the relation data as an array in JSON mode; normalize it.
  const normalized: AdminActivityItem[] = (activities ?? []).map((a: any) => ({
    id: a.id,
    activity_type: a.activity_type,
    source_url: a.source_url,
    created_at: a.created_at,
    user: Array.isArray(a.user) ? a.user[0] ?? null : a.user,
    offer: Array.isArray(a.offer) ? a.offer[0] ?? null : a.offer,
  }));

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Activity</h1>
        <p className="text-muted-foreground mt-1">
          All member activity across the platform.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Platform Activity</CardTitle>
          <CardDescription>
            Track every referral link click, signup, and purchase across all users.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminActivityTable activities={normalized} />
        </CardContent>
      </Card>
    </div>
  );
}
