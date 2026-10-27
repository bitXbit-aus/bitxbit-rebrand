const DEFAULT_AUTH_DESTINATION = "/dashboard";
const AUTH_REDIRECT_BASE = "https://app.invalid";

/**
 * Accept only an absolute path on this application. Values such as `@evil.com`,
 * `//evil.com` and `/\\evil.com` can otherwise turn string concatenation into an
 * external redirect when appended to the canonical application URL.
 */
export function safeAuthNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_AUTH_DESTINATION;
  }

  try {
    const parsed = new URL(value, AUTH_REDIRECT_BASE);
    if (parsed.origin !== AUTH_REDIRECT_BASE) return DEFAULT_AUTH_DESTINATION;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_DESTINATION;
  }
}