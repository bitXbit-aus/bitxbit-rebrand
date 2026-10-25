import assert from "node:assert/strict";
import test from "node:test";

import { resolveAuthRedirectBase } from "./auth-callback-url";
import type { HostPolicy } from "./host-validation";

const POLICY: HostPolicy = {
  exactHosts: ["app.bitxbit.com.au"],
  netlifySite: "bitxbit-dashboard",
  allowLocalhost: false,
};

const CANONICAL = "https://app.bitxbit.com.au";

test("keeps the production origin", () => {
  assert.equal(
    resolveAuthRedirectBase("https://app.bitxbit.com.au/auth/callback?code=x", POLICY, CANONICAL),
    CANONICAL
  );
});

test("keeps a deploy-preview origin instead of collapsing to production", () => {
  // The residual this fixes: a preview sign-in must not end on production.
  assert.equal(
    resolveAuthRedirectBase(
      "https://deploy-preview-53--bitxbit-dashboard.netlify.app/auth/callback?code=x",
      POLICY,
      CANONICAL
    ),
    "https://deploy-preview-53--bitxbit-dashboard.netlify.app"
  );
});

test("keeps the site's own netlify.app host", () => {
  assert.equal(
    resolveAuthRedirectBase("https://bitxbit-dashboard.netlify.app/auth/callback", POLICY, CANONICAL),
    "https://bitxbit-dashboard.netlify.app"
  );
});

test("falls back to the canonical URL for an unrecognised host", () => {
  assert.equal(
    resolveAuthRedirectBase("https://evil.example/auth/callback", POLICY, CANONICAL),
    CANONICAL
  );
});

test("rejects a lookalike Netlify suffix host", () => {
  assert.equal(
    resolveAuthRedirectBase("https://x--bitxbit-dashboard.netlify.app.evil.com/auth/callback", POLICY, CANONICAL),
    CANONICAL
  );
});

test("falls back to the origin when no canonical URL is configured", () => {
  assert.equal(
    resolveAuthRedirectBase("https://evil.example/auth/callback", POLICY, undefined),
    "https://evil.example"
  );
});

test("handles a malformed request URL", () => {
  assert.equal(resolveAuthRedirectBase("not a url", POLICY, CANONICAL), CANONICAL);
  assert.equal(resolveAuthRedirectBase("not a url", POLICY, undefined), "");
});

test("ignores a non-standard port only after normalisation", () => {
  // A port is stripped for the allowlist decision, but the origin is preserved as-is.
  assert.equal(
    resolveAuthRedirectBase("https://app.bitxbit.com.au:8443/auth/callback", POLICY, CANONICAL),
    "https://app.bitxbit.com.au:8443"
  );
});
