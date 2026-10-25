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

export async function submitWalletSignIn(
  params: { walletAddress: string; signature: string; nonce: string },
  fetcher: Fetcher = fetch
): Promise<{ ok: true; redirectTo: string } | { ok: false }> {
  try {
    const response = await fetcher("/api/auth/wallet/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!response.ok) return { ok: false };

    const data = (await response.json()) as Record<string, unknown>;
    if (data?.ok !== true) return { ok: false };

    const redirectTo =
      typeof data.redirectTo === "string" &&
      data.redirectTo.startsWith("/") &&
      !data.redirectTo.startsWith("//")
        ? data.redirectTo
        : DEFAULT_REDIRECT;

    return { ok: true, redirectTo };
  } catch {
    return { ok: false };
  }
}
