/**
 * Middleware cookie adapter for `@supabase/ssr` 0.12.x.
 *
 * Extracted from `middleware.ts` so its behaviour can be **executed** by unit
 * tests. The deployed gate can prove that an authenticated page renders, but it
 * cannot distinguish "middleware forwarded its refreshed request cookies" from
 * "the page refreshed the session itself inside the provider's reuse window".
 * This adapter is where that forwarding happens, so the exact semantics are
 * asserted in `middleware-cookies.test.ts`:
 *
 *   1. refreshed cookies are written onto BOTH the request (so downstream
 *      Server Components see them in this same request) and the response (so the
 *      browser receives them);
 *   2. a second `setAll` call preserves the cookies written by the first —
 *      rebuilding the response must not silently drop an earlier batch;
 *   3. an overlapping name REPLACES rather than duplicating;
 *   4. a deletion is propagated, not resurrected;
 *   5. the library's response headers (cache directives) are applied.
 *
 * Do not simplify this. A wrong adapter here causes silent session loss rather
 * than an error.
 */

/* The third-party boundary is deliberately loose: `options` and `headersToSet`
 * are `any` because `@supabase/ssr` owns their shapes and narrowing them here
 * would break structural compatibility with the real client. */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CookieStoreLike {
  getAll(): { name: string; value: string }[];
  set(cookie: { name: string; value: string }): unknown;
}

export interface ResponseLike {
  cookies: CookieStoreLike;
  headers: { set(name: string, value: string): unknown };
}

export interface RequestLike {
  cookies: CookieStoreLike;
}

/** Holds the current response so the adapter can rebuild it in place. */
export interface MiddlewareCookieState {
  response: ResponseLike;
}

export interface CookieToSet {
  name: string;
  value: string;
  options?: any;
}

export interface MiddlewareCookieAdapter {
  getAll(): { name: string; value: string }[];
  setAll(cookiesToSet: CookieToSet[], headersToSet?: Record<string, string>): void;
}

export function createMiddlewareCookieAdapter(
  request: RequestLike,
  state: MiddlewareCookieState,
  buildResponse: () => ResponseLike
): MiddlewareCookieAdapter {
  return {
    getAll() {
      return request.cookies.getAll();
    },

    setAll(cookiesToSet: CookieToSet[], headersToSet?: Record<string, string>) {
      // 1. The REQUEST. Without this the refreshed session never reaches Server
      //    Components rendering in this same request.
      cookiesToSet.forEach(({ name, value, ...options }) => {
        request.cookies.set({ name, value, ...options });
      });

      // 2. Carry cookies written by any EARLIER setAll across the rebuild.
      //    Replacing the response object outright would silently drop them, and
      //    the library can invoke setAll more than once per request.
      const alreadyWritten = state.response.cookies.getAll();
      state.response = buildResponse();
      for (const cookie of alreadyWritten) {
        state.response.cookies.set(cookie);
      }

      // 3. The new batch. Setting by name REPLACES, so an overlapping cookie
      //    never ends up duplicated or stale.
      cookiesToSet.forEach(({ name, value, ...options }) => {
        state.response.cookies.set({ name, value, ...options });
      });

      // 4. The library's response headers. Dropping them would allow a cacheable
      //    response to carry auth cookies.
      for (const [key, value] of Object.entries(headersToSet ?? {})) {
        state.response.headers.set(key, value);
      }
    },
  };
}
