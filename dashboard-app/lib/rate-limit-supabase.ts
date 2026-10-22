import { MemoryRateLimitStore, RateLimitResult, RateLimitStore } from "./rate-limit-store";
import { recordRateLimitDegradation } from "./rate-limit-health";

/**
 * Raised when the RPC answered but the payload cannot be trusted. Distinct from
 * a transport failure so the degradation registry can report which happened
 * (NA-15) — "the store is unreachable" and "the store is returning nonsense"
 * call for different responses.
 */
export class RateLimitPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitPayloadError";
  }
}

/**
 * Shared rate-limit store backed by the `check_rate_limit` RPC (migration 027).
 *
 * Why Postgres and not Netlify Blobs: Blobs is eventually consistent by default
 * (updates propagate within 60 seconds — longer than a rate-limit window), has no
 * transactions, and Netlify's own guidance says counters must not be built on a
 * blob key "even with onlyIfMatch retries". A single atomic
 * INSERT ... ON CONFLICT DO UPDATE ... RETURNING gives the atomicity the
 * RateLimitStore interface requires.
 *
 * The client is injected rather than imported so this store is testable without a
 * live database and so it carries no dependency on the server-only Supabase
 * helpers.
 */

/** The slice of the Supabase client this store uses. */
export interface RateLimitRpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export interface SupabaseRateLimitStoreOptions {
  client: RateLimitRpcClient;
  /**
   * Used when the RPC is unavailable. Defaults to an in-memory store so a
   * database blip degrades to per-instance limits rather than failing open —
   * allowing every request would quietly remove the control entirely.
   */
  fallback?: RateLimitStore;
  /** Injected for tests. */
  onError?: (error: unknown) => void;
  /** Injected for tests. */
  now?: () => number;
}

/** Suppress repeated failure logs; a database outage must not flood the log. */
const ERROR_LOG_INTERVAL_MS = 60_000;

export class SupabaseRateLimitStore implements RateLimitStore {
  private readonly client: RateLimitRpcClient;
  private readonly fallback: RateLimitStore;
  private readonly onError: (error: unknown) => void;
  private readonly now: () => number;
  private lastErrorLoggedAt = Number.NEGATIVE_INFINITY;

  constructor(options: SupabaseRateLimitStoreOptions) {
    this.client = options.client;
    this.fallback = options.fallback ?? new MemoryRateLimitStore();
    this.now = options.now ?? (() => Date.now());
    this.onError =
      options.onError ??
      ((error: unknown) => {
        console.error(
          "[rate-limit] shared store unavailable; degraded to per-instance limits for this request.",
          error
        );
      });
  }

  async increment(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    try {
      const { data, error } = await this.client.rpc("check_rate_limit", {
        p_key: key,
        p_window_ms: windowMs,
        p_max_requests: maxRequests,
      });

      if (error) {
        throw new Error(error.message ?? "check_rate_limit RPC failed");
      }

      return parseRateLimitResult(data);
    } catch (error) {
      // NA-15: record before falling back. The log below is not enough — it is
      // throttled, and production request logs did not retain it, so this is the
      // only durable evidence that the shared store stopped being used.
      recordRateLimitDegradation(
        error instanceof RateLimitPayloadError ? "invalid-payload" : "store-unavailable"
      );
      this.reportThrottled(error);
      return this.fallback.increment(key, windowMs, maxRequests);
    }
  }

  /**
   * Logs a failure at most once per interval. A malformed or missing RPC
   * response is treated exactly like a transport failure — never as "allowed",
   * because a bug that silently permitted traffic would be indistinguishable
   * from a working limiter.
   */
  private reportThrottled(error: unknown): void {
    const now = this.now();
    if (now - this.lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;
    this.lastErrorLoggedAt = now;
    this.onError(error);
  }
}

/**
 * Validate the RPC payload before trusting it. Anything unexpected is an error,
 * which routes to the fallback rather than to a permissive default.
 */
export function parseRateLimitResult(data: unknown): RateLimitResult {
  if (typeof data !== "object" || data === null) {
    throw new RateLimitPayloadError("check_rate_limit returned no result");
  }

  const { allowed, remaining, resetAt } = data as Record<string, unknown>;

  if (
    typeof allowed !== "boolean" ||
    typeof remaining !== "number" ||
    typeof resetAt !== "number" ||
    !Number.isFinite(remaining) ||
    !Number.isFinite(resetAt)
  ) {
    throw new RateLimitPayloadError("check_rate_limit returned an unexpected payload");
  }

  return {
    allowed,
    remaining: Math.max(0, Math.trunc(remaining)),
    resetAt,
  };
}
