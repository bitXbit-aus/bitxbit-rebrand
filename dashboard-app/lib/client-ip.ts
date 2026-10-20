/**
 * Trusted client-IP forwarding (R-004).
 *
 * Why this module exists
 * ----------------------
 * `getClientIdentifier()` reads `x-nf-client-connection-ip`, which Netlify sets
 * to the client's address. That is correct at the *edge*, but the request is
 * passed through the middleware, which runs as a Netlify edge function and
 * forwards to the origin serverless function. That edge -> origin hop replaces
 * `x-nf-client-connection-ip` with the hop's own address, so the route handler
 * was keying its rate limits on an infrastructure address rather than the
 * client's.
 *
 * Observed in production 2026-10-20: requests from a client at 206.83.119.2
 * produced counters keyed `api:token-stats:13.236.191.253`. Every client behind
 * the same edge node therefore shared one rate-limit bucket — limits were
 * per-edge-node, not per-client, which is not what a per-IP limiter is for.
 *
 * What was tried, and why it did NOT work
 * ---------------------------------------
 * Resolving the address in the middleware and re-forwarding it in a header we
 * control was deployed on 2026-10-20 (deploy `6ad721ea`) and **changed nothing**:
 * counters were still keyed `…:13.236.191.253` afterwards, and 5 requests from a
 * client at 206.83.119.2 moved that key from 2 to 7 — so the requests did reach
 * the handler and did key on the edge address.
 *
 * That falsifies the original explanation. `x-nf-client-connection-ip` does not
 * hold the real client at the edge either. Netlify's own guidance is that this
 * header is not reliably populated inside **Edge Functions** — which is what
 * Next.js middleware is on Netlify — and that `Context.ip` supersedes it; a
 * separate production postmortem reports Netlify setting `x-forwarded-for` to
 * the edge network's address. `13.236.191.253` is an AWS Sydney edge-node
 * address, consistent with both.
 *
 * The forwarding mechanism below is therefore **not** a fix for R-004. It is
 * retained only because it hardens validation (every source must now be a bare
 * IP literal) and because it is inert — it forwards whatever the edge sees. The
 * identifier defect remains OPEN. See
 * `docs/security/evidence/rate-limit-client-identifier-2026-10-20.md`.
 *
 * Trust boundary
 * --------------
 * `CLIENT_IP_HEADER` is only trustworthy because the middleware **overwrites it
 * unconditionally** (see `withClientIp`) before the request reaches any route.
 * A client-supplied value never survives, and if no address can be resolved the
 * header is *deleted* rather than set to an empty or placeholder value, so
 * downstream falls back instead of trusting a forged one.
 *
 * Anything that reads this header must be behind the middleware matcher. The
 * matcher excludes only static assets and images, which are not rate limited.
 */

/** Header the middleware sets; carries the trusted client address. */
export const CLIENT_IP_HEADER = "x-bitxbit-client-ip";

/** A minimal headers view, so this is usable from both edge and node runtimes. */
export interface HeaderReader {
  get(name: string): string | null;
}

const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

const IPV6 =
  /^(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:|(?:[0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,5}(?::[0-9a-f]{1,4}){1,2}|(?:[0-9a-f]{1,4}:){1,4}(?::[0-9a-f]{1,4}){1,3}|(?:[0-9a-f]{1,4}:){1,3}(?::[0-9a-f]{1,4}){1,4}|(?:[0-9a-f]{1,4}:){1,2}(?::[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:(?::[0-9a-f]{1,4}){1,6}|:(?:(?::[0-9a-f]{1,4}){1,7}|:))$/i;

/**
 * True for a bare IPv4 or IPv6 literal. Rejects hostnames, ports, bracketed
 * forms and anything with whitespace, so a garbage or spoofed value can never
 * become a rate-limit key.
 */
export function isValidIp(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v || /\s/.test(v)) return false;
  return IPV4.test(v) || IPV6.test(v);
}

/**
 * Resolve the client address from the headers visible **at the edge**.
 *
 * Order:
 *   1. `x-nf-client-connection-ip` — Netlify's trusted, edge-controlled header.
 *   2. `x-forwarded-for` first entry — only when a trusted proxy is declared
 *      explicitly, because without that guard a client can pick its own bucket
 *      by sending an arbitrary forwarded header.
 *
 * Returns null when nothing trustworthy is available; the caller then forwards
 * no address at all rather than a guess.
 */
export function resolveClientIp(
  headers: HeaderReader,
  env: Record<string, string | undefined> = process.env
): string | null {
  const netlifyIp = headers.get("x-nf-client-connection-ip");
  if (isValidIp(netlifyIp)) return (netlifyIp as string).trim();

  const trustProxy =
    env.TRUST_PROXY === "true" || env.RATE_LIMIT_TRUST_PROXY === "true";
  if (trustProxy) {
    const forwarded = headers.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    if (isValidIp(first)) return first as string;
  }

  return null;
}

/**
 * Return a copy of `headers` carrying the resolved client address, or with the
 * header removed when there is none.
 *
 * Copy-then-overwrite is deliberate: an inbound `CLIENT_IP_HEADER` from the
 * client is discarded either way, so the value downstream is always ours.
 */
export function withClientIp<T extends Headers>(
  headers: T,
  clientIp: string | null
): T {
  const copy = new Headers(headers) as T;
  if (isValidIp(clientIp)) {
    copy.set(CLIENT_IP_HEADER, (clientIp as string).trim());
  } else {
    copy.delete(CLIENT_IP_HEADER);
  }
  return copy;
}
