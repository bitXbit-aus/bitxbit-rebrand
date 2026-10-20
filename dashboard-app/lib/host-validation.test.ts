import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedHost,
  isNetlifyDeployHost,
  normalizeHost,
  parseHostPolicy,
  validateRequestHost,
  type HostPolicy,
} from "./host-validation";

function headers(entries: Record<string, string>): { get(name: string): string | null } {
  const lowered = new Map(
    Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v])
  );
  return { get: (name: string) => lowered.get(name.toLowerCase()) ?? null };
}

const POLICY: HostPolicy = {
  exactHosts: ["app.bitxbit.com.au", "staging.bitxbit.com.au"],
  netlifySite: "bitxbit-dashboard",
  allowLocalhost: false,
};

describe("normalizeHost", () => {
  it("lowercases and strips a port", () => {
    assert.equal(normalizeHost("APP.BitXBit.com.AU:443"), "app.bitxbit.com.au");
  });

  it("takes the first entry of a comma-separated list", () => {
    assert.equal(normalizeHost("app.bitxbit.com.au, evil.com"), "app.bitxbit.com.au");
  });

  it("unwraps bracketed IPv6 and strips its port", () => {
    assert.equal(normalizeHost("[::1]:3000"), "::1");
    assert.equal(normalizeHost("[::1]"), "::1");
  });

  it("does not mistake a bare IPv6 address for host:port", () => {
    assert.equal(normalizeHost("::1"), "::1");
  });

  it("strips a trailing root dot", () => {
    assert.equal(normalizeHost("app.bitxbit.com.au."), "app.bitxbit.com.au");
  });

  it("returns null for absent, empty, or unusable values", () => {
    assert.equal(normalizeHost(null), null);
    assert.equal(normalizeHost(undefined), null);
    assert.equal(normalizeHost(""), null);
    assert.equal(normalizeHost("   "), null);
    assert.equal(normalizeHost(123), null);
    assert.equal(normalizeHost("[::1"), null);
  });
});

describe("isNetlifyDeployHost", () => {
  it("accepts the site's own host", () => {
    assert.equal(isNetlifyDeployHost("bitxbit-dashboard.netlify.app", "bitxbit-dashboard"), true);
  });

  it("accepts deploy-preview and branch-deploy hosts", () => {
    assert.equal(
      isNetlifyDeployHost("deploy-123--bitxbit-dashboard.netlify.app", "bitxbit-dashboard"),
      true
    );
    assert.equal(
      isNetlifyDeployHost("security-phase-1--bitxbit-dashboard.netlify.app", "bitxbit-dashboard"),
      true
    );
    assert.equal(
      isNetlifyDeployHost("6a3a70192c291368783ed163--bitxbit-dashboard.netlify.app", "bitxbit-dashboard"),
      true
    );
  });

  it("rejects a different Netlify site", () => {
    // Pinning the slug is the whole point: a bare *.netlify.app wildcard would
    // admit any Netlify-hosted page.
    assert.equal(isNetlifyDeployHost("evil.netlify.app", "bitxbit-dashboard"), false);
    assert.equal(isNetlifyDeployHost("bitxbit-dashboard-evil.netlify.app", "bitxbit-dashboard"), false);
    assert.equal(isNetlifyDeployHost("other--bitxbit-dashboard-x.netlify.app", "bitxbit-dashboard"), false);
  });

  it("rejects hosts that only embed the suffix", () => {
    assert.equal(
      isNetlifyDeployHost("bitxbit-dashboard.netlify.app.evil.com", "bitxbit-dashboard"),
      false
    );
    assert.equal(
      isNetlifyDeployHost("deploy-1--bitxbit-dashboard.netlify.app.evil.com", "bitxbit-dashboard"),
      false
    );
  });

  it("rejects multi-label prefixes", () => {
    assert.equal(isNetlifyDeployHost("a.b.netlify.app", "bitxbit-dashboard"), false);
  });

  it("rejects an empty or malformed site slug", () => {
    assert.equal(isNetlifyDeployHost("anything.netlify.app", ""), false);
  });
});

describe("parseHostPolicy", () => {
  it("reads ALLOWED_HOSTS and normalises entries", () => {
    const policy = parseHostPolicy({
      ALLOWED_HOSTS: "app.bitxbit.com.au, STAGING.bitxbit.com.au:443 ,, ",
      NODE_ENV: "production",
    });
    assert.ok(policy.exactHosts.includes("app.bitxbit.com.au"));
    assert.ok(policy.exactHosts.includes("staging.bitxbit.com.au"));
  });

  it("derives exact hosts from Netlify build URLs", () => {
    const policy = parseHostPolicy({
      URL: "https://app.bitxbit.com.au",
      DEPLOY_PRIME_URL: "https://deploy-123--bitxbit-dashboard.netlify.app",
      DEPLOY_URL: "https://deploy-123--bitxbit-dashboard.netlify.app",
      NODE_ENV: "production",
    });
    assert.ok(policy.exactHosts.includes("app.bitxbit.com.au"));
    assert.ok(policy.exactHosts.includes("deploy-123--bitxbit-dashboard.netlify.app"));
  });

  it("ignores a malformed platform URL instead of throwing", () => {
    const policy = parseHostPolicy({ URL: "not a url", NODE_ENV: "production" });
    assert.deepEqual(policy.exactHosts, ["app.bitxbit.com.au"]);
  });

  it("defaults to the known production host and lets it be overridden", () => {
    assert.ok(
      parseHostPolicy({ NODE_ENV: "production" }).exactHosts.includes("app.bitxbit.com.au")
    );
    const custom = parseHostPolicy({ PRODUCTION_HOST: "dash.example.com", NODE_ENV: "production" });
    assert.ok(custom.exactHosts.includes("dash.example.com"));
    assert.ok(!custom.exactHosts.includes("app.bitxbit.com.au"));
  });

  it("picks up the Netlify site slug from SITE_NAME", () => {
    assert.equal(
      parseHostPolicy({ SITE_NAME: "bitxbit-dashboard", NODE_ENV: "production" }).netlifySite,
      "bitxbit-dashboard"
    );
  });

  it("permits localhost only outside production", () => {
    assert.equal(parseHostPolicy({ NODE_ENV: "development" }).allowLocalhost, true);
    assert.equal(parseHostPolicy({ NODE_ENV: "production" }).allowLocalhost, false);
  });
});

describe("isAllowedHost", () => {
  it("allows exact hosts, and localhost only when the policy permits it", () => {
    assert.equal(isAllowedHost("app.bitxbit.com.au", POLICY), true);
    assert.equal(isAllowedHost("localhost", POLICY), false);
    assert.equal(isAllowedHost("localhost", { ...POLICY, allowLocalhost: true }), true);
    assert.equal(isAllowedHost("127.0.0.1", { ...POLICY, allowLocalhost: true }), true);
  });

  it("rejects lookalike and suffix-confusion hosts", () => {
    assert.equal(isAllowedHost("app.bitxbit.com.au.evil.com", POLICY), false);
    assert.equal(isAllowedHost("evil-app.bitxbit.com.au", POLICY), false);
    assert.equal(isAllowedHost("bitxbit.com.au", POLICY), false);
    assert.equal(isAllowedHost(null, POLICY), false);
  });
});

describe("validateRequestHost", () => {
  it("accepts a request whose host is allowlisted", () => {
    const result = validateRequestHost(headers({ host: "app.bitxbit.com.au" }), POLICY);
    assert.equal(result.ok, true);
    assert.deepEqual(result.checked, [{ header: "host", host: "app.bitxbit.com.au" }]);
  });

  it("rejects a spoofed Host header", () => {
    const result = validateRequestHost(headers({ host: "evil.com" }), POLICY);
    assert.equal(result.ok, false);
    assert.deepEqual(result.rejected, { header: "host", host: "evil.com" });
  });

  it("rejects a spoofed x-forwarded-host even when host is legitimate", () => {
    // Divergence between the two is the smuggling vector, and Next prefers
    // x-forwarded-host when building URLs.
    const result = validateRequestHost(
      headers({ host: "app.bitxbit.com.au", "x-forwarded-host": "evil.com" }),
      POLICY
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.rejected, { header: "x-forwarded-host", host: "evil.com" });
  });

  it("rejects a spoofed host even when x-forwarded-host is legitimate", () => {
    const result = validateRequestHost(
      headers({ host: "evil.com", "x-forwarded-host": "app.bitxbit.com.au" }),
      POLICY
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.rejected, { header: "host", host: "evil.com" });
  });

  it("passes when no host header is present at all", () => {
    // Absence is not an attack; there is nothing to validate.
    const result = validateRequestHost(headers({}), POLICY);
    assert.equal(result.ok, true);
    assert.deepEqual(result.checked, []);
  });

  it("allows a Netlify deploy preview through the pinned site slug", () => {
    const policy: HostPolicy = { ...POLICY, allowLocalhost: false };
    const result = validateRequestHost(
      headers({ host: "deploy-9--bitxbit-dashboard.netlify.app" }),
      policy
    );
    assert.equal(result.ok, true);
  });
});
