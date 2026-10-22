/**
 * Host / origin validation (R-003).
 *
 * Threat: absolute URLs derived from an attacker-controlled Host header —
 * redirect targets, password-reset links, and cache keys. On Netlify the edge
 * routes by Host, so a spoofed value normally never reaches the application.
 * That is a property of the platform, not a control in the application: it does
 * nothing if the edge is misconfigured or the app is moved. This module adds the
 * application-layer defence.
 *
 * Design notes:
 *
 * - Only *present* host headers are validated. An absent header is not a
 *   spoofing attempt, so absence passes; a present value that is not
 *   allowlisted is rejected. This is fail-closed without inventing failures.
 * - Both `host` and `x-forwarded-host` are checked when present. Their
 *   divergence is exactly the smuggling vector, and Next itself prefers
 *   `x-forwarded-host` when generating URLs, so validating only one side would
 *   leave the other unguarded.
 * - Deploy-preview hosts are matched by pinning the Netlify site slug, not by
 *   admitting `*.netlify.app`. A broad wildcard would let any Netlify-hosted
 *   page pass as a legitimate host.
 */

/** Headers that can carry a client-supplied hostname, most-trusted last. */
export const HOST_SOURCE_HEADERS = ["host", "x-forwarded-host"] as const;

export interface HostPolicy {
  /** Exact hostnames, lowercase, without port. */
  exactHosts: string[];
  /** Netlify site slug; enables that site's preview and branch-deploy hosts. */
  netlifySite?: string;
  /** Permits localhost origins. Intended for development only. */
  allowLocalhost: boolean;
}

export interface HostCheck {
  header: string;
  host: string;
}

export interface HostValidationResult {
  ok: boolean;
  /** Every host header that was inspected, in check order. */
  checked: HostCheck[];
  /** The first header that failed, when `ok` is false. */
  rejected?: HostCheck;
}

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const NETLIFY_SUFFIX = ".netlify.app";
/** A Netlify deploy or branch label: lowercase alphanumerics and hyphens. */
const NETLIFY_LABEL = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Reduce a raw header value to a bare hostname: first entry of a comma list,
 * lowercased, port and IPv6 brackets and any trailing root dot removed.
 * Returns null when nothing usable remains.
 */
export function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const first = raw.split(",")[0];
  if (first === undefined) return null;

  let host = first.trim().toLowerCase();
  if (!host) return null;

  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end === -1) return null;
    host = host.slice(1, end);
  } else {
    const colon = host.indexOf(":");
    // Strip a port, but only when this is not a bare IPv6 address.
    if (colon !== -1 && host.indexOf(":", colon + 1) === -1) {
      host = host.slice(0, colon);
    }
  }

  host = host.replace(/\.+$/, "");
  return host || null;
}

export function isLocalhost(host: string): boolean {
  return LOCALHOST_NAMES.has(host) || host.endsWith(".localhost");
}

/**
 * True for a host belonging to this Netlify site:
 *   <site>.netlify.app                  (the site's own hostname)
 *   <deploy-or-branch>--<site>.netlify.app   (deploy previews, branch deploys)
 *
 * The site name is pinned so unrelated Netlify sites cannot pass. Deploy labels
 * occupy a single DNS label, so a host with further dots is rejected.
 */
export function isNetlifyDeployHost(host: string, site: string): boolean {
  const slug = site.trim().toLowerCase();
  if (!slug) return false;
  if (!host.endsWith(NETLIFY_SUFFIX)) return false;

  const label = host.slice(0, -NETLIFY_SUFFIX.length);
  if (!label || label.includes(".")) return false;
  if (label === slug) return true;

  const marker = `--${slug}`;
  if (!label.endsWith(marker)) return false;

  const deployLabel = label.slice(0, -marker.length);
  return deployLabel.length > 0 && NETLIFY_LABEL.test(deployLabel);
}

/**
 * Build the policy from the environment.
 *
 * Sources, in order:
 *   ALLOWED_HOSTS      explicit comma-separated allowlist (authoritative)
 *   URL / DEPLOY_PRIME_URL / DEPLOY_URL
 *                      Netlify sets these per build; DEPLOY_PRIME_URL is the
 *                      deploy's own host, which is how previews are covered
 *                      exactly rather than by wildcard
 *   PRODUCTION_HOST    defaults to the known production host
 *   NETLIFY_SITE_NAME / SITE_NAME
 *                      Netlify sets SITE_NAME, enabling preview matching
 *
 * localhost is permitted outside production only.
 */
export function parseHostPolicy(
  env: Record<string, string | undefined> = process.env
): HostPolicy {
  const exact = new Set<string>();

  for (const part of (env.ALLOWED_HOSTS ?? "").split(",")) {
    const host = normalizeHost(part);
    if (host) exact.add(host);
  }

  for (const key of ["URL", "DEPLOY_PRIME_URL", "DEPLOY_URL"] as const) {
    const value = env[key];
    if (!value) continue;
    try {
      const host = normalizeHost(new URL(value).host);
      if (host) exact.add(host);
    } catch {
      // A malformed platform URL must not take the app down; the remaining
      // sources still apply.
    }
  }

  const productionHost = normalizeHost(env.PRODUCTION_HOST ?? "app.bitxbit.com.au");
  if (productionHost) exact.add(productionHost);

  const siteName = (env.NETLIFY_SITE_NAME ?? env.SITE_NAME ?? "").trim().toLowerCase();

  return {
    exactHosts: [...exact],
    netlifySite: siteName || undefined,
    allowLocalhost: env.NODE_ENV !== "production",
  };
}

export function isAllowedHost(host: string | null, policy: HostPolicy): boolean {
  if (!host) return false;
  if (policy.exactHosts.includes(host)) return true;
  if (policy.allowLocalhost && isLocalhost(host)) return true;
  if (policy.netlifySite && isNetlifyDeployHost(host, policy.netlifySite)) return true;
  return false;
}

/**
 * Validate every host-bearing header on a request.
 *
 * Returns ok=false at the first present header whose value is not allowlisted.
 * Absent headers are skipped — nothing to validate.
 */
export function validateRequestHost(
  headers: { get(name: string): string | null },
  policy: HostPolicy
): HostValidationResult {
  const checked: HostCheck[] = [];

  for (const header of HOST_SOURCE_HEADERS) {
    const raw = headers.get(header);
    if (raw === null || raw.trim() === "") continue;

    const host = normalizeHost(raw);
    if (host === null) continue;

    checked.push({ header, host });
    if (!isAllowedHost(host, policy)) {
      return { ok: false, checked, rejected: { header, host } };
    }
  }

  return { ok: true, checked };
}
