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
 * The forwarding invariant therefore had **no executable coverage**.
 *
 * A later review round found the extraction had introduced a real regression:
 * `({ name, value, ...options })` uses a REST element, so the attributes ended up
 * NESTED under an `options` key that `set` ignores — silently discarding Path,
 * Max-Age/Expires, SameSite and Secure, including a deletion's `Max-Age: 0`.
 *
 * The doubles below therefore record the **entire object** handed to `set`, and
 * the attribute tests assert the top-level shape. Doubles that record only
 * name/value are exactly what concealed the defect, so do not weaken them.
 *
 * No Next.js runtime is needed: the adapter only touches `cookies` and `headers`.
 */

type RawCookie = Record<string, unknown>;

interface RecordingStore extends CookieStoreLike {
  dump(): Record<string, string>;
  dumpFull(): Record<string, RawCookie>;
}

function makeStore(initial: Record<string, string> = {}): RecordingStore {
  const jar = new Map<string, RawCookie>(
    Object.entries(initial).map(([name, value]) => [name, { name, value }])
  );
  return {
    getAll: () => [...jar].map(([name, value]) => ({ name, value: String(value.value ?? "") })),
    set(cookie: { name: string; value: string }) {
      // Records EVERYTHING the caller passed, attributes included.
      jar.set(cookie.name, cookie as unknown as RawCookie);
    },
    dump: () =>
      Object.fromEntries([...jar].map(([name, c]) => [name, String(c.value ?? "")])),
    dumpFull: () => Object.fromEntries(jar),
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
    return makeResponse(makeStore());
  });
  return { adapter, state, requestStore, builds: () => builds };
}

const responseFull = (state: { response: ResponseLike }) =>
  (state.response.cookies as RecordingStore).dumpFull();
const requestFull = (store: RecordingStore) => store.dumpFull();

describe("R-007 middleware cookie adapter", () => {
  it("getAll delegates to the request cookies", () => {
    const { adapter } = setup({ a: "1" });
    assert.deepEqual(adapter.getAll(), [{ name: "a", value: "1" }]);
  });

  it("writes refreshed cookies onto BOTH the request and the response", () => {
    const { adapter, state, requestStore } = setup();
    adapter.setAll([{ name: "sb-x-auth-token", value: "REFRESHED" }]);

    assert.deepEqual(requestStore.dump(), { "sb-x-auth-token": "REFRESHED" });
    assert.deepEqual(responseFull(state), { "sb-x-auth-token": { name: "sb-x-auth-token", value: "REFRESHED" } });
  });

  // --- the regression guard -------------------------------------------------
  // These are the assertions that would have caught the rest-element bug. A
  // double that records only name/value cannot fail them.

  it("applies cookie attributes at the TOP LEVEL, never nested under an options key", () => {
    const { adapter, state } = setup();
    adapter.setAll([
      {
        name: "sb-x-auth-token",
        value: "V",
        options: { path: "/", maxAge: 3600, sameSite: "lax", secure: true, httpOnly: true },
      },
    ]);

    const raw = responseFull(state)["sb-x-auth-token"];
    assert.equal(raw.path, "/", "Path must be applied at the top level");
    assert.equal(raw.maxAge, 3600, "Max-Age must be applied at the top level");
    assert.equal(raw.sameSite, "lax", "SameSite must be applied at the top level");
    assert.equal(raw.secure, true, "Secure must be applied at the top level");
    assert.equal(raw.httpOnly, true, "HttpOnly must be applied at the top level");
    assert.ok(
      !("options" in raw),
      "attributes must NOT be nested under an `options` key — `set` ignores it, which silently drops them"
    );
  });

  it("propagates deletion semantics — Max-Age 0 must reach the response", () => {
    // Without Max-Age the cookie is written EMPTY but not deleted, so a stale
    // generation survives in the browser and can be picked up on reconstruction.
    const { adapter, state } = setup();
    adapter.setAll([{ name: "sb-x-auth-token.1", value: "", options: { path: "/", maxAge: 0 } }]);

    const raw = responseFull(state)["sb-x-auth-token.1"];
    assert.equal(raw.maxAge, 0, "a deletion must carry Max-Age 0 or the browser keeps the cookie");
    assert.ok(!("options" in raw), "the deletion's attributes must be top-level too");
  });

  it("applies attributes to the REQUEST cookies as well", () => {
    const { adapter, requestStore } = setup();
    adapter.setAll([{ name: "sb-x-auth-token", value: "V", options: { path: "/", maxAge: 60 } }]);

    const raw = requestFull(requestStore)["sb-x-auth-token"];
    assert.equal(raw.path, "/");
    assert.equal(raw.maxAge, 60);
    assert.ok(!("options" in raw), "the request side must not nest attributes either");
  });

  it("preserves an Expires attribute alongside Max-Age", () => {
    const { adapter, state } = setup();
    const expires = new Date(Date.now() + 86_400_000).toUTCString();
    adapter.setAll([{ name: "c", value: "v", options: { path: "/", maxAge: 86400, expires } }]);

    const raw = responseFull(state).c;
    assert.equal(raw.expires, expires);
    assert.equal(raw.maxAge, 86400);
  });

  // --- batching / replacement ----------------------------------------------

  it("preserves cookies written by an earlier setAll call across the rebuild", () => {
    const { adapter, state } = setup();
    adapter.setAll([{ name: "first", value: "1" }]);
    adapter.setAll([{ name: "second", value: "2" }]);

    assert.deepEqual(Object.keys(responseFull(state)).sort(), ["first", "second"]);
  });

  it("replaces an overlapping name instead of duplicating it", () => {
    const { adapter, state } = setup();
    adapter.setAll([{ name: "dup", value: "OLD" }]);
    adapter.setAll([{ name: "dup", value: "NEW" }]);

    const dump = responseFull(state);
    assert.equal(dump.dup.value, "NEW");
    assert.equal(Object.keys(dump).length, 1, "an overlapping name must not duplicate");
  });

  it("carries an earlier batch's attributes across a rebuild", () => {
    const { adapter, state } = setup();
    adapter.setAll([{ name: "keep", value: "1", options: { path: "/", maxAge: 99 } }]);
    adapter.setAll([{ name: "other", value: "2", options: { path: "/", maxAge: 5 } }]);

    assert.equal(responseFull(state).keep.maxAge, 99);
  });

  it("applies the library's response headers", () => {
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
