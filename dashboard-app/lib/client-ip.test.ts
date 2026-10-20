import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_IP_HEADER,
  isValidIp,
  resolveClientIp,
  withClientIp,
} from "./client-ip";

function headers(entries: Record<string, string>): { get(name: string): string | null } {
  const lowered = new Map(
    Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v])
  );
  return { get: (name: string) => lowered.get(name.toLowerCase()) ?? null };
}

describe("isValidIp", () => {
  it("accepts IPv4 literals", () => {
    assert.equal(isValidIp("206.83.119.2"), true);
    assert.equal(isValidIp("0.0.0.0"), true);
    assert.equal(isValidIp("255.255.255.255"), true);
  });

  it("rejects out-of-range and malformed IPv4", () => {
    assert.equal(isValidIp("256.1.1.1"), false);
    assert.equal(isValidIp("1.2.3"), false);
    assert.equal(isValidIp("1.2.3.4.5"), false);
    assert.equal(isValidIp("01.2.3.4"), false);
  });

  it("accepts IPv6 forms, including compressed", () => {
    assert.equal(isValidIp("::1"), true);
    assert.equal(isValidIp("2001:db8::1"), true);
    assert.equal(isValidIp("2001:0db8:0000:0000:0000:0000:0000:0001"), true);
    assert.equal(isValidIp("fe80::"), true);
  });

  it("rejects values that are not a bare address", () => {
    // A hostname, a port, a bracketed form, or a list must never become a key.
    assert.equal(isValidIp("evil.com"), false);
    assert.equal(isValidIp("1.2.3.4:80"), false);
    assert.equal(isValidIp("[::1]"), false);
    assert.equal(isValidIp("1.2.3.4, 5.6.7.8"), false);
    assert.equal(isValidIp(" 1.2.3.4 "), true, "surrounding space is trimmed");
    assert.equal(isValidIp("1.2.3.4 5.6.7.8"), false);
    assert.equal(isValidIp(""), false);
    assert.equal(isValidIp("   "), false);
    assert.equal(isValidIp(null), false);
    assert.equal(isValidIp(undefined), false);
  });
});

describe("resolveClientIp", () => {
  it("prefers Netlify's trusted client-connection header", () => {
    assert.equal(
      resolveClientIp(headers({ "x-nf-client-connection-ip": "206.83.119.2" })),
      "206.83.119.2"
    );
  });

  it("ignores an invalid Netlify header rather than forwarding it", () => {
    assert.equal(
      resolveClientIp(headers({ "x-nf-client-connection-ip": "not-an-ip" })),
      null
    );
  });

  it("ignores x-forwarded-for unless a trusted proxy is declared", () => {
    const h = headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
    assert.equal(resolveClientIp(h, {}), null);
    assert.equal(resolveClientIp(h, { TRUST_PROXY: "true" }), "9.9.9.9");
    assert.equal(
      resolveClientIp(h, { RATE_LIMIT_TRUST_PROXY: "true" }),
      "9.9.9.9"
    );
  });

  it("returns null when nothing trustworthy is present", () => {
    assert.equal(resolveClientIp(headers({}), {}), null);
  });
});

describe("withClientIp", () => {
  it("sets the header when an address was resolved", () => {
    const out = withClientIp(new Headers(), "206.83.119.2");
    assert.equal(out.get(CLIENT_IP_HEADER), "206.83.119.2");
  });

  it("OVERWRITES a client-supplied value — the load-bearing property", () => {
    // Without this the header would be a trivially spoofable rate-limit key:
    // a caller could pick any bucket by sending their own value.
    const inbound = new Headers({ [CLIENT_IP_HEADER]: "1.2.3.4" });
    const out = withClientIp(inbound, "206.83.119.2");
    assert.equal(out.get(CLIENT_IP_HEADER), "206.83.119.2");
    assert.notEqual(out.get(CLIENT_IP_HEADER), "1.2.3.4");
  });

  it("DELETES a client-supplied value when nothing could be resolved", () => {
    // Falling back must not mean trusting the forged header.
    const inbound = new Headers({ [CLIENT_IP_HEADER]: "1.2.3.4" });
    const out = withClientIp(inbound, null);
    assert.equal(out.get(CLIENT_IP_HEADER), null);
  });

  it("deletes rather than writing a placeholder for an invalid address", () => {
    const out = withClientIp(new Headers(), "not-an-ip");
    assert.equal(out.get(CLIENT_IP_HEADER), null);
  });

  it("leaves unrelated headers untouched", () => {
    const out = withClientIp(new Headers({ "user-agent": "curl/8.7.1" }), "1.2.3.4");
    assert.equal(out.get("user-agent"), "curl/8.7.1");
    assert.equal(out.get(CLIENT_IP_HEADER), "1.2.3.4");
  });
});
