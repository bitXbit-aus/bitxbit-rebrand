import { NextResponse, type NextRequest } from "next/server";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { parseHostPolicy } from "@/lib/host-validation";
import { isValidSolanaAddress } from "@/lib/solana";
import {
  createWalletSignInChallenge,
  resolveSignInDomain,
} from "@/lib/wallet-signin";

/**
 * Phase 2 (B3) — step 1 of wallet sign-in.
 *
 * Issues a single-use, domain-bound challenge for a wallet address. This is an
 * UNAUTHENTICATED endpoint, so it is rate limited and gives away nothing.
 *
 * A challenge is issued for ANY well-formed address — registered or not — and the
 * response shape never varies. That is deliberate: looking up the account here
 * would turn this endpoint into an oracle for "does wallet X have an account?".
 * The account is resolved later, at verification.
 */

const HOST_POLICY = parseHostPolicy();

const CHALLENGE_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 10,
  keyPrefix: "api:wallet-signin-challenge",
};

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, CHALLENGE_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.resetAt, identifier);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return noStore({ error: "A valid Solana wallet address is required." }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const walletAddress =
    typeof body.walletAddress === "string" ? body.walletAddress.trim() : "";

  if (!isValidSolanaAddress(walletAddress)) {
    return noStore({ error: "A valid Solana wallet address is required." }, 400);
  }

  // The domain the user is actually on, so a preview sign-in is not bound to
  // production's hostname. See resolveSignInDomain.
  const domain = resolveSignInDomain(
    request.url,
    HOST_POLICY,
    process.env.NEXT_PUBLIC_APP_URL
  );

  try {
    const challenge = await createWalletSignInChallenge(walletAddress, domain);
    return noStore(challenge);
  } catch {
    return noStore({ error: "Could not start sign-in. Please try again." }, 500);
  }
}
