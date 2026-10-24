import { NextResponse } from "next/server";

/**
 * Build a redirect that still carries cookies refreshed during this request.
 *
 * Why this exists
 * ---------------
 * The Supabase SSR cookie adapter writes a refreshed session onto the `response`
 * object that middleware is building. `NextResponse.redirect(...)` constructs a
 * *new* response, so those `Set-Cookie` headers are silently dropped on every
 * redirect path. The browser is then never handed the refreshed session: it keeps
 * an expired access token and re-refreshes on every request, and loses the session
 * outright once the refresh token it still holds is no longer accepted.
 *
 * The failure is invisible — no error, no log, just a user who is occasionally
 * signed out — which is why every redirect branch must go through this helper
 * rather than calling `NextResponse.redirect` directly.
 *
 * Finding from the R-007 independent review, 2026-10-24. It was pre-existing on
 * `main` (the same shape as the canonical Supabase middleware example) and was
 * *not* introduced by the Next.js 15 migration.
 */
export function redirectWithCookies(target: URL | string, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(target);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}
