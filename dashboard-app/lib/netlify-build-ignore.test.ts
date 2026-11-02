import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Background, because these assertions look arbitrary without it.
//
// The Netlify account carries ONE build-minute quota shared by both sites. On
// 2026-10-27 it ran out, and a production deploy reported
//
//   "Skipped due to account builds usage exceeded"
//
// while CI stayed green — so `main` moved and production did not. The waste that
// got us there was structural: the security documentation lives INSIDE the app
// (dashboard-app/docs/**), so a docs-only merge was a real content change to
// Netlify and cost a full Next build, and every dashboard commit also rebuilt the
// marketing site.
//
// The fix is a `[build] ignore` command in each site's netlify.toml. Two things
// about it are easy to get wrong, and both are asserted below:
//
//   1. EXIT-CODE POLARITY. Netlify SKIPS the build when the command exits 0 and
//      BUILDS when it exits non-zero. The command must therefore be true when
//      there is nothing to build. An inverted command does not fail loudly — it
//      silently skips REAL deploys, which is the more dangerous direction.
//   2. THE PATHSPEC. The command must name the app directory explicitly rather
//      than a bare `.`, because it has to mean the same thing whether Netlify runs
//      it from the repo root or from the site's base directory. A bare `.` under a
//      repo-root cwd matches the whole monorepo, so the docs change this is
//      supposed to ignore still counts and nothing is saved.
//
// These are structural checks on config, not a behavioural test: the authoritative
// proof is the exit codes measured against real refs (see
// docs/security/evidence/netlify-build-ignore-2026-10-27.md).

const APP_ROOT = join(__dirname, "..");
const REPO_ROOT = join(APP_ROOT, "..");

const dashboardToml = readFileSync(join(APP_ROOT, "netlify.toml"), "utf8");
const marketingToml = readFileSync(join(REPO_ROOT, "webflow-site", "netlify.toml"), "utf8");
const smokeWorkflow = readFileSync(
  join(REPO_ROOT, ".github", "workflows", "dashboard-browser-smoke.yml"),
  "utf8"
);

/** Pull the `ignore = "..."` value out of a TOML document. */
function ignoreCommand(toml: string, label: string): string {
  const m = toml.match(/^\s*ignore\s*=\s*"(.*)"\s*$/m);
  assert.ok(m, `${label}: no [build] ignore command found — the build quota guard is gone`);
  // The TOML basic string escapes its inner double quotes; unescape so the
  // assertions below reason about the command Netlify actually runs.
  return m![1].replace(/\\"/g, '"');
}

/** The refs-equal guard, without which manual deploys are skipped as "no changes". */
function hasManualDeployGuard(command: string): boolean {
  return /test\s+"\$CACHED_COMMIT_REF"\s*!=\s*"\$COMMIT_REF"/.test(command);
}

// --- The dashboard site -------------------------------------------------------------

const dashboardIgnore = ignoreCommand(dashboardToml, "dashboard-app/netlify.toml");

test("the dashboard skip command is keyed on the refs Netlify provides", () => {
  assert.ok(
    dashboardIgnore.includes("$CACHED_COMMIT_REF") && dashboardIgnore.includes("$COMMIT_REF"),
    "the ignore command must compare CACHED_COMMIT_REF against COMMIT_REF"
  );
  assert.ok(
    /git diff --quiet/.test(dashboardIgnore),
    "the ignore command must use `git diff --quiet`: exit 0 (skip) exactly when nothing changed. " +
      "Inverting this polarity silently skips real deploys."
  );
  assert.ok(
    !/!\s*git diff/.test(dashboardIgnore),
    "the ignore command must not negate `git diff`: `! git diff --quiet` exits 0 when something DID " +
      "change, which inverts the whole rule and silently cancels real deploys"
  );
});

test("a docs-only change must NOT trigger an app build", () => {
  assert.ok(
    /:\(exclude\)dashboard-app\/docs/.test(dashboardIgnore),
    "dashboard-app/docs must be excluded from the ignore command: the security documentation lives " +
      "inside the app, and without this exclusion a docs-only merge costs a full Next build again"
  );
});

test("the reply on pathspecs is cwd-independent", () => {
  assert.ok(
    dashboardIgnore.includes("dashboard-app"),
    "the ignore command must name the app directory explicitly"
  );
  assert.ok(
    !/--\s+\.\s*(?:'|"|\|)/.test(dashboardIgnore) && !/--\s+\.\s*$/.test(dashboardIgnore),
    "the ignore command must not use a bare `.` pathspec - under a repo-root cwd that matches the " +
      "whole monorepo, so the docs change it exists to ignore would count again"
  );
  assert.ok(
    /git rev-parse --show-toplevel/.test(dashboardIgnore),
    "resolve the repo root explicitly so the pathspec means the same thing in base cwd and repo-root cwd"
  );
});

test("manual and cleared-cache deploys still build", () => {
  assert.ok(
    hasManualDeployGuard(dashboardIgnore),
    "without the `test \"$CACHED_COMMIT_REF\" != \"$COMMIT_REF\"` guard, a manual or clear-cache " +
      "deploy runs with both refs equal, diffs as 'no changes', and is skipped"
  );
});

// --- The marketing site -------------------------------------------------------------

const marketingIgnore = ignoreCommand(marketingToml, "webflow-site/netlify.toml");

test("the marketing site only builds when its own files change", () => {
  assert.ok(
    marketingIgnore.includes("webflow-site"),
    "the marketing ignore command must be scoped to webflow-site so dashboard commits stop " +
      "rebuilding it"
  );
  assert.ok(
    !marketingIgnore.includes("dashboard-app"),
    "the marketing site's skip command must not key off dashboard-app: the sites share one quota, " +
      "and a dashboard-only change must not consume a marketing build"
  );
  assert.ok(/git diff --quiet/.test(marketingIgnore), "same exit-code polarity as the dashboard site");
  assert.ok(hasManualDeployGuard(marketingIgnore), "same manual-deploy guard as the dashboard site");
});

// --- The browser smoke job must not fail merely because no preview exists -----------

test("the smoke suite is gated on the dashboard actually changing", () => {
  assert.ok(
    /app_changed/.test(smokeWorkflow),
    "the workflow must compute whether the dashboard changed: a skipped Netlify build means no " +
      "deploy preview, and the job would otherwise wait 20 minutes and fail for the wrong reason"
  );
  assert.ok(
    /:\(exclude\)dashboard-app\/docs/.test(smokeWorkflow),
    "the workflow's change detection must exclude dashboard-app/docs, matching the Netlify ignore " +
      "rule - otherwise the two disagree about whether a build is expected"
  );
  assert.ok(
    /needs:\s*changes/.test(smokeWorkflow) &&
      /needs\.changes\.outputs\.app_changed\s*==\s*'true'/.test(smokeWorkflow),
    "the browser-smoke job must depend on the change detection and run only when the app changed"
  );
});
