import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const ref = searchParams.get("ref");

  // Always redirect to the canonical app URL, not the origin of the magic link.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin;

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // If a referrer was passed via OAuth redirect, attach it to the new user.
      if (ref) {
        await supabase
          .from("users")
          .update({ referred_by: ref })
          .eq("id", data.user.id)
          .is("referred_by", null);
      }
      return NextResponse.redirect(`${appUrl}${next}`);
    }
  }

  return NextResponse.redirect(`${appUrl}/auth/login?error=callback`);
}
