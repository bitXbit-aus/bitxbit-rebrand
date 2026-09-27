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

  const { data, error } = await supabase
    .from("users")
    .select("id, display_name, referral_code")
    .or(`referral_code.eq.${code},id.eq.${code}`)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Referrer not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}
