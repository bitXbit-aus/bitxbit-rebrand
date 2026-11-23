import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Background, because these assertions look arbitrary without it.
//
// R-019: a merge to `main` did not reach production. Netlify skipped the build
// (account build minutes exhausted) and the only record was on the deploy itself,
// which GitHub never sees for a merge commit. CI was green; `main` had moved;
// production had not. Nothing in the repository could tell "released" from "not
// released".
//
// The control is deliberately indirect: it does not ask the deploy platform
// whether it tried, it asks PRODUCTION WHAT IT IS RUNNING, via
// GET https://app.bitxbit.com.au/api/version. That answer comes from the built
// artifact (the commit is inlined at build time — see next.config.mjs), so a
// deployment that never built cannot produce it.
//
// Three properties make that work, and each can be broken silently, which is why
// they are asserted here rather than described in a comment:
//
//   1. The endpoint's answer must originate at BUILD time. If `next.config.mjs`
//      stops inlining COMMIT_REF, or the route stops reading the inlined
//      variable, the endpoint reports null forever — and the check can never
//      confirm a release. (It fails loudly rather than passing, but only if the
//      comparison is exact; see 3.)
//   2. "Ship-able" must mean the same thing to the control as it does to the
//      ignore rules in netlify.toml. If they disagree, the control either demands
//      a deploy that will never happen or accepts one that never shipped.
//   3. The comparison must be exact equality against the commit. Any looser test
//      (a substring, a truthiness check) would let a null or stale answer read as
//      "released" — which is the exact failure this control exists to catch.

const APP_ROOT = join(__dirname, "..");
const REPO_ROOT = join(APP_ROOT, "..");

const workflow = readFileSync(
  join(REPO_ROOT, ".github", "workflows", "production-release-verification.yml"),
  "utf8"
);
const versionRoute = readFileSync(join(APP_ROOT, "app", "api", "version", "route.ts"), "utf8");
const nextConfig = readFileSync(join(APP_ROOT, "next.config.mjs"), "utf8");
const dashboardToml = readFileSync(join(APP_ROOT, "netlify.toml"), "utf8");

const DOCS_EXCLUSION = ":(exclude)dashboard-app/docs";

// --- 1. The answer comes from the build, not from an intention ----------------------

test("the deployed commit is inlined at build time", () => {
  assert.match(
    nextConfig,
    /DEPLOYED_COMMIT:\s*process\.env\.COMMIT_REF/,
    "next.config.mjs must inline COMMIT_REF as DEPLOYED_COMMIT: Netlify documents COMMIT_REF " +
      "as a BUILD-time variable, so a request-time read cannot be relied on to find it"
  );
  assert.match(
    versionRoute,
    /deployedCommit:\s*process\.env\.DEPLOYED_COMMIT/,
    "the route must read process.env.DEPLOYED_COMMIT as a static member access. A dynamic " +
      "lookup (process.env[key]) is NOT inlined by Next and would report null forever"
  );
});

test("the version endpoint is uncacheable", () => {
  assert.match(
    versionRoute,
    /no-store/,
    "a cached answer reports a previous deployment's commit and makes a failed release look shipped"
  );
  assert.match(versionRoute, /force-dynamic/, "the route must not be statically evaluated");
});

// --- 2. "Ship-able" means the same thing here as in the ignore rules ----------------

test("the control and the ignore rule agree on what is ship-able", () => {
  assert.ok(
    dashboardToml.includes(DOCS_EXCLUSION),
    "sanity: netlify.toml no longer excludes dashboard-app/docs"
  );
  const occurrences = workflow.split(DOCS_EXCLUSION).length - 1;
  assert.ok(
    occurrences >= 1,
    "the verification workflow must scope 'ship-able' exactly as the Netlify ignore rule does " +
      `(${DOCS_EXCLUSION}). If they disagree, the control demands a deploy that will never ` +
      "happen, or accepts one that never shipped."
  );
});

// --- 3. It is an exact comparison, and it fails loudly ------------------------------

test("the release check compares the full commit and fails when it does not match", () => {
  assert.match(
    workflow,
    /\[\s*"\$served"\s*=\s*"\$SHA"\s*\]/,
    "the merged SHA must be compared with exact string equality - a substring or truthiness " +
      "test would let null or a stale commit read as 'released'"
  );
  assert.ok(
    /exit 1/.test(workflow) && /::error::/.test(workflow),
    "a release that did not reach production must FAIL the run, not warn"
  );
  assert.match(
    workflow,
    /Retry the deploy in Netlify/,
    "the failure must name the resolution path - retrying the skipped deploy - because merging " +
      "more releases cannot fix it"
  );
});

test("the post-merge job verifies the SHA that was merged", () => {
  assert.match(workflow, /SHA:\s*\$\{\{\s*github\.sha\s*\}\}/, "the pushed SHA must be the expectation");
  assert.match(
    workflow,
    /git diff --quiet HEAD\^ HEAD -- dashboard-app/,
    "the post-merge job must decide whether the merge needed a deploy at all, using the merge " +
      "commit against its first parent"
  );
  assert.match(
    workflow,
    /"\$NEEDS_DEPLOY"\s*!=\s*"true"/,
    "a merge that changed nothing ship-able must not be reported as a missed release"
  );
});

test("the PR job is the one that can be made required", () => {
  assert.match(
    workflow,
    /production-is-serving-main/,
    "the PR job exists to be added as a required check: it refuses more releases while main's " +
      "newest ship-able commit is not live"
  );
  assert.match(
    workflow,
    /git rev-list --first-parent/,
    "the PR job must walk main's FIRST-PARENT history to find the newest ship-able commit. " +
      "`git log -1 -- <path>` silently returns an older commit on merge-heavy history: default " +
      "simplification omits a merge commit that is TREESAME to one parent for those paths, which " +
      "made the check poll for a commit production could never serve"
  );
  assert.ok(
    !/git log -1 --format=%H FETCH_HEAD -- dashboard-app/.test(workflow),
    "the simplification-prone selector must not come back"
  );
  assert.match(
    workflow,
    /pull_request:\s*\n\s*branches:\s*\[main\]/,
    "the PR job must trigger on pull requests into main"
  );
});

test("a missing endpoint is bootstrap-tolerated, and can be made strict", () => {
  assert.match(
    workflow,
    /VERSION_ENDPOINT_REQUIRED/,
    "an explicit switch must control whether a missing endpoint is fatal: the endpoint cannot " +
      "exist before its own deploy, so the first run has to tolerate it"
  );
  assert.match(
    workflow,
    /ENDPOINT_REQUIRED[\s\S]{0,60}?=\s*"true"[\s\S]{0,400}?exit 1/,
    "when the switch is on, a missing endpoint must FAIL - otherwise deleting the route would " +
      "silently disable the release control"
  );
  assert.match(
    workflow,
    /::warning::/,
    "the bootstrap case must be visible as a warning rather than a silent pass"
  );
});

// --- 4. The release also proves the app tells members the right host ----------------
//
// R-018 regression, 2026-11-22: closing two dependency advisories required bumping
// next to 15.5.29, which changed how `request.url` is derived — it follows
// `x-forwarded-host`, and on Netlify that header is the DEPLOY'S OWN PERMALINK. The
// permalink matches this site's slug in HOST_POLICY, so isAllowedHost() accepted it
// and it BEAT the canonical URL: production began asking members to sign for
// https://6b0361…--bitxbit-dashboard.netlify.app, and the magic-link callback would
// have redirected them there after login.
//
// The deployed wallet harness could not catch it, and structurally could not: it runs
// against PREVIEWS, where the `host` header and the forwarded host coincide, so its
// host assertions are blind to this. Nothing asserted PRODUCTION's Site: line.
//
// Each property below can be broken silently, which is why it is asserted here.

function readCanonicalHost(): string {
  const src = readFileSync(join(APP_ROOT, "lib", "auth-callback-url.ts"), "utf8");
  const m = /FALLBACK_SIGNIN_DOMAIN\s*=\s*"([^"]+)"/.exec(src);
  if (!m) {
    throw new Error("sanity: FALLBACK_SIGNIN_DOMAIN is no longer declared as a string literal");
  }
  return m[1];
}

const canonicalHost = readCanonicalHost();

const hostStepStart = workflow.indexOf("Verify production advertises its own host");
const hostStepEnd = workflow.indexOf("production-is-serving-main:");
const hostStep =
  hostStepStart >= 0
    ? workflow.slice(hostStepStart, hostStepEnd > hostStepStart ? hostStepEnd : undefined)
    : "";

test("the release verification asks production what host it advertises", () => {
  assert.ok(
    hostStep.length > 0,
    "the post-merge job must verify the host production tells members to sign for. Without it, a " +
      "framework bump can rewrite every user-facing origin and the only harness that runs is the " +
      "preview one, which cannot see it."
  );
  assert.match(hostStep, /wallet\/challenge/, "the check must ask the live challenge endpoint");
  assert.ok(
    hostStep.includes("Site:"),
    "it must read the Site: line specifically - that line is the only thing a wallet shows the " +
      "member about what they are authorising"
  );
});

test("the expected host is the app's own canonical host, so the two cannot drift", () => {
  assert.ok(
    hostStep.includes(canonicalHost),
    `the workflow must expect the app's canonical host (${canonicalHost}). If the two drift, the ` +
      "control either demands a host the app will never use, or accepts one it should not."
  );
});

test("the advertised host is compared exactly, and a mismatch fails the run", () => {
  assert.match(
    hostStep,
    /\[\s*"\$site"\s*=\s*"\$EXPECTED_SITE"\s*\]/,
    "exact equality is required: a substring or truthiness test would accept a permalink that " +
      "merely CONTAINS the canonical host, which is precisely the broken value"
  );
  assert.ok(
    /exit 1/.test(hostStep),
    "an advertisement that is not this site must FAIL the run, not warn"
  );
  assert.match(hostStep, /::error::/, "the failure must be surfaced as an error annotation");
});

test("the host check names the permalink regression it exists to catch", () => {
  assert.ok(
    /--bitxbit-dashboard\\?\.netlify\\?\.app/.test(hostStep),
    "the failure must recognise the Netlify per-deploy permalink specifically. That is the exact " +
      "value the regression produced, and naming it is what tells the next person what broke."
  );
});

test("the host probe is inert and needs no member's address", () => {
  assert.ok(
    hostStep.includes("11111111111111111111111111111111"),
    "the probe must use a placeholder address: it mints a challenge without touching any member's " +
      "wallet, and never a real one"
  );
  assert.match(
    hostStep,
    /no signature is produced and nothing is enrolled/i,
    "the probe's harmlessness must be stated, so nobody 'improves' it into a real signing flow"
  );
  assert.match(
    hostStep,
    /HOST_MAX_ATTEMPTS/,
    "attempts must be bounded by an explicit budget that stays inside the endpoint's rate limit " +
      "(10 per 60s) - otherwise the check can fail ITSELF with a 429 and read as a real finding"
  );
});
