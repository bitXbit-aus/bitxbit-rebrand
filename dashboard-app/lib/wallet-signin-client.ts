/**
 * Phase 2 (B3) — client half of wallet sign-in.
 *
 * Kept separate from the component so the request/response handling is unit-tested
 * with a fake `fetch`, rather than only being exercised by hand in a browser.
 *
 * Two deliberate choices:
 *
 * - Every failure collapses to `null` / `{ ok: false }`. The server already
 *   returns one identical error for every failure reason so it cannot be used to
 *   enumerate members; the UI must not undo that by surfacing a more specific
 *   message of its own.
 * - `redirectTo` is accepted ONLY as a root-relative path. The server sends
 *   "/dashboard", but a redirect target that arrives over the wire is an open-redirect
 *   sink the moment anything upstream changes, so it is constrained here too.
 */

export interface WalletSignInChallenge {
  nonce: string;
  message: string;
  expiresAt: string;
}

/** Shown for every failure. Never reveal which check failed. */
export const WALLET_SIGNIN_GENERIC_ERROR =
  "We couldn't sign you in with that wallet. Make sure it's the wallet linked to your account.";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_REDIRECT = "/dashboard";

export async function requestWalletSignInChallenge(
  walletAddress: string,
  fetcher: Fetcher = fetch
): Promise<WalletSignInChallenge | null> {
  try {
    const response = await fetcher("/api/auth/wallet/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data?.nonce !== "string" || typeof data?.message !== "string") return null;

    return {
      nonce: data.nonce,
      message: data.message,
      expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : "",
    };
  } catch {
    return null;
  }
}

export interface WalletSignInFailure {
  ok: false;
  /**
   * A server-supplied, actionable message, when the server chose to give one.
   *
   * The server only does so for failures reachable AFTER a valid signature (wallet
   * not linked / not verified) and returns one generic message for everything else.
   * The client passes that decision through rather than trying to infer it — it
   * cannot tell the cases apart and must not appear to.
   */
  error?: string;
}

/**
 * A step-up is NOT a failure: the signature verified and the account was resolved,
 * but the device is unrecognised, so a code has been sent to the account email
 * (R-021 prevention). It is a distinct state and must be surfaced as one.
 *
 * Folding it into `WalletSignInFailure` would tell a member signing in from a new
 * phone that their wallet is wrong — the exact opposite of what happened.
 */
export interface WalletSignInStepUp {
  ok: false;
  stepUpRequired: true;
  stepUpId: string;
  /** Masked, e.g. `m•••@protonmail.com`. Never the full address. */
  emailHint: string;
}

/** A server message is rendered to the user, so it is length-bounded and type-checked. */
function boundedMessage(data: Record<string, unknown> | null): string | undefined {
  return typeof data?.error === "string" && data.error.length <= 300
    ? data.error
    : undefined;
}

/**
 * `redirectTo` is accepted ONLY as a root-relative path. The server sends
 * "/dashboard", but a redirect target that arrives over the wire is an
 * open-redirect sink the moment anything upstream changes, so it is constrained
 * here too.
 */
function boundedRedirect(data: Record<string, unknown> | null): string {
  return typeof data?.redirectTo === "string" &&
    data.redirectTo.startsWith("/") &&
    !data.redirectTo.startsWith("//")
    ? data.redirectTo
    : DEFAULT_REDIRECT;
}

export async function submitWalletSignIn(
  params: {
    walletAddress: string;
    signature: string;
    nonce: string;
    /**
     * R-021 Part 2. A signature over the SAME nonce, made with this browser's
     * non-exportable device key. Omitted when this browser holds no key — the
     * server then treats the device as unrecognised and asks for a step-up, which
     * is the correct outcome rather than a failure.
     */
    deviceSignature?: string;
  },
  fetcher: Fetcher = fetch
): Promise<{ ok: true; redirectTo: string } | WalletSignInStepUp | WalletSignInFailure> {
  try {
    const response = await fetcher("/api/auth/wallet/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });

    let data: Record<string, unknown> | null = null;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      data = null;
    }

    if (!response.ok) {
      // Only carry the key when there IS a message — an `error: undefined`
      // property is a phantom key that makes `{ok:false}` and
      // `{ok:false, error:undefined}` non-equal, which is a trap for callers.
      const message = boundedMessage(data);
      return message ? { ok: false, error: message } : { ok: false };
    }

    // Tested BEFORE the generic branch, and only when the server actually supplied a
    // step-up id: an unsigned path back to the code form would be a dead end, and
    // reporting a step-up as a failure would mislead the member.
    if (data?.ok === false && data?.stepUpRequired === true) {
      const stepUpId = typeof data.stepUpId === "string" ? data.stepUpId : "";
      if (stepUpId) {
        return {
          ok: false,
          stepUpRequired: true,
          stepUpId,
          emailHint: typeof data.emailHint === "string" ? data.emailHint : "",
        };
      }
    }

    if (data?.ok !== true) return { ok: false };

    return { ok: true, redirectTo: boundedRedirect(data) };
  } catch {
    return { ok: false };
  }
}

/**
 * Complete a step-up with the code sent to the account email.
 *
 * Same failure discipline as sign-in: one shape for every rejection, with the
 * server's own message passed through rather than a guessed one. The server returns
 * an identical message whether a code was wrong, expired, exhausted or unknown, so
 * there is nothing here to infer.
 */
export async function submitWalletStepUp(
  params: {
    stepUpId: string;
    code: string;
    /**
     * R-021 Part 2. The public half of a freshly generated device key, sent once so
     * the server can bind this device to it. The private half never leaves the
     * browser. Omitted when the browser cannot generate one.
     */
    devicePublicKey?: string;
  },
  fetcher: Fetcher = fetch
): Promise<{ ok: true; redirectTo: string } | WalletSignInFailure> {
  try {
    const response = await fetcher("/api/auth/wallet/step-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });

    let data: Record<string, unknown> | null = null;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message = boundedMessage(data);
      return message ? { ok: false, error: message } : { ok: false };
    }

    if (data?.ok !== true) return { ok: false };

    return { ok: true, redirectTo: boundedRedirect(data) };
  } catch {
    return { ok: false };
  }
}
