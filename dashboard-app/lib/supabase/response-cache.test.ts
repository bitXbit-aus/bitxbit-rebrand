import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { withAuthNoStore } from "./response-cache";

/**
 * R-007 — cache safety for responses that can carry an auth cookie.
 *
 * Independent review's finding: a route handler that refreshes a session writes a
 * cookie through `cookies()`, which cannot set response headers, and middleware
 * cannot see a `Set-Cookie` added downstream. So a non-middleware route that
 * refreshed a token could return a response with no `no-store` — cacheable
 * session material.
 *
 * The second test is the structural guard: it fails when a NEW route handler
 * starts using the cookie-backed Supabase client without marking its response.
 * That is what stops the class of defect from recurring, not just this instance.
 */

const root = process.cwd();
const APP = join(root, "app");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...routeFiles(path));
    else if (entry === "route.ts") out.push(path);
  }
  return out;
}

describe("R-007 auth-cookie cache safety", () => {
  it("withAuthNoStore sets private, no-store", () => {
    const seen: Record<string, string> = {};
    const response = {
      headers: {
        set(name: string, value: string) {
          seen[name] = value;
        },
      },
    };
    assert.equal(withAuthNoStore(response), response, "must return the same response");
    assert.equal(seen["Cache-Control"], "private, no-store");
  });

  it("every route handler using the cookie-backed client marks its response no-store", () => {
    const offenders: string[] = [];
    const checked: string[] = [];

    for (const file of routeFiles(APP)) {
      const src = readFileSync(file, "utf8");
      // Only the cookie-backed server client can refresh a session and write a cookie.
      if (!src.includes("@/lib/supabase/server")) continue;
      checked.push(file.slice(root.length + 1));

      const marked =
        src.includes("withAuthNoStore") ||
        /cache-control["'\s:,]+[^\n]*no-store/i.test(src) ||
        /"Cache-Control":\s*"private, no-store"/.test(src);
      if (!marked) offenders.push(file.slice(root.length + 1));
    }

    assert.ok(checked.length > 0, "expected at least one auth-bearing route handler to check");
    assert.deepEqual(
      offenders,
      [],
      "an auth-bearing route handler can write a session cookie, so its response must be " +
        "`private, no-store` (use withAuthNoStore from lib/supabase/response-cache)"
    );
  });
});
