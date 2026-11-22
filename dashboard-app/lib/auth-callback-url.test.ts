import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAuthRedirectBase,
  resolveSignInDomain,
  resolveRequestOrigin,
  FALLBACK_SIGNIN_DOMAIN,
} from "./auth-callback-url";
import type { HostPolicy } from "./host-validation";

const POLICY: HostPolicy = {
  exactHosts: ["app.bitxbit.com.au"],
  netlifySite: "bitxbit-dashboard",
  allowLocalhost: false,
};

const CANONICAL = "https://app.bitxbit.com.au";

// --- Regression 2026-11-22: `request.url` carries Netlify's per-deploy permalink ---
//
// Since next@15.5.29, `request.url` resolves from `x-forwarded-host`, which on Netlify
// is the deploy's own `<hash>--bitxbit-dashboard.netlify.app`. That permalink matches
// the site-slug allowlist, so it BEAT the canonical URL — production began telling
// members to sign for a permalink host, and the magic-link callback would have
// redirected them there. The `host` header (what the browser asked for) now wins.

const PERMALINK_URL =
  "https://6b0361cab5ff06d366311ce8--bitxbit-dashboard.netlify.app/api/auth/wallet/challenge";

test("the host header wins over a deploy permalink in request.url", () => {
  assert.equal(
    resolveRequestOrigin(PERMALINK_URL, "app.bitxbit.com.au", "https"),
    "https://app.bitxbit.com.au"
  );
});

test("the sign-in message names the host the member is on, not the permalink", () => {
  const base = resolveRequestOrigin(PERMALINK_URL, "app.bitxbit.com.au", null);
  assert.equal(resolveSignInDomain(base, POLICY, CANONICAL), "app.bitxbit.com.au");
});

test("a preview host is still kept — previews are not bound to production", () => {
  const previewHost = "deploy-preview-94--bitxbit-dashboard.netlify.app";
  const base = resolveRequestOrigin(
    `https://${previewHost}/api/auth/wallet/challenge`,
    previewHost,
    "https"
  );
  assert.equal(resolveSignInDomain(base, POLICY, CANONICAL), previewHost);
});

test("an absent host header falls back to request.url, not an empty base", () => {
  assert.equal(
    resolveRequestOrigin("https://app.bitxbit.com.au/x", null, null),
    "https://app.bitxbit.com.au/x"
  );
});

test("the scheme comes from x-forwarded-proto, defaulting to https", () => {
  // A port is normalised away by normalizeHost, so only the hostname survives.
  assert.equal(resolveRequestOrigin("https://x/y", "localhost:3000", "http"), "http://localhost");
  assert.equal(
    resolveRequestOrigin("https://x/y", "app.bitxbit.com.au", ""),
    "https://app.bitxbit.com.au"
  );
  assert.equal(
    resolveRequestOrigin("https://x/y", "app.bitxbit.com.au", "gopher"),
    "https://app.bitxbit.com.au"
  );
});

test("a disallowed host header still falls back to the canonical URL", () => {
  const base = resolveRequestOrigin("https://x/y", "evil.example", "https");
  assert.equal(resolveAuthRedirectBase(base, POLICY, CANONICAL), CANONICAL);
});

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
