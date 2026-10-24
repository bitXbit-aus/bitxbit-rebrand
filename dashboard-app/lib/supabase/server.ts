import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client, backed by the request's cookies.
 *
 * Two Next.js 15 / `@supabase/ssr` changes meet here:
 *
 * - `cookies()` is **async** in Next 15, so this function is `async` and every
 *   caller must `await` it. (`lib/authz.ts`, `lib/actions.ts`, the server
 *   components and the route handlers are all callers.)
 * - `@supabase/ssr` 0.12.x uses the **`getAll` / `setAll`** cookie interface; the
 *   `get` / `set` / `remove` shape used by 0.1.0 is gone.
 *
 * `setAll` is wrapped in try/catch because it is also reached from Server
 * Components, where cookies are read-only (a write throws). Swallowing that is
 * the documented pattern and is safe here: middleware refreshes the session.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet, headersToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch (error) {
            // Server Components can READ cookies but not write them, so a write during a render
            // throws. That case is expected and safe to ignore — middleware keeps the session
            // refreshed. Anything else is a real failure (a Route Handler or Server Action where
            // the write is the whole point: swallowing it yields a "successful" sign-in with no
            // session, or a refresh the browser never receives), so surface it rather than
            // discarding it silently. We still do not rethrow: a render must not break.
            const message = error instanceof Error ? error.message : String(error);
            if (!/read-only|can only be modified|outside a request scope|Server Component/i.test(message)) {
              console.warn("[supabase/server] cookie write failed:", message);
            }
          }
          // `headersToSet` (the library's cache directives) cannot be applied here: `cookies()`
          // writes cookies only, with no access to the response headers. Responses that carry
          // auth cookies are marked `Cache-Control: private, no-store` in middleware and in the
          // PKCE callback route instead.
          void headersToSet;
        },
      },
    }
  );
}
