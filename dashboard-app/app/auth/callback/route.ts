import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { safeAuthNextPath } from "@/lib/auth-redirect";
import { resolveAuthRedirectBase } from "@/lib/auth-callback-url";
import { parseHostPolicy } from "@/lib/host-validation";
import { withAuthNoStore } from "@/lib/supabase/response-cache";
import { NextResponse } from "next/server";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Built once per runtime, same rules as middleware (lib/host-validation.ts — R-003). */
const HOST_POLICY = parseHostPolicy();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeAuthNextPath(searchParams.get("next"));
  const ref = searchParams.get("ref");

  // Redirect back to the host the user signed in on, not unconditionally to the
  // canonical app URL — `NEXT_PUBLIC_APP_URL` is the production URL in every
  // context, so a preview sign-in would otherwise end on production. Only an
  // allowed host for this deployment is kept; anything else falls back to the
  // canonical URL. Middleware has already rejected disallowed hosts.
  const appUrl = resolveAuthRedirectBase(request.url, HOST_POLICY, process.env.NEXT_PUBLIC_APP_URL);

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
      return withAuthNoStore(NextResponse.redirect(`${appUrl}${next}`));
    }
  }

  return withAuthNoStore(NextResponse.redirect(`${appUrl}/auth/login?error=callback`));
}
