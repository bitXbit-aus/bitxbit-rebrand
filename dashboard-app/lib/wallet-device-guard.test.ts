import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Structural guard for the recognised-devices actions (R-021, D5).
//
// Background, because these assertions look fussy without it.
//
// `revokeWalletDevice` puts a device back behind the wallet step-up gate. The value
// it takes from the client is the **device hash** of the row to remove — and nothing
// else. If the *account id* were ever taken from the form (or as a second argument),
// any signed-in member could revoke **anyone's** device, a targeted lockout of
// another member's wallet sign-in. The account id must come from the session.
//
// That property is invisible to `tsc`, the build and CI: `p_user_id: someValue` type-
// checks whether `someValue` is `user.id` or a caller-supplied string. So it is
// asserted here against the source, matching CALLS rather than names — the doc
// comments in `lib/actions.ts` legitimately mention `revoke_wallet_device` and
// `user.id`, and a word-shaped assertion would pass on that prose.
//
// `lib/actions.ts` imports `server-only` modules that will not load in a plain node
// test, so it is read as text (the same approach as `action-authz.test.ts` and
// `password-reset-guard.test.ts`).

const APP_ROOT = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(APP_ROOT, ...parts), "utf8");

const ACTIONS = read("lib", "actions.ts");
const PAGE = read("app", "dashboard", "wallet", "page.tsx");

/** Slice one `export async function <name>` body out of a module's source. */
function actionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `lib/actions.ts must export ${name}`);
  const rest = source.slice(start + 1);
  const nextExport = rest.indexOf("\nexport ");
  return nextExport === -1 ? source.slice(start) : source.slice(start, start + 1 + nextExport);
}

/** Drop comment lines so a guard named only in prose cannot satisfy a match. */
function codeOnly(body: string): string {
  return body
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
}

const revoke = actionBody(ACTIONS, "revokeWalletDevice");
const revokeCode = codeOnly(revoke);
const list = actionBody(ACTIONS, "listWalletDevices");

test("revokeWalletDevice takes ONLY a device hash — never an account id", () => {
  // The signature itself is the first line of defence: an action that cannot accept
  // an account id cannot be made to revoke another member's device by its caller.
  assert.match(
    ACTIONS,
    /export async function revokeWalletDevice\(\s*deviceHash:\s*string\s*\)/,
    "revokeWalletDevice must take exactly one parameter, the device hash"
  );
  assert.equal(
    /export async function revokeWalletDevice\([^)]*\b(user|userId|accountId|account|id)\s*:/.test(
      ACTIONS
    ),
    false,
    "revokeWalletDevice must not accept an account identifier as a parameter"
  );
});

test("revokeWalletDevice is guarded by requireActiveUser BEFORE any service client", () => {
  const guardAt = revokeCode.search(/await\s+requireActiveUser\s*\(/);
  const clientAt = revokeCode.search(/createServiceClient\s*\(/);
  assert.notEqual(guardAt, -1, "the action must await requireActiveUser()");
  assert.notEqual(clientAt, -1, "the action builds a service client");
  assert.ok(
    guardAt < clientAt,
    "authorization must precede the service client — a privileged client built first is defence in depth lost"
  );
});

test("revokeWalletDevice passes the SESSION account id to the revoke RPC", () => {
  // The RPC call, matched with its receiver and its argument, not as a bare name.
  assert.match(
    revokeCode,
    /rpc\(\s*["']revoke_wallet_device["']/,
    "the action must call the revoke_wallet_device RPC"
  );
  assert.match(
    revokeCode,
    /p_user_id:\s*user\.id\b/,
    "the RPC must be scoped by the session's user.id"
  );
  // The strong form: EVERY p_user_id assignment in this action must be user.id. If a
  // future edit introduced `p_user_id: deviceHash` or `p_user_id: params.userId`, this
  // catches it where the positive assertion alone would not.
  //
  // Written as an extraction rather than a negative lookahead: `p_user_id:\s*(?!user\.id)`
  // is defeated by its own whitespace — `\s*` backtracks to zero width and the lookahead
  // then tests the space before `user.id`, so it "matches" a correct call. Pulling out
  // the assigned tokens and comparing the set cannot be fooled that way.
  const assignedUserIds = [...revokeCode.matchAll(/p_user_id:\s*([A-Za-z0-9_$.]+)/g)].map(
    (m) => m[1]
  );
  assert.ok(assignedUserIds.length > 0, "the RPC call must pass p_user_id");
  assert.deepEqual(
    [...new Set(assignedUserIds)],
    ["user.id"],
    "every p_user_id must be sourced from the session's user.id, never the caller"
  );
});

test("revokeWalletDevice validates the device hash before it reaches the RPC", () => {
  const validateAt = revokeCode.search(/normaliseDeviceHash\s*\(/);
  const rpcAt = revokeCode.search(/rpc\(\s*["']revoke_wallet_device["']/);
  assert.notEqual(validateAt, -1, "the caller-supplied hash must be normalised/validated");
  assert.notEqual(rpcAt, -1, "the RPC call must exist");
  assert.ok(
    validateAt < rpcAt,
    "the hash must be validated before the RPC — a malformed handle is a cheap refusal, not a parameter exception"
  );
  // It passes the NORMALISED value, not the raw parameter.
  assert.match(
    revokeCode,
    /p_device_hash:\s*normalised\b/,
    "the RPC must receive the validated/normalised hash, not the raw argument"
  );
});

test("listWalletDevices is guarded and scoped to the session's own user id", () => {
  assert.match(
    codeOnly(list),
    /await\s+requireActiveUser\s*\(/,
    "the read action must be guarded"
  );
  assert.match(
    codeOnly(list),
    /\.eq\(\s*["']user_id["']\s*,\s*context\.user\.id\s*\)/,
    "the read must be scoped to the session's user id, so a member sees only their own devices"
  );
  // No caller-supplied id may appear in the read either.
  assert.equal(
    /export async function listWalletDevices\([^)]*\w/.test(ACTIONS),
    false,
    "listWalletDevices must take no parameters — it reads the session's devices"
  );
});

test("the wallet page is wired to the list and revoke actions", () => {
  // Behavioural tests prove the actions work; they say nothing about whether the UI
  // reaches them. An action declared and never wired is dead surface — the control
  // the R-021 alert points at would not exist.
  assert.match(
    PAGE,
    /import\s*\{[^}]*\blistWalletDevices\b[^}]*\}\s*from\s*["']@\/lib\/actions["']/,
    "the wallet page must import listWalletDevices from lib/actions"
  );
  assert.match(
    PAGE,
    /import\s*\{[^}]*\brevokeWalletDevice\b[^}]*\}\s*from\s*["']@\/lib\/actions["']/,
    "the wallet page must import revokeWalletDevice from lib/actions"
  );
  // Called, not merely imported.
  assert.match(PAGE, /\blistWalletDevices\s*\(/, "the page must CALL listWalletDevices");
  assert.match(PAGE, /\brevokeWalletDevice\s*\(/, "the page must CALL revokeWalletDevice");
});
