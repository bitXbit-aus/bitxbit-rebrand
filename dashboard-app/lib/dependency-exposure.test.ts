import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
    //
    // Strengthened 2026-10-24 after independent review: asserting that the config
    // merely *mentions* an exclusion is configuration acceptance, not a control.
    // This now asserts that the configured pattern actually COVERS the real addon
    // path present in the installed tree, so the test fails if the glob or the
    // package layout drifts. The discriminating proof that the exclusion works —
    // and that the check can fail — is the two-build control in
    // `scripts/r002-trace-control.py` (see evidence/r002-trace-control-2026-10-24.md).
    const cfg = read("next.config.mjs");
    assert.match(cfg, /outputFileTracingExcludes/, "the tracing exclusion must remain configured");

    const literal = cfg.match(/BIGINT_BUFFER_NATIVE_EXCLUDE\s*=\s*\[([^\]]*)\]/);
    assert.ok(literal, "the exclusion pattern list must remain a literal array");
    const patterns = [...literal[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    assert.ok(patterns.length > 0, "the exclusion must contain at least one pattern");

    // Next 15 moved this option to the top level; nested under `experimental` it is
    // silently ignored. Assert the placement structurally rather than trusting a
    // build warning nobody reads.
    assert.ok(
      cfg.indexOf("outputFileTracingExcludes") < cfg.indexOf("experimental:"),
      "outputFileTracingExcludes must be top-level, not nested under experimental (Next 15)"
    );

    // The real artifact, not a guess about one.
    const addonRel = "node_modules/bigint-buffer/build/Release/bigint_buffer.node";
    assert.ok(existsSync(join(root, addonRel)), `expected the native addon at ${addonRel}`);

    const covered = patterns.some((pattern) => {
      const base = pattern.replace(/\/\*\*$/, "").replace(/\/\*$/, "");
      return addonRel === base || addonRel.startsWith(`${base}/`);
    });
    assert.ok(covered, `the exclusion ${JSON.stringify(patterns)} must cover ${addonRel}`);
  });
});
