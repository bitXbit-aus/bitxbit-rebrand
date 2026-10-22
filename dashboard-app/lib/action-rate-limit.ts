/**
 * R-005 — rate limiting for Server Actions.
 *
 * Server Actions are authorization-guarded, so R-005 is not an access-control gap:
 * it is an **unbounded-work** gap. An authenticated operator can drive costly
 * actions — a reward calculation that runs over every user, or an on-chain
 * distribution that signs one transaction per recipient — with no request ceiling,
 * so a retry loop or a double-submitted form can fan out without limit.
 *
 * Why the subject is the **user id**, not a client address: a Server Action has no
 * `NextRequest`, so the origin-side client resolution used for API routes
 * (`lib/client-ip.ts`, R-004) is simply unavailable. Substituting a header here
 * would let the caller choose its own key — the exact spoofing hole R-004 closed.
 * Every action limited here is authorization-guarded, so an identified user is
 * always in hand, and a per-user ceiling is the correct bound.
 *
 * Refusals are **returned, not thrown**. A thrown error becomes an opaque HTTP 500
 * in a production build (Next.js redacts the message), so the operator cannot tell
 * a deliberate ceiling from a server fault — the lesson from the test-airdrop
 * guard. `{ error }` reaches the UI intact: the contract in `lib/action-result.ts`,
 * which `FormWithToast` already renders as a destructive toast.
 *
 * Denials are deliberately **not** written to the security audit log: the refusal
 * happens before any mutation, and a caller who is being limited could otherwise
 * use the audit trail itself as an amplification target.
 */
import { checkRateLimit, type RateLimitOptions } from "./rate-limit";
import type { RateLimitResult } from "./rate-limit-store";

/**
 * Ceilings are per authenticated user, per action. They are set well above any
 * plausible human interaction and well below anything a loop can sustain: the
 * purpose is to bound work, not to gate normal use.
 *
 * Chain-touching actions get the tightest budget because they are the most
 * expensive and the least reversible (one signed transaction per recipient);
 * heavy database computation gets a looser one because an operator may
 * legitimately recalculate a period a few times while reconciling income.
 */
export const ACTION_RATE_LIMITS = {
  "reward.calculate": { windowMs: 60_000, maxRequests: 6, keyPrefix: "action:reward-calculate" },
  "reward.correct": { windowMs: 60_000, maxRequests: 6, keyPrefix: "action:reward-correct" },
  "reward.approve": { windowMs: 60_000, maxRequests: 6, keyPrefix: "action:reward-approve" },
  "reward.airdrop": { windowMs: 60_000, maxRequests: 3, keyPrefix: "action:reward-airdrop" },
  "reward.testAirdrop": { windowMs: 60_000, maxRequests: 3, keyPrefix: "action:reward-test-airdrop" },
} as const satisfies Record<string, RateLimitOptions>;

export type ActionRateLimitName = keyof typeof ACTION_RATE_LIMITS;

/**
 * The store key for one user and one action. Namespaced by action so budgets are
 * independent — exhausting the airdrop ceiling must not consume the calculation
 * ceiling — and prefixed by `user:` so an action key can never collide with the
 * API-route keys that use a client address.
 */
export function actionRateLimitKey(userId: string, action: ActionRateLimitName): string {
  return `${ACTION_RATE_LIMITS[action].keyPrefix}:user:${userId}`;
}

export async function checkActionRateLimit(
  userId: string,
  action: ActionRateLimitName
): Promise<RateLimitResult> {
  return checkRateLimit(userId, {
    ...ACTION_RATE_LIMITS[action],
    keyPrefix: `${ACTION_RATE_LIMITS[action].keyPrefix}:user`,
  });
}

/**
 * The refusal an action returns when its ceiling is reached. `resetAt` is an
 * absolute timestamp, so the wait is derived from it rather than assumed.
 */
export function rateLimitRefusal(result: RateLimitResult): { error: string } {
  const seconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return {
    error: `Too many requests. This action is rate limited — please wait ${seconds}s and try again.`,
  };
}