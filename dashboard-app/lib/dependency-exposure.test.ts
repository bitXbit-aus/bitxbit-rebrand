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
    // silently ignored. The previous check compared source POSITIONS, which is
    // comment-sensitive: moving the real property under `experimental` still passed
    // while an earlier comment retained the option's name. This instead measures
    // the property's BRACE DEPTH inside the exported config object, so it is
    // unaffected by comments or ordering. (A dynamic import is not usable here:
    // this file compiles to CommonJS, where `import()` becomes `require()` and
    // cannot load an `.mjs`.)
    const clean = cfg
      .replace(/\/\*[\s\S]*?\*\//g, "")      // block comments
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments, but not `https://`
    const cfgStart = clean.search(/const\s+nextConfig\s*=\s*\{/);
    assert.ok(cfgStart >= 0, "the config must still export a `nextConfig` object literal");
    const objOpen = clean.indexOf("{", cfgStart);
    const optionAt = clean.search(/\boutputFileTracingExcludes\s*:/);
    assert.ok(optionAt > objOpen, "outputFileTracingExcludes must be configured inside nextConfig");

    let depth = 0;
    for (let i = objOpen; i < optionAt; i += 1) {
      if (clean[i] === "{") depth += 1;
      else if (clean[i] === "}") depth -= 1;
    }
    assert.equal(
      depth,
      1,
      "outputFileTracingExcludes must be a top-level property of nextConfig (depth 1) — " +
        "nested under `experimental` it is silently ignored by Next 15"
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

/**
 * Single React runtime — guards the wallet-adapter dependency narrowing.
 *
 * `@solana/wallet-adapter-wallets` is a barrel that bundles EVERY wallet,
 * including `@solana/wallet-adapter-fractal`, which pins a nested React 18 under
 * this React 19 application. Two React copies in one client bundle is a runtime
 * hazard (hooks resolved against the wrong dispatcher) that no type check can
 * see, and it is what the `as any` casts on the providers were papering over.
 * The app only uses Phantom, Solflare and Coinbase, so it imports those three
 * packages directly.
 *
 * These assert the INSTALLED tree (package-lock.json), not the source — a
 * re-introduced barrel dependency fails here even if no import mentions it.
 */
describe("single React runtime", () => {
  const lock = JSON.parse(read("package-lock.json")) as {
    packages?: Record<string, { version?: string; dependencies?: Record<string, string> }>;
  };
  const packages = lock.packages ?? {};

  const reactInstalls = Object.entries(packages).filter(
    ([path]) => path === "node_modules/react" || path.endsWith("/node_modules/react")
  );

  it("installs exactly one copy of react", () => {
    assert.deepEqual(
      reactInstalls.map(([path]) => path),
      ["node_modules/react"],
      "a nested react copy means two runtimes in one bundle — find which dependency pulled it in"
    );
  });

  it("resolves react to a single major version", () => {
    const majors = [...new Set(reactInstalls.map(([, meta]) => String(meta.version).split(".")[0]))];
    assert.deepEqual(majors, ["19"], "the app is React 19; a second major is a dual-subtree hazard");
  });

  it("does not install the Fractal wallet adapter", () => {
    const fractal = Object.keys(packages).filter((path) => path.toLowerCase().includes("fractal"));
    assert.deepEqual(fractal, [], "Fractal pins React 18 — it must not return to the tree");
  });

  it("does not depend on the wallet-adapter-wallets barrel", () => {
    const rootDeps = packages[""]?.dependencies ?? {};
    assert.ok(
      !("@solana/wallet-adapter-wallets" in rootDeps),
      "import the specific adapters (phantom/solflare/coinbase) instead of the barrel that bundles every wallet"
    );
  });
});
