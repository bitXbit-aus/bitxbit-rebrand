import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json(
      { error: "Missing referral code" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const normalizedCode = code.trim().toLowerCase();

  // Referral codes are stored in lowercase. Only fall back to id lookup for UUID-shaped refs
  // so we don't compare a UUID column to non-UUID text (which causes PostgREST to error).
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedCode);

  let query = supabase.from("users").select("id, display_name, referral_code");

  if (isUuid) {
    query = query.or(`referral_code.eq.${normalizedCode},id.eq.${normalizedCode}`);
  } else {
    query = query.eq("referral_code", normalizedCode);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Referrer not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}
