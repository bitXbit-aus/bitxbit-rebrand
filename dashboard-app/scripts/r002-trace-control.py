#!/usr/bin/env python3
"""
R-002 discriminating control — does `outputFileTracingExcludes` actually keep
bigint-buffer's vulnerable native addon out of the traced server bundle?

WHY THIS EXISTS
---------------
The previously recorded evidence ("0 `.node` files under `.next`") is
NON-DISCRIMINATING. Measured 2026-10-24: that count is 0 with the exclusion ON
*and* OFF, because nothing in the default traced server graph reaches the addon.
A check that cannot fail is not a control — this was the top structural finding
from both independent reviewers.

METHOD — two builds of the same code with one synthetic traceable import
-----------------------------------------------------------------------
  A. exclusion ON  -> the addon must be ABSENT from every `.nft.json` trace
  B. exclusion OFF -> the addon must be PRESENT in the traces

Interpretation is strict, so the control cannot pass vacuously:
  * B does not show the addon  -> the fixture never reached the tracer, so the
                                  run is INCONCLUSIVE (exit 2), not passing;
  * A shows the addon          -> the exclusion does not work (exit 1).

The discriminator is the CONTENT of the `.nft.json` traces, never a physical
count of `.node` files under `.next`.

The repository is restored on every exit path (the working tree must be clean
before and after).

Usage:  python3 scripts/r002-trace-control.py
Exit:   0 proven discriminating and effective | 1 exclusion ineffective
        2 inconclusive (fixture not traced)     | 3 setup problem
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent
PROBE = APP / "app" / "__r002probe" / "route.ts"
CONFIG = APP / "next.config.mjs"
ADDON = "node_modules/bigint-buffer/build/Release/bigint_buffer.node"

PROBE_SOURCE = '''import { toBigIntLE } from "bigint-buffer";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: typeof toBigIntLE === "function" });
}
'''

BUILD_ENV = {
    "NEXT_PUBLIC_SUPABASE_URL": "https://dummy.supabase.co",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "dummy",
    "SUPABASE_SERVICE_ROLE_KEY": "dummy",
    "NEXT_PUBLIC_APP_URL": "http://localhost:3000",
    "BITXBIT_TOKEN_MINT": "DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5",
    "BITXBIT_TOKEN_DECIMALS": "9",
    "AIRDROP_WALLET_PRIVATE_KEY": "dummy",
    "BIRDEYE_API_KEY": "dummy",
    "RESEND_API_KEY": "dummy",
    "ANTHROPIC_API_KEY": "dummy",
}


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=APP, capture_output=True, text=True, check=True
    ).stdout


def traces_naming(pattern: str) -> int:
    """Count `.nft.json` entries naming `pattern` (the real discriminator)."""
    hits = 0
    for nft in (APP / ".next").rglob("*.nft.json"):
        try:
            hits += len(re.findall(pattern, nft.read_text(errors="ignore")))
        except OSError:
            pass
    return hits


def build(label: str, exclusion: str) -> None:
    shutil.rmtree(APP / ".next", ignore_errors=True)
    env = {**os.environ, **BUILD_ENV, "R002_EXCLUDE": exclusion}
    log = Path(os.environ.get("TMPDIR", "/tmp")) / f"r002-trace-{label}.log"
    with log.open("w") as fh:
        proc = subprocess.run(
            ["npm", "run", "build"], cwd=APP, env=env, stdout=fh, stderr=subprocess.STDOUT
        )
    if proc.returncode != 0:
        print(f"  build [{label}] FAILED (exit {proc.returncode}) — see {log}")
        tail = log.read_text(errors="ignore").splitlines()[-15:]
        print("\n".join(f"    {ln}" for ln in tail))
        sys.exit(3)
    print(f"  build [{label}] ok (exclusion={exclusion})")


def main() -> int:
    if git("status", "--porcelain").strip():
        print("REFUSING: working tree is dirty — commit or stash first.")
        return 3

    original = CONFIG.read_text()
    if not (APP / ADDON).exists():
        print(f"REFUSING: {ADDON} is not present in the installed tree.")
        return 3

    try:
        PROBE.parent.mkdir(parents=True, exist_ok=True)
        PROBE.write_text(PROBE_SOURCE)

        cfg = original
        # Make the package external so the import stays a real runtime require,
        # and make the exclusion switchable so ONE config serves both builds.
        cfg = cfg.replace(
            "const nextConfig = {\n  reactStrictMode: true,",
            "const nextConfig = {\n  reactStrictMode: true,\n  serverExternalPackages: ['bigint-buffer'],",
            1,
        )
        cfg = cfg.replace(
            "  outputFileTracingExcludes: {\n    '*': BIGINT_BUFFER_NATIVE_EXCLUDE,\n  },",
            "  ...(process.env.R002_EXCLUDE === '0' ? {} : { outputFileTracingExcludes: "
            "{ '*': BIGINT_BUFFER_NATIVE_EXCLUDE } }),",
            1,
        )
        if "R002_EXCLUDE" not in cfg or "serverExternalPackages" not in cfg:
            print("REFUSING: could not instrument next.config.mjs — its shape changed.")
            return 3
        CONFIG.write_text(cfg)

        print("R-002 tracing control — synthetic traceable import of bigint-buffer\n")
        build("on", "1")
        on_addon = traces_naming(r"bigint_buffer\.node")
        on_build = traces_naming(r"bigint-buffer/build")
        print(f"  exclusion ON : trace entries naming bigint_buffer.node = {on_addon}, "
              f"bigint-buffer/build = {on_build}")

        build("off", "0")
        off_addon = traces_naming(r"bigint_buffer\.node")
        off_build = traces_naming(r"bigint-buffer/build")
        print(f"  exclusion OFF: trace entries naming bigint_buffer.node = {off_addon}, "
              f"bigint-buffer/build = {off_build}\n")

        if off_addon == 0 and off_build == 0:
            print("INCONCLUSIVE: with the exclusion OFF the addon still is not traced, so the")
            print("fixture never reached the tracer. This proves nothing either way — do not")
            print("record it as a passing control. Fix the fixture before trusting the check.")
            return 2
        if on_addon or on_build:
            print("FAIL: the addon is traced even with the exclusion ON — the control is INEFFECTIVE.")
            return 1
        print("PASS: the addon is traced without the exclusion and absent with it.")
        print("The exclusion is effective AND the check is capable of failing.")
        return 0
    finally:
        shutil.rmtree(APP / "app" / "__r002probe", ignore_errors=True)
        CONFIG.write_text(original)
        dirty = git("status", "--porcelain").strip()
        print(f"\n[restored] working tree {'clean' if not dirty else 'DIRTY: ' + dirty}")


if __name__ == "__main__":
    sys.exit(main())
