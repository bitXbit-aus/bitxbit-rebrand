import assert from "node:assert/strict";
import test from "node:test";

import { buildDeployVersion, resolveDeployedCommit } from "./deploy-version";

// Background, because these assertions look arbitrary without it.
//
// On 2026-10-27 a merge to `main` never reached production — Netlify skipped the
// build (account build minutes exhausted) and the failure was invisible from CI.
// The control for that is a post-merge check comparing the SHA that was merged
// against what production reports it is running.
//
// Which means this module's failure mode is not an exception: it is *reporting a
// commit when it does not actually know one*. A placeholder that happens to be
// truthy ("unknown", "undefined", an empty string from an unset build variable)
// would make the check compare a merged SHA against a string that will never
// match — or worse, be mistaken for a real deployment. So the assertions below
// are mostly about what this returns for values that mean "no answer".

test("returns the commit reference when the build provided one", () => {
  assert.equal(resolveDeployedCommit({ deployedCommit: "82ddc0f95aa07385e4eb8affb063f810b055b94f" }),
    "82ddc0f95aa07385e4eb8affb063f810b055b94f");
});

test("trims surrounding whitespace", () => {
  assert.equal(resolveDeployedCommit({ deployedCommit: "  abc123  " }), "abc123");
});

test("reports null — not a placeholder — when the build had no commit reference", () => {
  // The exact strings a shell or a template can leave behind. Each of these is
  // truthy or near-truthy in JavaScript, and none is a commit.
  for (const value of ["", "   ", "unknown", "UNKNOWN", "undefined", "null", "none"]) {
    assert.equal(
      resolveDeployedCommit({ deployedCommit: value }),
      null,
      `${JSON.stringify(value)} must resolve to null: a truthy placeholder makes the ` +
        "post-merge control compare against a value that can never match the merged SHA"
    );
  }
  assert.equal(resolveDeployedCommit({}), null, "an absent variable must resolve to null");
});

test("prefers the build-time value and falls back to a runtime one", () => {
  assert.equal(
    resolveDeployedCommit({ deployedCommit: "built111", runtimeCommit: "runtime222" }),
    "built111",
    "the build-time value is the claim being verified and must win"
  );
  assert.equal(
    resolveDeployedCommit({ runtimeCommit: "runtime222" }),
    "runtime222",
    "the runtime value is a fallback when the build did not inline one"
  );
  assert.equal(
    resolveDeployedCommit({ deployedCommit: "unknown", runtimeCommit: "runtime222" }),
    "runtime222",
    "an unusable build-time value must not block a usable fallback"
  );
});

test("reports the deploy context and whether this is production", () => {
  const prod = buildDeployVersion({ deployedCommit: "abc123", context: "production" });
  assert.equal(prod.production, true);
  assert.equal(prod.context, "production");

  const preview = buildDeployVersion({ deployedCommit: "abc123", context: "deploy-preview" });
  assert.equal(preview.production, false);
  assert.equal(preview.context, "deploy-preview");

  // An absent context must not read as production: the check that compares
  // production's SHA must never be satisfied by a preview's answer.
  assert.equal(buildDeployVersion({ deployedCommit: "abc123" }).production, false);
});

test("exposes nothing beyond the commit and the context", () => {
  const payload = buildDeployVersion({
    deployedCommit: "abc123",
    context: "production",
    // @ts-expect-error — deliberately passing extra keys to prove they are dropped
    SUPABASE_SERVICE_ROLE_KEY: "secret-value",
    AIRDROP_WALLET_PRIVATE_KEY: "secret-value",
  });
  const serialized = JSON.stringify(payload);

  assert.deepEqual(Object.keys(payload).sort(), ["context", "deployedCommit", "production"]);
  assert.ok(
    !/key|secret|token|password|credential|private/i.test(serialized),
    `the version payload must not carry anything credential-shaped: ${serialized}`
  );
  assert.ok(
    !serialized.includes("secret-value"),
    "extra environment keys must not reach the response"
  );
});
