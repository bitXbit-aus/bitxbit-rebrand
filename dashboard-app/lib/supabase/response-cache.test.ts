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

      // An import/mention is not a guard. GPT's exact-commit review demonstrated
      // that deleting every wrapper call while retaining the import still passed
      // the old check. Inspect EVERY return after createClient(): each possible
      // post-auth response must either be wrapped or construct an explicit
      // private/no-store response at that return site.
      const postClient = src.slice(src.indexOf("createClient()") + "createClient()".length);
      const returns = [...postClient.matchAll(/\breturn\s+([^;]+);/gs)].map((m) => m[1].trim());
      const unmarked = returns.filter((expression) => {
        if (expression.startsWith("withAuthNoStore(")) return false;
        if (/cache-control["'\s:,]+[^\n]*no-store/i.test(expression)) return false;
        if (/"Cache-Control":\s*"private, no-store"/.test(expression)) return false;

        // A named response may be marked on the preceding line before return,
        // as in the OAuth callback. Require the exact returned identifier to be
        // the object whose header is set; an unrelated marked response must not
        // bless another branch.
        const identifier = expression.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
        if (!identifier) return true;
        const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return !new RegExp(
          `${escaped}\\.headers\\.set\\(\\s*["']Cache-Control["']\\s*,\\s*["']private, no-store["']\\s*\\)`,
          "i"
        ).test(postClient);
      });
      if (returns.length === 0 || unmarked.length > 0) {
        offenders.push(
          `${file.slice(root.length + 1)} (${returns.length === 0 ? "no return paths found" : `${unmarked.length} unmarked return path(s)`})`
        );
      }
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
