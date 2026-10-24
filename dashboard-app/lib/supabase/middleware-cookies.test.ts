import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createMiddlewareCookieAdapter,
  type CookieStoreLike,
  type ResponseLike,
} from "./middleware-cookies";

/**
 * R-007 — the middleware cookie adapter.
 *
 * Independent review's finding: the deployed gate can prove an authenticated
 * page renders, but removing middleware's request-cookie mutation can still
 * leave that check passing, because the page may refresh the session itself.
 * The forwarding invariant therefore had **no executable coverage**. These tests
 * execute the real adapter and mutation-fail if any of the five behaviours in
 * the module docblock regress.
 *
 * The doubles below are deliberately minimal so the suite needs no Next.js
 * runtime — the adapter only ever touches `cookies` and `headers`.
 */

function makeStore(initial: Record<string, string> = {}): CookieStoreLike & { dump(): Record<string, string> } {
  const jar = new Map<string, string>(Object.entries(initial));
  return {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set(cookie: { name: string; value: string }) {
      // Mirrors the browser/Next semantics that matter here: set REPLACES by name.
      jar.set(cookie.name, cookie.value);
    },
    dump: () => Object.fromEntries(jar),
  };
}

function makeResponse(cookies: CookieStoreLike): ResponseLike & { headerMap: Map<string, string> } {
  const headerMap = new Map<string, string>();
  return {
    cookies,
    headers: {
      set(name: string, value: string) {
        headerMap.set(name, value);
      },
    },
    headerMap,
  };
}

function setup(initialRequest: Record<string, string> = {}) {
  const requestStore = makeStore(initialRequest);
  const request = { cookies: requestStore };
  const state = { response: makeResponse(makeStore()) };
  let builds = 0;
  const adapter = createMiddlewareCookieAdapter(request, state, () => {
    builds += 1;
    // A fresh response, exactly as middleware does.
    return makeResponse(makeStore());
  });
  return { adapter, state, requestStore, builds: () => builds };
}

describe("R-007 middleware cookie adapter", () => {
  it("getAll delegates to the request cookies", () => {
    const { adapter } = setup({ a: "1" });
    assert.deepEqual(adapter.getAll(), [{ name: "a", value: "1" }]);
  });

  it("writes refreshed cookies onto BOTH the request and the response", () => {
    // The load-bearing behaviour: request-side forwarding is what downstream
    // Server Components depend on, and it is what the deployed gate cannot see.
    const { adapter, state, requestStore } = setup();
    adapter.setAll([{ name: "sb-x-auth-token", value: "REFRESHED" }]);

    assert.deepEqual(requestStore.dump(), { "sb-x-auth-token": "REFRESHED" });
    assert.deepEqual(
      (state.response.cookies as ReturnType<typeof makeStore>).dump(),
      { "sb-x-auth-token": "REFRESHED" }
    );
  });

  it("preserves cookies written by an earlier setAll call across the rebuild", () => {
    // The library can call setAll more than once. Rebuilding the response must
    // not drop the first batch — a silent session-loss path.
    const { adapter, state } = setup();
    adapter.setAll([{ name: "first", value: "1" }]);
    adapter.setAll([{ name: "second", value: "2" }]);

    assert.deepEqual(
      (state.response.cookies as ReturnType<typeof makeStore>).dump(),
      { first: "1", second: "2" }
    );
  });

  it("replaces an overlapping name instead of duplicating it", () => {
    const { adapter, state } = setup();
    adapter.setAll([{ name: "dup", value: "OLD" }]);
    adapter.setAll([{ name: "dup", value: "NEW" }]);

    const dump = (state.response.cookies as ReturnType<typeof makeStore>).dump();
    assert.equal(dump.dup, "NEW");
    assert.equal(Object.keys(dump).length, 1, "an overlapping name must not duplicate");
  });

  it("propagates a deletion rather than resurrecting the cookie", () => {
    const { adapter, state } = setup();
    adapter.setAll([{ name: "gone", value: "1" }]);
    adapter.setAll([{ name: "gone", value: "" }]); // deletion: empty value

    const dump = (state.response.cookies as ReturnType<typeof makeStore>).dump();
    assert.equal(dump.gone, "", "a deletion must overwrite, not be skipped");
  });

  it("applies the library's response headers", () => {
    // Dropping these allows a cacheable response to carry auth cookies.
    const { adapter, state } = setup();
    adapter.setAll([{ name: "c", value: "1" }], { "Cache-Control": "private, no-store" });

    assert.equal(state.response.headerMap.get("Cache-Control"), "private, no-store");
  });

  it("rebuilds the response exactly once per setAll call", () => {
    const { adapter, builds } = setup();
    adapter.setAll([{ name: "a", value: "1" }]);
    adapter.setAll([{ name: "b", value: "2" }]);
    assert.equal(builds(), 2);
  });
});
