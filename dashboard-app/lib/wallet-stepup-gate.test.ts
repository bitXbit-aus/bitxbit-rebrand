import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { submitWalletSignIn, submitWalletStepUp } from "./wallet-signin-client";

/**
 * The gate's contract, asserted structurally.
 *
 * The security property is an ORDERING one: no session may be minted on a path that
 * has not passed the device-trust decision. Ordering is exactly the kind of thing a
 * well-meaning refactor can invert while every behavioural test still passes — so it
 * is asserted here, in the source, and mutation-tested by reintroducing the defect.
 *
 * A gate no test can see is decorative.
 */

const APP_ROOT = join(__dirname, "..");
const verifyRoute = readFileSync(
  join(APP_ROOT, "app", "api", "auth", "wallet", "verify", "route.ts"),
  "utf8"
);
const stepUpRoute = readFileSync(
  join(APP_ROOT, "app", "api", "auth", "wallet", "step-up", "route.ts"),
  "utf8"
);

const idx = (src: string, needle: string) => {
  const at = src.indexOf(needle);
  assert.notEqual(at, -1, `expected to find ${JSON.stringify(needle)}`);
  return at;
};

// ------------------------------------------------------- the ordering property

test("the device-trust decision happens, and it reads the device cookie", () => {
  assert.match(verifyRoute, /cookies\(\)/, "the route must read the presented device");
  assert.match(verifyRoute, /DEVICE_COOKIE/, "…by its cookie name");
  assert.match(verifyRoute, /let deviceTrusted = false;/, "and must default to untrusted");
  assert.match(
    verifyRoute,
    /\.is\("revoked_at", null\)/,
    "a revoked device must not count as trusted"
  );
  assert.match(
    verifyRoute,
    /\.gt\("last_seen_at", cutoff\)/,
    "and a stale one must not either — the cookie is a bearer value"
  );
});

test("NO session is minted before the gate has been passed", () => {
  // The whole feature in one assertion. `generateLink` then `verifyOtp` is what mints
  // a session; both must sit strictly AFTER the untrusted branch has returned.
  const gateAt = idx(verifyRoute, "if (!deviceTrusted) {");
  const gatedReturn = idx(verifyRoute, "stepUpRequired: true");
  const mintAt = idx(verifyRoute, "admin.auth.admin.generateLink(");
  // The CALL, not the prose: the route's own header comment contains
  // `verifyOtp({ token_hash })`, so matching the bare name points into a comment and
  // the ordering assertion passes for the wrong reason.
  const otpAt = idx(verifyRoute, "supabase.auth.verifyOtp({");

  assert.ok(gateAt < gatedReturn, "the untrusted branch must return the step-up state");
  assert.ok(
    gatedReturn < mintAt,
    "the step-up return must come BEFORE the session mint — inverting this restores the relay"
  );

  // The difference between a gate that exists and a gate that enforces: listing the
  // condition and falling through mints a session anyway. Asserting only that the
  // words are present would pass for `if (false && !deviceTrusted)` and for a branch
  // whose return was changed to a no-op.
  const gatedReturnStatement = idx(verifyRoute, "return withAuthNoStore(gated);");
  assert.ok(
    gatedReturnStatement < mintAt,
    "the step-up state must actually be RETURNED before the mint — falling through still mints"
  );
  assert.ok(mintAt < otpAt, "and the mint is generateLink then verifyOtp, as before");
  assert.equal(
    (verifyRoute.match(/admin\.auth\.admin\.generateLink\(/g) ?? []).length,
    1,
    "exactly one mint exists, so there is no second path around the gate"
  );
});

test("an untrusted device cannot mint even when the step-up cannot proceed", () => {
  // Both failure paths inside the gate must RETURN rather than fall through.
  const gatedReturn = idx(verifyRoute, "stepUpRequired: true");
  const keyGuard = idx(verifyRoute, "reason: \"no_step_up_key\"");
  const sendGuard = idx(verifyRoute, "if (!delivered.sent) {");

  assert.ok(keyGuard < gatedReturn, "a missing signing key must refuse before anything else");
  assert.ok(sendGuard < gatedReturn, "and an undeliverable code must refuse, not fall through");
  assert.match(
    verifyRoute,
    /no_step_up_key[\s\S]{0,400}return withAuthNoStore/,
    "the key guard must actually return — fail closed, never through"
  );
  assert.match(
    verifyRoute,
    /if \(!delivered\.sent\)[\s\S]{0,900}return withAuthNoStore/,
    "an undeliverable code must return, not continue to the mint"
  );
});

test("the step-up branch issues a device handle but grants no trust by doing so", () => {
  // The handle is opaque and the trust row is written only on completion, so issuing
  // it here cannot be mistaken for trust.
  assert.match(verifyRoute, /const deviceId = presentedDeviceId \|\| newDeviceId\(\);/, "a handle is minted");
  assert.equal(
    /newDeviceId\(\)[\s\S]{0,200}trust_wallet_device/.test(verifyRoute),
    false,
    "trust must NOT be granted on the verify path — only on a completed step-up"
  );
});

// ------------------------------------------------------- the step-up endpoint

test("the step-up endpoint mints only after an accepted code", () => {
  const statusAt = idx(stepUpRoute, 'if (status !== "ok")');
  const userAt = idx(stepUpRoute, "result.user_id");
  const mintAt = idx(stepUpRoute, "admin.auth.admin.generateLink(");

  assert.ok(statusAt < userAt, "the status must be checked before the account is trusted");
  assert.ok(
    statusAt < mintAt,
    "and before the session mint — a rejected code must never reach it"
  );
  assert.equal(
    (stepUpRoute.match(/admin\.auth\.admin\.generateLink\(/g) ?? []).length,
    1,
    "exactly one mint in the completion path"
  );
});

test("the step-up endpoint fails closed on a missing key and rejects malformed input first", () => {
  assert.match(stepUpRoute, /reason: "no_step_up_key"[\s\S]{0,300}status: 503/, "no key must refuse");
  assert.match(stepUpRoute, /if \(!key\) \{/, "the key check must gate the RPC call");
  assert.match(
    stepUpRoute,
    /if \(!\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(stepUpId\) \|\| !\/\^\\d\{6\}\$\/\.test\(code\)\)/,
    "the id and code shapes are checked before the RPC"
  );
});

test("trust is granted against the browser that COMPLETED the step-up", () => {
  // Not the one that requested it. This is what stops an attacker who initiated a
  // step-up from earning trust for their own browser.
  const completeAt = idx(stepUpRoute, 'if (status !== "ok")');
  const trustAt = idx(stepUpRoute, "trust_wallet_device");
  assert.ok(completeAt < trustAt, "trust must follow a completed code, never precede it");
  assert.match(stepUpRoute, /response\.cookies\.set\(DEVICE_COOKIE, deviceId/, "the handle is set on success");
});

test("every rejected code is audited as a refusal carrying its reason", () => {
  assert.match(stepUpRoute, /action: "wallet\.step_up_failed"/);
  assert.match(stepUpRoute, /metadata: \{ reason: status \}/, "the reason must be recorded, not swallowed");
  assert.match(stepUpRoute, /action: "wallet\.step_up_completed"/);
});

// ------------------------------------------------------------- the client

const failing = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("a step-up is surfaced as its own state, never as a failure", async () => {
  const result = await submitWalletSignIn(
    { walletAddress: "w", signature: "s", nonce: "n" },
    failing(200, {
      ok: false,
      stepUpRequired: true,
      stepUpId: "11111111-1111-4111-8111-111111111111",
      emailHint: "m••••@protonmail.com",
    })
  );

  assert.equal("stepUpRequired" in result && result.stepUpRequired, true);
  if (!("stepUpRequired" in result)) throw new Error("unreachable");
  assert.equal(result.stepUpId, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.emailHint, "m••••@protonmail.com");
  assert.equal("error" in result, false, "a step-up is not an error");
});

test("a step-up without an id degrades to a plain failure rather than a dead end", async () => {
  // A code form with nothing to submit would strand the member.
  const result = await submitWalletSignIn(
    { walletAddress: "w", signature: "s", nonce: "n" },
    failing(200, { ok: false, stepUpRequired: true })
  );
  assert.equal("stepUpRequired" in result, false);
  assert.equal(result.ok, false);
});

test("an ordinary failure is still an ordinary failure", async () => {
  const result = await submitWalletSignIn(
    { walletAddress: "w", signature: "s", nonce: "n" },
    failing(401, { error: "That wallet isn't linked to a bitXbit account yet." })
  );
  assert.equal(result.ok, false);
  assert.equal("stepUpRequired" in result, false);
  assert.equal("error" in result && result.error, "That wallet isn't linked to a bitXbit account yet.");
});

test("completing a step-up posts the id and code and returns the redirect", async () => {
  let seen: { url: string; body: unknown } | null = null;
  const fetcher = (async (url: string, init?: RequestInit) => {
    seen = { url, body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ ok: true, redirectTo: "/dashboard" }), { status: 200 });
  }) as unknown as typeof fetch;

  const result = await submitWalletStepUp({ stepUpId: "id-1", code: "123456" }, fetcher);
  assert.deepEqual(result, { ok: true, redirectTo: "/dashboard" });
  assert.equal(seen!.url, "/api/auth/wallet/step-up");
  assert.deepEqual(seen!.body, { stepUpId: "id-1", code: "123456" });
});

test("a rejected code passes the server's message through and never invents one", async () => {
  const result = await submitWalletStepUp(
    { stepUpId: "id-1", code: "000000" },
    failing(401, { error: "That code didn't work or has expired." })
  );
  assert.deepEqual(result, { ok: false, error: "That code didn't work or has expired." });

  const bare = await submitWalletStepUp({ stepUpId: "id-1", code: "000000" }, failing(500, {}));
  assert.deepEqual(bare, { ok: false });
});

test("a redirect target that is not root-relative is refused", async () => {
  const result = await submitWalletStepUp(
    { stepUpId: "id-1", code: "123456" },
    failing(200, { ok: true, redirectTo: "https://evil.example" })
  );
  assert.deepEqual(result, { ok: true, redirectTo: "/dashboard" });
});
