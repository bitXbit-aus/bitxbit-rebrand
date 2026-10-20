import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

interface MiddlewareAuthorization {
  role: "member" | "admin";
  status: "active" | "suspended" | "deactivated";
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  // Restrict framing to prevent clickjacking.
  response.headers.set("X-Frame-Options", "DENY");
  // Enforce HTTPS and set baseline XSS/filter protections.
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://plausible.io; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' https://*.supabase.co https://api.mainnet-beta.solana.com https://api.devnet.solana.com https://public-api.birdeye.so https://api.dexscreener.com https://plausible.io; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self';"
  );
  return response;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAdminRoute = pathname.startsWith("/admin");
  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isAuthEntryRoute =
    pathname.startsWith("/auth/login") || pathname.startsWith("/auth/signup");

  if (!user && (isAdminRoute || isDashboardRoute)) {
    return applySecurityHeaders(NextResponse.redirect(new URL("/auth/login", request.url)));
  }

  let authorization: MiddlewareAuthorization | null = null;
  if (user && (isAdminRoute || isDashboardRoute || isAuthEntryRoute)) {
    const { data, error } = await supabase
      .rpc("get_my_authorization")
      .maybeSingle();

    if (!error && data) {
      authorization = data as MiddlewareAuthorization;
    }
  }

  const isActive = authorization?.status === "active";

  if (user && (isAdminRoute || isDashboardRoute) && !isActive) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("error", "account_inactive");
    return applySecurityHeaders(NextResponse.redirect(loginUrl));
  }

  if (user && isAdminRoute && authorization?.role !== "admin") {
    return applySecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)));
  }

  if (user && isAuthEntryRoute && isActive) {
    return applySecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)));
  }

  return applySecurityHeaders(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
