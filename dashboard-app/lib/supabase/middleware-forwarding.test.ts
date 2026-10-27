import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createMiddlewareCookieAdapter } from "./middleware-cookies";
import { buildForwardingResponse } from "./middleware-forwarding";

function setup(cookie = "") {
  const request = new NextRequest("https://example.test/dashboard", {
    headers: cookie ? { cookie } : undefined,
  });
  const state = { response: buildForwardingResponse(request, "203.0.113.7") };
  const adapter = createMiddlewareCookieAdapter(request, state, () =>
    buildForwardingResponse(request, "203.0.113.7")
  );
  return { request, state, adapter };
}

const forwardedCookie = (state: ReturnType<typeof setup>["state"]) =>
  state.response.headers.get("x-middleware-request-cookie");

describe("R-007 real middleware request-header forwarding", () => {
  it("serialises adapter-refreshed cookies into the downstream Cookie header", () => {
    const { adapter, state } = setup("old=1");
    adapter.setAll([{ name: "sb-auth", value: "REFRESHED", options: { path: "/" } }]);

    const cookie = forwardedCookie(state);
    assert.match(cookie ?? "", /(?:^|; )old=1(?:;|$)/);
    assert.match(cookie ?? "", /(?:^|; )sb-auth=REFRESHED(?:;|$)/);
  });

  it("rebuilds from current headers after EACH setAll, not a stale snapshot", () => {
    const { adapter, state } = setup("sb-auth.0=OLD0; sb-auth.1=OLD1");

    adapter.setAll([{ name: "sb-auth.0", value: "NEW0", options: { path: "/" } }]);
    const first = forwardedCookie(state);
    assert.doesNotMatch(first ?? "", /sb-auth\.0=OLD0/);
    assert.match(first ?? "", /sb-auth\.0=NEW0/);

    adapter.setAll([
      { name: "sb-auth.1", value: "", options: { path: "/", maxAge: 0 } },
      { name: "sb-auth.2", value: "NEW2", options: { path: "/" } },
    ]);
    const second = forwardedCookie(state);

    assert.match(second ?? "", /sb-auth\.0=NEW0/, "the first refreshed chunk must survive rebuild");
    assert.match(second ?? "", /sb-auth\.1=/, "a deleted chunk must be forwarded as cleared");
    assert.match(second ?? "", /sb-auth\.2=NEW2/, "a new chunk must reach downstream rendering");
  });

  it("forwards the resolved internal client IP alongside the refreshed cookie", () => {
    const { adapter, state } = setup();
    adapter.setAll([{ name: "fresh", value: "1" }]);

    assert.equal(state.response.headers.get("x-middleware-request-x-bitxbit-client-ip"), "203.0.113.7");
    assert.match(forwardedCookie(state) ?? "", /fresh=1/);
  });
});
