import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { StatsCardsSkeleton } from "@/components/dashboard/stats-cards-skeleton";
import { RewardsChartLoader } from "@/components/dashboard/rewards-chart-loader";
import { FeaturedOffers } from "@/components/dashboard/featured-offers";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { EcosystemAllocation } from "@/components/dashboard/ecosystem-allocation";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { CardSkeleton } from "@/components/dashboard/card-skeleton";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const displayName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "there";

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Welcome back, {displayName}</h1>
        <p className="text-muted-foreground mt-1">Here&apos;s what&apos;s happening in your bitXbit world.</p>
      </div>

      <Suspense fallback={<StatsCardsSkeleton />}>
        <StatsCards />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <div className="lg:col-span-2">
          <Suspense fallback={<CardSkeleton />}>
            <RewardsChartLoader />
          </Suspense>
        </div>
        <div>
          <EcosystemAllocation />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        <Suspense fallback={<CardSkeleton />}>
          <FeaturedOffers />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <RecentActivity />
        </Suspense>
      </div>

      <div className="mt-8">
        <QuickActions />
      </div>
    </div>
  );
}
