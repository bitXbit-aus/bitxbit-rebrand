import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

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
      if (ref && isUuid(ref)) {
        const serviceClient = createServiceClient();
        await serviceClient
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
