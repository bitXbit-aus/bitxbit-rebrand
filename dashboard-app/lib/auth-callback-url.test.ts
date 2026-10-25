import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAuthRedirectBase,
  resolveSignInDomain,
  FALLBACK_SIGNIN_DOMAIN,
} from "./auth-callback-url";
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

// ---------------------------------------------------------------------------
// Phase 2 (B3) — the SIWS sign-in message names a DOMAIN, so this reduces the
// same decision to a hostname. The point of these tests is the preview case: a
// sign-in on a deploy preview must not display, and have the user sign,
// production's hostname.
// ---------------------------------------------------------------------------

test("sign-in domain keeps a deploy-preview host instead of collapsing to production", () => {
  assert.equal(
    resolveSignInDomain(
      "https://deploy-preview-58--bitxbit-dashboard.netlify.app/api/auth/wallet/challenge",
      POLICY,
      CANONICAL
    ),
    "deploy-preview-58--bitxbit-dashboard.netlify.app"
  );
});

test("sign-in domain keeps the production host", () => {
  assert.equal(
    resolveSignInDomain(
      "https://app.bitxbit.com.au/api/auth/wallet/challenge",
      POLICY,
      CANONICAL
    ),
    "app.bitxbit.com.au"
  );
});

test("sign-in domain falls back to the canonical host for a disallowed host", () => {
  assert.equal(
    resolveSignInDomain("https://evil.example/api/auth/wallet/challenge", POLICY, CANONICAL),
    "app.bitxbit.com.au"
  );
});

test("sign-in domain rejects a lookalike Netlify suffix host", () => {
  assert.equal(
    resolveSignInDomain(
      "https://x--bitxbit-dashboard.netlify.app.evil.com/api/auth/wallet/challenge",
      POLICY,
      CANONICAL
    ),
    "app.bitxbit.com.au"
  );
});

test("sign-in domain falls back when the URL is malformed and nothing is canonical", () => {
  assert.equal(resolveSignInDomain("not a url", POLICY, undefined), FALLBACK_SIGNIN_DOMAIN);
  assert.equal(resolveSignInDomain("not a url", POLICY, "also not a url"), FALLBACK_SIGNIN_DOMAIN);
});

test("sign-in domain is never empty", () => {
  // The message is built by concatenation; an empty domain would produce a SIWS
  // message with no origin at all, which the user cannot meaningfully approve.
  for (const url of ["", "://", "not a url", "https://app.bitxbit.com.au"]) {
    assert.notEqual(resolveSignInDomain(url, POLICY, undefined), "");
  }
});
