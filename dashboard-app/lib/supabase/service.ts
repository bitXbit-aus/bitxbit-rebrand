import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Reads and RPCs through this client MUST NOT be cached.
 *
 * Measured (NA-14, 2026-10-21): Next.js patches the global `fetch`, and through
 * this client the `check_rate_limit` RPC was served from that cache — the same
 * result came back within a request and across requests, so the rate limiter's
 * counter never advanced and its limit could never trip. An expired window kept
 * reporting `resetAt` 82.5 s in the past.
 *
 * Proved by comparison in production: the store path was byte-identical on every
 * call while a raw `fetch` to the very same RPC, with `cache: "no-store"`,
 * incremented normally and tripped the limit (`allowed: false`). A raw `fetch`
 * with no cache option also advanced, so the caching is specific to how this
 * client issues requests.
 *
 * Forcing `no-store` here is therefore the fix, not a precaution: a replayed
 * response makes a security control silently inoperative, and would equally serve
 * stale data from any query through this client.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: "no-store" }),
      },
    }
  );
}
