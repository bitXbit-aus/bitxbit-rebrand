import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Every export in a `"use server"` module is a publicly reachable Server Action
// endpoint, so an unguarded one is callable without authentication. These tests
// assert the invariant the register records — every action is authorization-guarded
// — and are the regression guard for the finding that `getTokenBalanceAction` was
// the one action without a guard.
//
// They read the source rather than importing it: `lib/actions.ts` pulls in
// `server-only` modules that will not load in a plain node test, and a source
// assertion is exactly the regression being guarded — a guard removed, or a new
// action added without one.

const GUARD_CALL = /await\s+require(ActiveUser|ActiveAdmin|Capability)\s*\(/;

interface Action {
  name: string;
  body: string;
}

function exportedActions(source: string): Action[] {
  const starts = [...source.matchAll(/^export async function (\w+)/gm)].map((m) => ({
    name: m[1]!,
    at: m.index!,
  }));
  return starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.at, i + 1 < starts.length ? starts[i + 1]!.at : source.length),
  }));
}

// A guard named only in a comment must not count, so comment lines are dropped
// before matching. A real guard call on a code line still counts even with a
// trailing comment.
function codeOnly(body: string): string {
  return body
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"));
    })
    .join("\n");
}

function hasGuardCall(body: string): boolean {
  return GUARD_CALL.test(codeOnly(body));
}

function unguardedNames(source: string): string[] {
  return exportedActions(source)
    .filter((a) => !hasGuardCall(a.body))
    .map((a) => a.name);
}

const SOURCE = readFileSync(join(process.cwd(), "lib/actions.ts"), "utf8");

describe("Server Action authorization guards (R-005)", () => {
  it("enumerates every exported Server Action", () => {
    // 30 -> 29 on 2026-10-26: `saveWalletAddress` was deleted. It could only ever
    // "succeed" by no-op'ing (re-saving an address equal to the already-verified
    // one) — verification is the only path that writes wallet_address — so its
    // sole caller (the wallet page's connect effect) was removed with it, and it
    // was the source of fabricated `success: false` audit rows on every connect.
    // Re-checked for a guard: the deleted action did call requireActiveUser().
    assert.equal(
      exportedActions(SOURCE).length,
      29,
      "the action set changed — re-check each action for an authorization guard"
    );
  });

  it("guards every exported Server Action", () => {
    const unguarded = unguardedNames(SOURCE);
    assert.deepEqual(unguarded, [], `unguarded Server Actions: ${unguarded.join(", ")}`);
  });

  it("guards the wallet balance action with requireActiveUser", () => {
    const action = exportedActions(SOURCE).find((a) => a.name === "getTokenBalanceAction");
    assert.ok(action, "getTokenBalanceAction must exist");
    assert.match(
      codeOnly(action!.body),
      /await\s+requireActiveUser\s*\(/,
      "getTokenBalanceAction must await requireActiveUser()"
    );
  });

  it("does not accept a guard that appears only in a comment", () => {
    const commented = [
      "export async function commentedOut() {",
      "  // await requireActiveUser();",
      "  return 1;",
      "}",
    ].join("\n");
    assert.deepEqual(
      unguardedNames(commented),
      ["commentedOut"],
      "a guard named only in a comment must not satisfy the check"
    );
  });

  it("accepts a real guard call", () => {
    const guarded = [
      "export async function properlyGuarded() {",
      "  await requireActiveUser();",
      "  return 1;",
      "}",
    ].join("\n");
    assert.deepEqual(unguardedNames(guarded), [], "a real guard call must satisfy the check");
  });
});
