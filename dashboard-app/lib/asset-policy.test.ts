import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALLOWED_ASSET_TYPES,
  ASSET_ACCEPT_ATTRIBUTE,
  MAX_ASSET_BYTES,
  formatBytes,
  validateAsset,
} from "./asset-policy";

describe("R-006 asset upload policy", () => {
  it("accepts a file exactly at the limit", () => {
    const result = validateAsset({ size: MAX_ASSET_BYTES, type: "image/png" });
    assert.equal(result.ok, true, "the boundary itself must be allowed");
  });

  it("rejects one byte over the limit", () => {
    const result = validateAsset({ size: MAX_ASSET_BYTES + 1, type: "image/png" });
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /smaller than/);
  });

  it("rejects an empty or missing file", () => {
    for (const candidate of [null, undefined, { size: 0, type: "image/png" }]) {
      const result = validateAsset(candidate as never);
      assert.equal(result.ok, false);
      assert.equal((result as { error: string }).error, "No file provided");
    }
  });

  it("rejects a disallowed content type", () => {
    const result = validateAsset({ size: 1024, type: "application/pdf" });
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /File type not allowed: application\/pdf/);
  });

  it("accepts every type it advertises", () => {
    for (const type of ALLOWED_ASSET_TYPES) {
      assert.equal(validateAsset({ size: 1024, type }).ok, true, `${type} must be accepted`);
    }
  });

  it("names both the limit and the actual size in the refusal", () => {
    // Legibility is the point: the operator must learn what to do, and an opaque
    // "upload failed" is exactly the failure mode this policy exists to remove.
    const result = validateAsset({ size: 7 * 1024 * 1024, type: "image/png" });
    const message = (result as { error: string }).error;
    assert.match(message, /smaller than 3 MB/);
    assert.match(message, /7 MB/, "the message must state the size that was rejected");
  });

  it("never throws on malformed input", () => {
    // A client-supplied candidate must not be able to crash the validator.
    for (const candidate of [
      { size: NaN, type: "image/png" },
      { size: 10, type: "" },
      { size: "1024", type: "image/png" },
      {},
    ]) {
      assert.doesNotThrow(() => validateAsset(candidate as never));
      assert.equal(validateAsset(candidate as never).ok, false);
    }
  });

  it("formats sizes for humans", () => {
    assert.equal(formatBytes(512), "512 bytes");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(3 * 1024 * 1024), "3 MB");
  });

  it("advertises exactly the types it enforces", () => {
    const advertised = ASSET_ACCEPT_ATTRIBUTE.split(",");
    assert.deepEqual(advertised, [...ALLOWED_ASSET_TYPES]);
  });

  it("keeps the app limit below the platform ceiling", () => {
    // Guards the budget documented in lib/asset-policy.ts: Netlify's buffered
    // request payload is 6 MB and binary payloads are base64-encoded (~30%
    // overhead), giving an effective binary ceiling of ~4.5 MB. If the app limit
    // ever rises above that, the legible refusal becomes unreachable and the
    // operator gets a platform rejection instead.
    const PLATFORM_EFFECTIVE_BINARY_CEILING = 4.5 * 1024 * 1024;
    assert.ok(
      MAX_ASSET_BYTES < PLATFORM_EFFECTIVE_BINARY_CEILING,
      `app limit ${formatBytes(MAX_ASSET_BYTES)} must stay below the platform ceiling`
    );
    assert.ok(
      PLATFORM_EFFECTIVE_BINARY_CEILING - MAX_ASSET_BYTES >= 1024 * 1024,
      "leave at least 1 MB of headroom for the multipart envelope and other fields"
    );
  });

  // The policy is only worth anything if a refusal reaches the operator. These
  // assertions fail if the upload path reverts to throwing (an opaque 500 in a
  // production build) or if a call site stops returning the refusal.
  it("returns upload refusals instead of throwing them", () => {
    const src = readFileSync(join(process.cwd(), "lib/actions.ts"), "utf8");
    assert.ok(
      !src.includes("if (error) throw new Error(error);"),
      "resolveImageUrl must return the refusal, not throw it"
    );
    assert.ok(
      src.includes("async function resolveImageUrl(") &&
        /Promise<\{ url: string \| null; error: string \| null \}>/.test(src),
      "resolveImageUrl must expose an { url, error } result"
    );
  });

  it("returns the upload refusal from every upload call site", () => {
    const src = readFileSync(join(process.cwd(), "lib/actions.ts"), "utf8");
    const guards = src.split("if (upload.error) return { error: upload.error };").length - 1;
    assert.equal(guards, 4, "createOffer, updateOffer, createProject and updateProject");
  });
});
