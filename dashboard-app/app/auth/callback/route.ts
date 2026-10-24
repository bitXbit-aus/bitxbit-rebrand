import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { safeAuthNextPath } from "@/lib/auth-redirect";
import { NextResponse } from "next/server";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeAuthNextPath(searchParams.get("next"));
  const ref = searchParams.get("ref");

  // Always redirect to the canonical app URL, not the origin of the magic link.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin;

  if (code) {
    const supabase = await createClient();
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
      // This redirect sets session cookies, so it must never be cached — a CDN or reverse
      // proxy serving it to another user would leak a session. See @supabase/ssr's setAll
      // cache guidance.
      const authed = NextResponse.redirect(`${appUrl}${next}`);
      authed.headers.set("Cache-Control", "private, no-store");
      return authed;
    }
  }

  const failed = NextResponse.redirect(`${appUrl}/auth/login?error=callback`);
  failed.headers.set("Cache-Control", "private, no-store");
  return failed;
}
