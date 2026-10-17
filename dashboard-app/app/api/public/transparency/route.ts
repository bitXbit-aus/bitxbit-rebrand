import { createServiceClient } from "@/lib/supabase/service";
import { checkPublicRateLimit, publicJsonResponse, publicOptionsResponse } from "../_shared";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rateLimited = await checkPublicRateLimit(request);
  if (rateLimited) return rateLimited;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("transparency_reports")
    .select("id, report_month, report_year, total_income, allocation_snapshot, summary_text, proof_urls, published_at, created_at")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(12);

  if (error) {
    return publicJsonResponse({ error: "Failed to load transparency reports" }, 500);
  }

  return publicJsonResponse({ reports: data ?? [] });
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
