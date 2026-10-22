import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION_RATE_LIMITS,
  actionRateLimitKey,
  checkActionRateLimit,
  rateLimitRefusal,
  type ActionRateLimitName,
} from "./action-rate-limit";
import { setRateLimitStore } from "./rate-limit";
import { MemoryRateLimitStore, RateLimitResult, RateLimitStore } from "./rate-limit-store";

/** Records the keys the limiter actually asks the store for. */
class RecordingStore implements RateLimitStore {
  public readonly keys: string[] = [];
  constructor(private readonly result: RateLimitResult) {}
  async increment(key: string): Promise<RateLimitResult> {
    this.keys.push(key);
    return this.result;
  }
}

const ALLOWED: RateLimitResult = { allowed: true, remaining: 5, resetAt: Date.now() + 60_000 };
const DENIED: RateLimitResult = { allowed: false, remaining: 0, resetAt: Date.now() + 30_000 };

describe("R-005 action rate limiting", () => {
  beforeEach(() => {
    setRateLimitStore(new MemoryRateLimitStore());
  });

  it("namespaces the key by action and user", () => {
    assert.equal(actionRateLimitKey("u1", "reward.airdrop"), "action:reward-airdrop:user:u1");
    assert.equal(
      actionRateLimitKey("u1", "reward.calculate"),
      "action:reward-calculate:user:u1"
    );
  });

  it("gives each action its own budget for the same user", () => {
    const names = Object.keys(ACTION_RATE_LIMITS) as ActionRateLimitName[];
    const keys = names.map((n) => actionRateLimitKey("same-user", n));
    assert.equal(new Set(keys).size, names.length, "action budgets must not share a key");
  });

  it("gives each user their own budget for the same action", () => {
    assert.notEqual(
      actionRateLimitKey("user-a", "reward.airdrop"),
      actionRateLimitKey("user-b", "reward.airdrop")
    );
  });

  it("sends the namespaced key to the store", async () => {
    const store = new RecordingStore(ALLOWED);
    setRateLimitStore(store);
    await checkActionRateLimit("user-xyz", "reward.airdrop");
    assert.deepEqual(store.keys, ["action:reward-airdrop:user:user-xyz"]);
  });

  it("does not let one action's traffic consume another's ceiling", async () => {
    // Same user: exhaust the airdrop budget, then confirm calculate still allows.
    const user = `user-${Date.now()}`;
    const airdrop = ACTION_RATE_LIMITS["reward.airdrop"];
    for (let i = 0; i < airdrop.maxRequests; i++) {
      const r = await checkActionRateLimit(user, "reward.airdrop");
      assert.equal(r.allowed, true, `airdrop call ${i + 1} should be allowed`);
    }
    const blocked = await checkActionRateLimit(user, "reward.airdrop");
    assert.equal(blocked.allowed, false);

    const other = await checkActionRateLimit(user, "reward.calculate");
    assert.equal(other.allowed, true, "a different action must keep its own budget");
  });

  it("does not let one user's traffic consume another's ceiling", async () => {
    const action: ActionRateLimitName = "reward.airdrop";
    const { maxRequests } = ACTION_RATE_LIMITS[action];
    const a = `user-a-${Date.now()}`;
    for (let i = 0; i < maxRequests; i++) await checkActionRateLimit(a, action);
    assert.equal((await checkActionRateLimit(a, action)).allowed, false);

    assert.equal((await checkActionRateLimit(`user-b-${Date.now()}`, action)).allowed, true);
  });

  it("allows exactly maxRequests and refuses the next call", async () => {
    const action: ActionRateLimitName = "reward.calculate";
    const { maxRequests } = ACTION_RATE_LIMITS[action];
    const user = `boundary-${Date.now()}`;
    for (let i = 1; i <= maxRequests; i++) {
      const r = await checkActionRateLimit(user, action);
      assert.equal(r.allowed, true, `call ${i}/${maxRequests} should be allowed`);
      assert.equal(r.remaining, maxRequests - i);
    }
    const refused = await checkActionRateLimit(user, action);
    assert.equal(refused.allowed, false);
    assert.equal(refused.remaining, 0);
  });

  it("returns a refusal object, not a throw, so the message survives production", () => {
    const refusal = rateLimitRefusal(DENIED);
    assert.equal(typeof refusal, "object");
    assert.equal(typeof refusal.error, "string");
    assert.ok(refusal.error.length > 0);
    // FormWithToast renders `error`; an empty string would be treated as success.
    assert.ok(refusal.error.trim().length > 0);
  });

  it("derives the wait from resetAt rather than assuming it", () => {
    const soon = rateLimitRefusal({ allowed: false, remaining: 0, resetAt: Date.now() + 30_000 });
    assert.match(soon.error, /wait (29|30)s/);

    const later = rateLimitRefusal({ allowed: false, remaining: 0, resetAt: Date.now() + 120_000 });
    assert.match(later.error, /wait (119|120)s/);
    assert.notEqual(soon.error, later.error, "the message must reflect the actual window");
  });

  it("never reports a zero or negative wait for an expired window", () => {
    const expired = rateLimitRefusal({ allowed: false, remaining: 0, resetAt: Date.now() - 60_000 });
    assert.match(expired.error, /wait 1s/, "an expired window must not produce 'wait 0s' or '-60s'");
  });

  it("keeps chain-touching actions at or below compute budgets", () => {
    // A regression guard: the chain actions sign real transactions, so they must
    // never end up with a looser ceiling than the database-compute actions.
    const chain = [
      ACTION_RATE_LIMITS["reward.airdrop"].maxRequests,
      ACTION_RATE_LIMITS["reward.testAirdrop"].maxRequests,
    ];
    const compute = [
      ACTION_RATE_LIMITS["reward.calculate"].maxRequests,
      ACTION_RATE_LIMITS["reward.correct"].maxRequests,
      ACTION_RATE_LIMITS["reward.approve"].maxRequests,
    ];
    assert.ok(
      Math.max(...chain) <= Math.min(...compute),
      "chain budgets must not exceed compute budgets"
    );
  });

  // The unit tests above prove the limiter works. They say nothing about whether
  // it is actually reached: a limit can be declared in the map and never applied,
  // and every test here would still pass. These two assertions close that gap —
  // they fail if a guard is dropped from lib/actions.ts, which is exactly the
  // regression a future edit would introduce.
  it("applies every declared limit at a real call site", () => {
    const src = readFileSync(join(process.cwd(), "lib/actions.ts"), "utf8");
    for (const name of Object.keys(ACTION_RATE_LIMITS) as ActionRateLimitName[]) {
      assert.ok(
        src.includes(`checkActionRateLimit(context.user.id, "${name}")`),
        `limit "${name}" is declared but never applied in lib/actions.ts`
      );
    }
  });

  it("returns the refusal from every guarded call site", () => {
    const src = readFileSync(join(process.cwd(), "lib/actions.ts"), "utf8");
    const guards = src.split("if (!limit.allowed) return rateLimitRefusal(limit);").length - 1;
    assert.equal(
      guards,
      Object.keys(ACTION_RATE_LIMITS).length,
      "every declared limit must both check `allowed` and return the refusal"
    );
  });
});
