import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ActivityTimeline } from "@/components/dashboard/activity-timeline";
import { ActivitySkeleton } from "@/components/dashboard/activity-skeleton";
import { ActivityType } from "@/types";

interface ActivityItem {
  id: string;
  activity_type: ActivityType;
  source_url: string | null;
  created_at: string;
  offer: { name: string | null; referral_url: string | null }[] | null;
}

export default function ActivityPage() {
  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Activity</h1>
        <p className="text-muted-foreground mt-1">
          Your referral link clicks, signups, and purchases.
        </p>
      </div>

      <Suspense fallback={<ActivitySkeleton />}>
        <ActivityData />
      </Suspense>
    </div>
  );
}

async function ActivityData() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: activities } = await supabase
    .from("user_activities")
    .select(
      `
      id,
      activity_type,
      source_url,
      created_at,
      offer:affiliate_offers(name, referral_url)
    `
    )
    .eq("user_id", user?.id)
    .order("created_at", { ascending: false });

  return <ActivityTimeline activities={(activities ?? []) as ActivityItem[]} />;
}
