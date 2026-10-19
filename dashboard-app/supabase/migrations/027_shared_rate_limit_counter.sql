-- Phase 1: shared rate-limit counter (R-004).
--
-- Why this exists
-- ---------------
-- getRateLimitStore() fell back to an in-process Map whenever Upstash was not
-- configured, and Upstash is not configured. On Netlify every request may be
-- served by a different serverless instance, so per-instance limits let an
-- attacker spread requests and receive a multiple of the intended allowance.
-- The fallback was also silent, which is why this stayed unnoticed.
--
-- Why Postgres and not Netlify Blobs
-- ----------------------------------
-- Blobs cannot back a correct counter. Its default consistency model is
-- eventual (updates propagate to edge locations within 60 seconds, while a rate
-- limit window is measured in seconds), it has no transactions, and Netlify's
-- own guidance is explicit that counters and read-modify-write logic must not be
-- built on a blob key "even with onlyIfMatch retries". A conditional-write
-- retry loop would also ride on a known SDK defect that reports `modified: true`
-- for non-412 failures, i.e. a silent lost write.
--
-- A single INSERT ... ON CONFLICT DO UPDATE ... RETURNING is atomic: concurrent
-- sessions serialise on the row lock and the second re-evaluates against the
-- committed row. That is the guarantee the RateLimitStore interface documents.
--
-- Semantics
-- ---------
-- Fixed window, anchored to the first request in the window, matching the Redis
-- store this replaces (a key with a per-window expiry). Once the stored window
-- has elapsed, the next request resets it rather than extending it, so a caller
-- cannot keep a window alive indefinitely.

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  window_ms INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Supports the bounded cleanup below without scanning the whole table.
CREATE INDEX IF NOT EXISTS rate_limit_counters_expires_at_idx
  ON public.rate_limit_counters (expires_at);

-- Defence in depth: no policies means no row is visible to anon or
-- authenticated even if a table grant were added by mistake. The RPC below is
-- SECURITY DEFINER, so callers never need direct table access.
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key TEXT,
  p_window_ms INTEGER,
  p_max_requests INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_window_started_at TIMESTAMPTZ;
  v_window_ms INTEGER;
  v_count INTEGER;
  v_reset_at TIMESTAMPTZ;
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'rate limit key is required';
  END IF;
  IF p_window_ms IS NULL OR p_window_ms <= 0 THEN
    RAISE EXCEPTION 'rate limit window must be a positive number of milliseconds';
  END IF;
  IF p_max_requests IS NULL OR p_max_requests <= 0 THEN
    RAISE EXCEPTION 'rate limit maximum must be a positive number of requests';
  END IF;

  -- One atomic statement. The CASE expressions deliberately read the *old* row
  -- (all SET expressions see pre-update values in Postgres), which is what makes
  -- the reset-and-increment decision consistent within a single evaluation.
  INSERT INTO public.rate_limit_counters AS c (
    key, window_started_at, window_ms, count, expires_at
  )
  VALUES (
    p_key,
    v_now,
    p_window_ms,
    1,
    v_now + make_interval(secs => p_window_ms / 1000.0)
  )
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
          WHEN c.window_started_at <= v_now - make_interval(secs => c.window_ms / 1000.0)
            THEN 1
          ELSE c.count + 1
        END,
        window_started_at = CASE
          WHEN c.window_started_at <= v_now - make_interval(secs => c.window_ms / 1000.0)
            THEN v_now
          ELSE c.window_started_at
        END,
        window_ms = p_window_ms,
        expires_at = CASE
          WHEN c.window_started_at <= v_now - make_interval(secs => c.window_ms / 1000.0)
            THEN v_now + make_interval(secs => p_window_ms / 1000.0)
          ELSE c.expires_at
        END
  RETURNING count, window_started_at, window_ms
  INTO v_count, v_window_started_at, v_window_ms;

  v_reset_at := v_window_started_at + make_interval(secs => v_window_ms / 1000.0);

  -- Bounded, probabilistic reaping. Without it the table grows with every
  -- distinct caller forever. The LIMIT keeps the cost small and predictable, and
  -- running it on ~2% of calls keeps the write off the common path; expired rows
  -- are harmless in the meantime because a stale window resets rather than
  -- accumulates.
  IF random() < 0.02 THEN
    DELETE FROM public.rate_limit_counters
    WHERE key IN (
      SELECT key
      FROM public.rate_limit_counters
      WHERE expires_at < v_now
      LIMIT 100
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_count <= p_max_requests,
    'remaining', GREATEST(0, p_max_requests - v_count),
    'resetAt', (EXTRACT(EPOCH FROM v_reset_at) * 1000)::BIGINT
  );
END;
$$;

-- Only the server may call this. The app reaches it with the service-role key;
-- anon and authenticated must not be able to probe or exhaust counters.
REVOKE ALL ON TABLE public.rate_limit_counters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
