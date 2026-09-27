import { createServiceClient } from "@/lib/supabase/service";
import { publicJsonResponse, publicOptionsResponse } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, description, funding_goal, amount_allocated, status, impact_statement, image_url, display_order, created_at")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    return publicJsonResponse({ error: "Failed to load projects" }, 500);
  }

  return publicJsonResponse({ projects: data ?? [] });
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
