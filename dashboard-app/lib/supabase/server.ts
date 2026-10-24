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
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Safe to ignore — middleware is what keeps the session refreshed.
          }
        },
      },
    }
  );
}
