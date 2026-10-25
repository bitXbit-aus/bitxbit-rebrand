import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withAuthNoStore } from "@/lib/supabase/response-cache";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { writeAnonymousSecurityAudit } from "@/lib/audit";
import { verifyWalletSignIn } from "@/lib/wallet-signin";

/**
 * Phase 2 (B3) — step 2 of wallet sign-in.
 *
 * Verifies a signed challenge and, on success, establishes a Supabase session.
 *
 * This is the endpoint that mints a session, so three properties matter:
 *
 * 1. **One generic failure.** Every unsuccessful outcome — unknown challenge,
 *    bad signature, wallet not verified, no such account — returns byte-identical
 *    output. The caller cannot use this endpoint to enumerate members or to learn
 *    which half of the check failed.
 * 2. **A session is reachable only through a verified signature.** The session is
 *    minted AFTER `verifyWalletSignIn` has checked the Ed25519 signature over the
 *    database-stored message AND the database has confirmed the account owns a
 *    verified wallet. There is no other path to the mint below.
 * 3. **The response is not cacheable.** `createClient()` writes the session cookie
 *    through `cookies()`, which cannot set response headers, so every response path
 *    below is marked `private, no-store` here (enforced by response-cache.test.ts).
 *    (Note: that guard scans raw source, so prose containing the word "return"
 *    followed later by a semicolon is parsed as a statement — keep that word out
 *    of the comments in this file.)
 *
 * Session establishment reuses the project's passwordless plumbing —
 * `admin.generateLink({ type: "magiclink" })` then `verifyOtp({ token_hash })` on
 * the cookie-backed SSR client — so the session lands in exactly the same cookies
 * as a magic-link sign-in. Both `magiclink` and `email` were measured to accept a
 * magiclink-generated token hash on staging; `magiclink` is used to match the
 * generator.
 */

const VERIFY_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 10,
  keyPrefix: "api:wallet-signin-verify",
};

/** Identical for every failure reason — see note 1 above. */
const GENERIC_FAILURE = { error: "Sign-in failed. Please try again." };

export async function POST(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, VERIFY_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return withAuthNoStore(rateLimitResponse(rateLimit.resetAt, identifier));
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return withAuthNoStore(NextResponse.json(GENERIC_FAILURE, { status: 400 }));
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const walletAddress =
    typeof body.walletAddress === "string" ? body.walletAddress.trim() : "";
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";

  if (!walletAddress || !signature || !nonce) {
    return withAuthNoStore(NextResponse.json(GENERIC_FAILURE, { status: 400 }));
  }

  // Verify FIRST, before any session-capable client is constructed.
  const result = await verifyWalletSignIn({
    walletAddress,
    signatureBase58: signature,
    nonce,
  });

  if (result.outcome !== "signed_in" || !result.userId) {
    // actor_id stays null: nothing about this request proved an identity. The
    // precise reason is recorded here for operators but never returned to the
    // caller, so the audit trail does not become the enumeration oracle the
    // response refuses to be.
    await writeAnonymousSecurityAudit({
      action: "wallet.signin_failed",
      targetTable: "public.wallet_signin_challenges",
      success: false,
      metadata: { wallet_address: walletAddress, reason: result.outcome },
    });
    return withAuthNoStore(NextResponse.json(GENERIC_FAILURE, { status: 401 }));
  }

  const userId = result.userId;
  const admin = createServiceClient();

  const { data: userRow, error: userError } = await admin
    .from("users")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  const email =
    !userError && userRow && typeof userRow.email === "string" ? userRow.email : null;

  if (!email) {
    return withAuthNoStore(NextResponse.json(GENERIC_FAILURE, { status: 500 }));
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const tokenHash = link?.properties?.hashed_token ?? null;

  if (linkError || !tokenHash) {
    return withAuthNoStore(NextResponse.json(GENERIC_FAILURE, { status: 500 }));
  }

  const supabase = await createClient();
  const { data: otp, error: otpError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });

  if (otpError || !otp?.session) {
    return withAuthNoStore(NextResponse.json(GENERIC_FAILURE, { status: 500 }));
  }

  await writeAnonymousSecurityAudit({
    actorId: userId,
    action: "wallet.signed_in",
    targetTable: "public.users",
    targetId: userId,
    metadata: { wallet_address: walletAddress, method: "solana_wallet" },
  });

  return withAuthNoStore(
    NextResponse.json({ ok: true, redirectTo: "/dashboard" })
  );
}
