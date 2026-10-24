import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parseHostPolicy, validateRequestHost } from "@/lib/host-validation";
import { resolveClientIp, withClientIp } from "@/lib/client-ip";
import { redirectWithCookies } from "@/lib/middleware-redirect";

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

/**
 * Host policy, built once per runtime from the environment.
 * See lib/host-validation.ts — R-003.
 */
const HOST_POLICY = parseHostPolicy();

export async function middleware(request: NextRequest) {
  // Validate Host / X-Forwarded-Host first. Everything downstream — redirect
  // targets, absolute URLs, cache keys — can be influenced by these headers, so
  // a disallowed value must not reach it. Only present headers are checked.
  const hostCheck = validateRequestHost(request.headers, HOST_POLICY);
  if (!hostCheck.ok && hostCheck.rejected) {
    console.error(
      `Rejected request: disallowed "${hostCheck.rejected.header}" header "${hostCheck.rejected.host}". ` +
        `Allowed: ${HOST_POLICY.exactHosts.join(", ")}` +
        (HOST_POLICY.netlifySite ? `, <deploy>--${HOST_POLICY.netlifySite}.netlify.app` : "")
    );
    return applySecurityHeaders(
      new NextResponse("Bad Request: unrecognised host.", {
        status: 400,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      })
    );
  }

  // Forward whatever client address the edge can resolve. NOTE: this does NOT
  // deliver it to route handlers. Measured 2026-10-21: the header is absent at
  // the origin, as is a client-forged copy of it — custom request headers set
  // here do not survive to a serverless function. Rate limiting therefore
  // resolves the client at the origin from the raw forwarding chain; see
  // lib/client-ip.ts and lib/rate-limit.ts — R-004. The header is harmless and
  // may still reach downstream code that can see it, but do NOT key the limiter
  // on it.
  const clientIp = resolveClientIp(request.headers);
  // Built fresh at each use so cookies refreshed below are still forwarded.
  const forwardHeaders = () => withClientIp(new Headers(request.headers), clientIp);

  let response = NextResponse.next({
    request: {
      headers: forwardHeaders(),
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // @supabase/ssr 0.12.x interface — 0.1.0's get/set/remove is gone. The
      // behaviour mirrors the old set/remove exactly: mutate the request cookies,
      // rebuild the response that carries the forwarded client-IP header, then
      // write the cookies onto it. Do not simplify this — a wrong adapter here
      // causes silent session loss rather than an error (plan §3.3).
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set({ name, value, ...options });
          });
          response = NextResponse.next({
            request: { headers: forwardHeaders() },
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set({ name, value, ...options });
          });
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
    return applySecurityHeaders(redirectWithCookies(new URL("/auth/login", request.url), response));
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
    return applySecurityHeaders(redirectWithCookies(loginUrl, response));
  }

  if (user && isAdminRoute && authorization?.role !== "admin") {
    return applySecurityHeaders(redirectWithCookies(new URL("/dashboard", request.url), response));
  }

  if (user && isAuthEntryRoute && isActive) {
    return applySecurityHeaders(redirectWithCookies(new URL("/dashboard", request.url), response));
  }

  return applySecurityHeaders(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
