import { createServiceClient } from "@/lib/supabase/service";
import { publicJsonResponse, publicOptionsResponse } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("user_activities")
    .select("id, activity_type, source_url, created_at, affiliate_offers(name)")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return publicJsonResponse({ error: "Failed to load activity" }, 500);
  }

  const activities = (data ?? []).map((item: any) => ({
    id: item.id,
    type: item.activity_type,
    offer: item.affiliate_offers?.name ?? null,
    createdAt: item.created_at,
  }));

  return publicJsonResponse({ activities });
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
