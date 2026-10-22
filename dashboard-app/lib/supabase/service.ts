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
 * Proved by comparison: the store path was byte-identical on every call while a
 * raw `fetch` to the very same RPC, with `cache: "no-store"`, incremented
 * normally and tripped the limit (`allowed: false`).
 *
 * Mechanism pinned 2026-10-22: Next.js's patched `fetch` caches a non-GET fetch
 * with `revalidate = false` unless the route is ALREADY dynamic
 * (`staticGenerationStore.revalidate === 0`) at the moment of the fetch — see
 * `next/dist/server/lib/patch-fetch.js`. `export const dynamic = "force-dynamic"`
 * does not protect the fetch. The flaw is NOT specific to this client: a raw
 * `fetch` with no `cache` option freezes identically. Forcing `no-store` here is
 * what makes these requests uncacheable, and is the fix, not a precaution.
 *
 * Evidence: docs/security/evidence/na14-mechanism-pinned-2026-10-22.md
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
