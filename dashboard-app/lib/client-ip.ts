/**
 * Trusted client-IP resolution (R-004).
 *
 * The rule, and how it was established
 * ------------------------------------
 * Measured on production 2026-10-21 from an origin serverless function (a route
 * behind the middleware), for a request whose real client is `206.83.119.2`:
 *
 *     x-forwarded-for:            206.83.119.2, 3.107.102.194, 13.55.15.16
 *     x-nf-client-connection-ip:  3.107.102.194
 *
 * Two of those values are traps, and each was tested rather than assumed:
 *
 *   - `x-nf-client-connection-ip` is Netlify-set and **not** client-controllable
 *     (a forged value is overwritten), but it holds an **edge-node** address —
 *     not the client's. It varies per edge node, which is exactly why the limiter
 *     keyed per edge node.
 *   - The **leftmost** `x-forwarded-for` entry is the client only when the client
 *     sent no forwarded header. Netlify *preserves and prepends* a client-supplied
 *     value: sending `X-Forwarded-For: 1.2.3.4` produced
 *     `1.2.3.4, 206.83.119.2, 3.107.102.194, 16.176.74.16`. Taking the leftmost
 *     entry would let any caller choose its own rate-limit bucket.
 *
 * The client is therefore the hop **immediately to the left of the Netlify
 * anchor** in the forwarded chain. That holds under forgery because a client's
 * injected entries are always to the *left* of the chain Netlify appends, so the
 * anchor is located from the right. Verified across repeated requests and with
 * forged chains.
 *
 * Independent confirmation that the resolved address is the real client: the
 * `x-nf-geo` header for those requests decodes to the client's actual city
 * (Quirindi, NSW), which is only derivable from `206.83.119.2` — not from the
 * Sydney edge address.
 *
 * Why resolution happens at the origin
 * ------------------------------------
 * An earlier attempt resolved the address in the middleware and re-forwarded it
 * in a header we control. Deployed 2026-10-20 (deploy `6ad721ea`) it changed
 * nothing, and the instrumented request showed why: the forwarded header was
 * **absent at the origin**, as was a client-forged copy of it. Custom request
 * headers set by the middleware do not reach a serverless function here. So the
 * address is resolved at the origin, from the raw chain, where it demonstrably
 * survives.
 *
 * See `docs/security/evidence/rate-limit-client-identifier-2026-10-20.md` (§7) and
 * `docs/security/evidence/rate-limit-client-identifier-instrument-2026-10-21.md`.
 */

/** Header the middleware sets; carries the resolved address when it survives. */
export const CLIENT_IP_HEADER = "x-bitxbit-client-ip";

/** Netlify's edge-set anchor. Not client-controllable, but an edge address. */
export const NETLIFY_ANCHOR_HEADER = "x-nf-client-connection-ip";

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

/** Split a forwarded-for chain into trimmed, non-empty entries, left to right. */
export function parseForwardedFor(value: string | null | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Resolve the client address from the forwarding chain.
 *
 * Works at the origin, where the full chain is visible. Returns null when
 * nothing trustworthy is available — the caller then treats the request as
 * anonymous rather than inventing a key.
 */
export function resolveClientIp(
  headers: HeaderReader,
  env: Record<string, string | undefined> = process.env
): string | null {
  const anchorRaw = headers.get(NETLIFY_ANCHOR_HEADER);
  const chain = parseForwardedFor(headers.get("x-forwarded-for"));

  if (isValidIp(anchorRaw)) {
    const anchor = (anchorRaw as string).trim();

    // Search from the RIGHT: a client may inject entries, but they always sit to
    // the left of the chain Netlify appends, so the last occurrence is the real
    // anchor. An injected copy of the anchor value cannot displace it.
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i] !== anchor) continue;
      // The anchor is the leftmost entry, so it is the first hop: it is the client.
      if (i === 0) return anchor;
      const candidate = chain[i - 1];
      return isValidIp(candidate) ? candidate : anchor;
    }

    // Anchor absent from the chain: still Netlify-set and unspoofable, so prefer
    // it over nothing. This degrades to per-edge-node limiting, which is coarser
    // but safe.
    return anchor;
  }

  // No Netlify anchor (local development, or a different host). Only consult the
  // forwarded chain when a trusted proxy is declared, and then take the RIGHTMOST
  // entry — the immediate peer — because anything a client injects is prepended.
  const trustProxy =
    env.TRUST_PROXY === "true" || env.RATE_LIMIT_TRUST_PROXY === "true";
  if (trustProxy && chain.length > 0) {
    const immediatePeer = chain[chain.length - 1];
    if (isValidIp(immediatePeer)) return immediatePeer;
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
