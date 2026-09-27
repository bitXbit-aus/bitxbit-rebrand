import { createServiceClient } from "@/lib/supabase/service";
import { publicJsonResponse, publicOptionsResponse } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("affiliate_offers")
    .select("id, name, description, benefit_text, referral_url, reward_eligible, active, display_order, logo_url, created_at, category:categories(name, slug)")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    return publicJsonResponse({ error: "Failed to load offers" }, 500);
  }

  return publicJsonResponse({ offers: data ?? [] });
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
