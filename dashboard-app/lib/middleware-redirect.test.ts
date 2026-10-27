import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { redirectWithCookies } from "./middleware-redirect";

describe("redirectWithCookies", () => {
  it("carries a refreshed session cookie onto the redirect", () => {
    const from = NextResponse.next();
    from.cookies.set({
      name: "sb-proj-auth-token",
      value: "refreshed-session",
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 3600,
    });

    const redirect = redirectWithCookies("https://app.example.com/auth/login", from);

    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get("location"), "https://app.example.com/auth/login");

    const set = redirect.headers.getSetCookie();
    assert.equal(set.length, 1, "the refreshed cookie must be present on the redirect");
    assert.match(set[0], /sb-proj-auth-token=refreshed-session/);
    assert.match(set[0], /HttpOnly/i);
    assert.match(set[0], /Max-Age=3600/i);
    assert.match(set[0], /SameSite=lax/i);
  });

  it("preserves every cookie when the adapter wrote more than one", () => {
    const from = NextResponse.next();
    from.cookies.set({ name: "sb-a", value: "1", path: "/" });
    from.cookies.set({ name: "sb-b", value: "2", path: "/" });

    const set = redirectWithCookies(new URL("https://app.example.com/dashboard"), from).headers.getSetCookie();

    assert.equal(set.length, 2);
    assert.ok(set.some((c) => c.startsWith("sb-a=1")));
    assert.ok(set.some((c) => c.startsWith("sb-b=2")));
  });

  it("adds no cookies when nothing was refreshed", () => {
    const set = redirectWithCookies("https://app.example.com/dashboard", NextResponse.next())
      .headers.getSetCookie();
    assert.equal(set.length, 0, "a redirect with no refresh must not invent cookies");
  });

  it("accepts a URL object as well as a string", () => {
    const redirect = redirectWithCookies(new URL("https://app.example.com/x"), NextResponse.next());
    assert.equal(redirect.headers.get("location"), "https://app.example.com/x");
  });

  it("returns a redirect, not a pass-through, so the branch cannot fall through", () => {
    const redirect = redirectWithCookies("https://app.example.com/auth/login", NextResponse.next());
    assert.equal(redirect.status, 307);
    assert.ok(redirect.headers.get("location"));
  });
});
