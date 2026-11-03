/**
 * Which commit is this deployment actually running? — R-019's control.
 *
 * WHY THIS EXISTS
 * On 2026-10-27 a merge to `main` did not reach production: Netlify skipped the
 * build ("Skipped due to account builds usage exceeded") and reported it only on
 * the deploy record, which GitHub never sees for merge commits. CI was green,
 * `main` had moved, and production was still serving the previous commit. Nothing
 * in the repository could tell "released" from "not released" — the failure was
 * invisible from the outside.
 *
 * The only honest way to answer "did that merge ship?" is to ask production what
 * it is running. This module turns the deployment's own commit reference into a
 * value the app can report, so a post-merge check can compare it against the SHA
 * that was merged.
 *
 * WHY IT IS READ THIS WAY
 * `process.env.DEPLOYED_COMMIT` is inlined by Next at BUILD time (see the `env`
 * block in next.config.mjs). That matters: Netlify documents `COMMIT_REF` as
 * available *during the build*, and a request-time env read cannot be relied on
 * to find it in the running function. The value is therefore captured when the
 * artifact is built — which is exactly the claim being verified, since a build
 * that never ran would never have set it.
 *
 * The `runtimeCommit` fallback covers the case where the platform does supply it
 * at request time; it is a fallback, not the primary source.
 *
 * SAFE TO EXPOSE: a commit SHA of a public repository, plus the deploy context.
 * No credentials, no connection strings, no member data. It deliberately reports
 * nothing else.
 */

export type DeployEnv = {
  /** Inlined at build time from COMMIT_REF (next.config.mjs `env`). */
  deployedCommit?: string;
  /** Request-time COMMIT_REF, if the platform provides it in the function. */
  runtimeCommit?: string;
  /** Netlify deploy context: production | deploy-preview | branch-deploy. */
  context?: string;
};

export type DeployVersion = {
  deployedCommit: string | null;
  context: string | null;
  production: boolean;
};

// A build with no commit reference is a real state (a local `next build`), and it
// must be reported as unknown rather than as some placeholder that happens to be
// truthy — a control that cannot distinguish "unknown" from "known" is the defect
// this whole register entry is about.
const UNKNOWN_VALUES = new Set(["", "unknown", "undefined", "null", "none"]);

function clean(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || UNKNOWN_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/** The commit this deployment was built from, or null when it cannot be known. */
export function resolveDeployedCommit(env: DeployEnv): string | null {
  return clean(env.deployedCommit) ?? clean(env.runtimeCommit);
}

export function buildDeployVersion(env: DeployEnv): DeployVersion {
  const context = clean(env.context);
  return {
    deployedCommit: resolveDeployedCommit(env),
    context,
    production: context === "production",
  };
}
