/**
 * R-007 — a response that may carry an auth cookie must not be cached.
 *
 * `cookies()` (used by `lib/supabase/server.ts`) writes cookies only and gives no
 * access to the response headers, so a Route Handler that refreshes a session
 * cannot apply `@supabase/ssr`'s own cache directives from there. Middleware
 * cannot see a `Set-Cookie` added downstream either. Each auth-bearing route
 * handler must therefore mark its own response, and
 * `response-cache.test.ts` enforces that none is forgotten.
 *
 * Typed structurally rather than against `NextResponse` so it is testable
 * without a Next.js runtime; a real `NextResponse` satisfies it.
 */

export interface HeaderBearing {
  headers: { set(name: string, value: string): unknown };
}

export function withAuthNoStore<T extends HeaderBearing>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
