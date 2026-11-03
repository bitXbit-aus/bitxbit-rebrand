import { NextResponse } from "next/server";

import { buildDeployVersion } from "@/lib/deploy-version";

/**
 * Which commit is deployed here — the control for R-019.
 *
 * A merge to `main` failed to reach production on 2026-10-27: Netlify skipped the
 * build (account build minutes exhausted) and nothing visible in CI or GitHub
 * said so. `main` had moved; production had not. A post-merge check can only
 * catch that by asking production what it is running, which is what this reports.
 *
 * Deliberately NOT a liveness endpoint — a monitor pointed here would read a
 * correct answer from a site that is failing in every other way. Pair it with a
 * real liveness probe if you need one.
 *
 * SAFE TO EXPOSE: the commit SHA of a public repository and the Netlify deploy
 * context. No credentials, no connection strings, no member data — see
 * lib/deploy-version.ts, and note the test that fails if anything credential-
 * shaped reaches the payload.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  // These reads are intentionally written as static `process.env.X` member
  // accesses: Next inlines them at BUILD time from the `env` block in
  // next.config.mjs. A dynamic lookup (`process.env[key]`) would not be inlined
  // and would silently report "unknown" in production instead of the commit —
  // which is precisely the class of silent failure this exists to catch.
  const version = buildDeployVersion({
    deployedCommit: process.env.DEPLOYED_COMMIT,
    runtimeCommit: process.env.COMMIT_REF,
    context: process.env.CONTEXT,
  });

  return NextResponse.json(version, {
    status: 200,
    headers: {
      // A cached answer would report a previous deployment's commit and make a
      // failed release look shipped.
      "cache-control": "no-store, max-age=0",
    },
  });
}
