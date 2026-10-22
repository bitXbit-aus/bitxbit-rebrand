import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * R-002 — guards the reasoning that makes CVE-2025-3194 (bigint-buffer
 * `toBigIntLE` overflow) non-reachable in this application.
 *
 * The vulnerability aborts the process only on NON-Buffer input. The app reaches
 * `toBigIntLE` solely through `@solana/spl-token` → `@solana/buffer-layout-utils`,
 * whose decode passes `Buffer.from(src)`. That is a *structural* argument, so it
 * is worth asserting: if a new caller appears that can pass a non-Buffer, the
 * argument breaks and these tests fail.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Every package in the installed tree that declares bigint-buffer as a dependency. */
function packagesDependingOnBigintBuffer(): string[] {
  const lock = JSON.parse(read("package-lock.json")) as {
    packages?: Record<string, { dependencies?: Record<string, string> }>;
  };
  const out: string[] = [];
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (!path) continue; // the root project itself
    if (meta?.dependencies && "bigint-buffer" in meta.dependencies) out.push(path);
  }
  return out.sort();
}

describe("R-002 bigint-buffer exposure", () => {
  it("has exactly one package in the tree depending on bigint-buffer", () => {
    const dependents = packagesDependingOnBigintBuffer();
    assert.deepEqual(
      dependents,
      ["node_modules/@solana/buffer-layout-utils"],
      "a new dependent would break the single-caller reachability argument — re-evaluate R-002"
    );
  });

  it("reaches toBigIntLE only through a caller that wraps the argument in Buffer.from", () => {
    // This is the load-bearing claim: the CVE triggers on non-Buffer input, and the
    // only caller converts before calling. If this assertion fails, the vulnerability
    // may be reachable with attacker-influenced input.
    const src = read("node_modules/@solana/buffer-layout-utils/lib/cjs/bigint.js");
    assert.match(
      src,
      /toBigIntLE\)\(buffer_1\.Buffer\.from\(src\)\)/,
      "buffer-layout-utils must keep wrapping src in Buffer.from before toBigIntLE"
    );
  });

  it("does not call bigint-buffer from the application's own source", () => {
    for (const file of ["lib/solana.ts", "lib/payout.ts", "lib/wallet-verification.ts", "lib/actions.ts"]) {
      const src = read(file);
      assert.ok(!src.includes("bigint-buffer"), `${file} must not require bigint-buffer directly`);
    }
  });

  it("keeps the native addon out of the traced server bundle", () => {
    // Structural backstop: even if the argument above were ever bypassed, the
    // vulnerable native code is excluded from the deployment, so the safe pure-JS
    // fallback is what runs.
    const cfg = read("next.config.mjs");
    assert.match(cfg, /outputFileTracingExcludes/, "the tracing exclusion must remain configured");
    assert.match(
      cfg,
      /node_modules\/bigint-buffer\/build\/\*\*/,
      "the bigint-buffer native build directory must be excluded from tracing"
    );
  });
});
