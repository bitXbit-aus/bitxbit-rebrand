import { isAllowedHost, normalizeHost, type HostPolicy } from "./host-validation";

/**
 * Choose the base URL for the post-authentication redirect.
 *
 * The magic-link callback must land the user back on the host they actually
 * signed in on. Using only `NEXT_PUBLIC_APP_URL` breaks deploy previews: that
 * variable is the canonical *production* URL in every context, so a preview
 * sign-in ends up on production (the carried residual from R-007).
 *
 * Rule: keep the request's own origin when it is an **allowed host for this
 * deployment**, otherwise fall back to the canonical app URL. Deploy-preview and
 * branch-deploy hosts are allowed by pinning the Netlify site slug in
 * `HostPolicy.netlifySite`; production is an exact host. Middleware already
 * rejects any disallowed host before this route runs, so this is defence in
 * depth rather than the only gate — but it is the gate that keeps a spoofed or
 * unexpected origin from becoming a redirect target here.
 *
 * Returns "" only when the request URL is malformed AND no canonical URL is
 * configured — callers pass the result into `new URL`/string concatenation and
 * must not receive a bare relative value by accident.
 */
export function resolveAuthRedirectBase(
  requestUrl: string,
  policy: HostPolicy,
  canonicalAppUrl: string | undefined
): string {
  let origin: string | null = null;
  let host: string | null = null;

  try {
    const parsed = new URL(requestUrl);
    origin = parsed.origin;
    host = normalizeHost(parsed.host);
  } catch {
    origin = null;
    host = null;
  }

  if (origin && isAllowedHost(host, policy)) return origin;
  if (canonicalAppUrl) return canonicalAppUrl;
  return origin ?? "";
}

/** Last resort when neither the request nor the environment yields a usable host. */
export const FALLBACK_SIGNIN_DOMAIN = "app.bitxbit.com.au";

/**
 * The domain shown in the "Sign in with your Solana account" message the user
 * signs (SIWS) — the same decision as the redirect base, reduced to a hostname.
 *
 * `NEXT_PUBLIC_APP_URL` is the canonical PRODUCTION url in every context, so
 * binding every signed message to it would make a deploy preview display — and
 * have the user sign — production's domain. Reusing `resolveAuthRedirectBase`
 * keeps one host allowlist rather than a second one that could drift from it.
 */
export function resolveSignInDomain(
  requestUrl: string,
  policy: HostPolicy,
  canonicalAppUrl: string | undefined
): string {
  const base = resolveAuthRedirectBase(requestUrl, policy, canonicalAppUrl);
  try {
    const host = new URL(base).host;
    return host || FALLBACK_SIGNIN_DOMAIN;
  } catch {
    return FALLBACK_SIGNIN_DOMAIN;
  }
}
