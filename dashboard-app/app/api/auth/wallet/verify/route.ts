import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withAuthNoStore } from "@/lib/supabase/response-cache";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { writeAnonymousSecurityAudit } from "@/lib/audit";
import { notifyWalletSignIn, sendWalletStepUpCode } from "@/lib/security-notification";
import {
  DEVICE_COOKIE,
  DEVICE_TTL_SECONDS,
  STEPUP_CODE_TTL_SECONDS,
  deviceCookieOptions,
  emailHint,
  generateStepUpCode,
  hashDeviceId,
  hashStepUpCode,
  newDeviceId,
  stepUpKey,
} from "@/lib/wallet-stepup";
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

/** Identical for every failure reachable WITHOUT a verified signature. */
const GENERIC_FAILURE = { error: "Sign-in failed. Please try again." };

/**
 * Guidance for the failures that are only reachable AFTER a valid signature.
 *
 * The caller has proved control of the wallet at this point, so telling them which
 * case they are in discloses nothing they do not already know — and it converts a
 * dead end ("make sure it's the wallet linked to your account") into an instruction
 * they can actually follow. Both messages name the same route, because the fix for
 * both is the same: sign in with email, then use Dashboard → Wallet.
 */
const FAILURE_GUIDANCE: Partial<Record<string, string>> = {
  wallet_not_linked:
    "That wallet isn't linked to a bitXbit account yet. Sign in with your email, then link it from Dashboard → Wallet.",
  wallet_not_verified:
    "That wallet is linked to your account but hasn't been verified yet. Sign in with your email, then finish verification from Dashboard → Wallet.",
};

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

    const guidance = FAILURE_GUIDANCE[result.outcome];
    return withAuthNoStore(
      NextResponse.json(guidance ? { error: guidance } : GENERIC_FAILURE, { status: 401 })
    );
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

  // ===========================================================================
  // R-021 PREVENTION — THE GATE.
  //
  // A verified signature is necessary but NO LONGER SUFFICIENT. It is sufficient
  // only on a device this account has already proved itself on; anything else must
  // complete a code sent to the account email before a session is minted.
  //
  // This branch is what the whole feature exists for. Remove it and the relay works
  // exactly as it did before — which is why the harness asserts `/dashboard` is NOT
  // 200 after a relay, and why a mutation that deletes this block must fail that
  // assertion. A gate no test can see is decorative.
  // ===========================================================================
  const cookieStore = await cookies();
  const presentedDeviceId = cookieStore.get(DEVICE_COOKIE)?.value ?? "";

  // A browser with no handle yet is ISSUED one here, before any trust decision. The
  // handle authorises nothing on its own — trust lives in the database row — but it
  // gives "one live code per (account, device)" a stable device to key on when the
  // browser asks for a code and completes it a minute later.
  const deviceId = presentedDeviceId || newDeviceId();
  const deviceHash = hashDeviceId(deviceId);

  let deviceTrusted = false;
  if (presentedDeviceId) {
    // TTL enforced server-side as well as by the cookie's own max-age: the cookie is
    // a bearer value, so "it was set once" is not the same as "it is still current".
    const cutoff = new Date(Date.now() - DEVICE_TTL_SECONDS * 1000).toISOString();
    const { data: trustedRow } = await admin
      .from("wallet_trusted_devices")
      .select("device_hash")
      .eq("device_hash", deviceHash)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .gt("last_seen_at", cutoff)
      .maybeSingle();
    deviceTrusted = Boolean(trustedRow);
  }

  if (!deviceTrusted) {
    const key = stepUpKey();
    if (!key) {
      // Fail CLOSED, never through: without a key the code cannot be HMAC'd, so
      // there is nothing to verify against, and a session minted here would defeat
      // the gate silently.
      await writeAnonymousSecurityAudit({
        action: "wallet.step_up_send_failed",
        targetTable: "public.wallet_signin_stepups",
        success: false,
        metadata: { reason: "no_step_up_key" },
      });
      return withAuthNoStore(NextResponse.json(GENERIC_FAILURE, { status: 503 }));
    }

    const code = generateStepUpCode();
    const { data: stepUpId, error: beginError } = await admin.rpc("begin_wallet_stepup", {
      p_user_id: userId,
      p_device_hash: deviceHash,
      p_wallet_address: walletAddress,
      p_code_hmac: hashStepUpCode(code, key),
      p_ttl_seconds: STEPUP_CODE_TTL_SECONDS,
    });

    if (beginError || typeof stepUpId !== "string") {
      await writeAnonymousSecurityAudit({
        action: "wallet.step_up_failed",
        targetTable: "public.wallet_signin_stepups",
        success: false,
        metadata: { reason: "begin_failed" },
      });
      return withAuthNoStore(NextResponse.json(GENERIC_FAILURE, { status: 500 }));
    }

    const delivered = await sendWalletStepUpCode({
      email,
      walletAddress,
      clientIp: identifier,
      signedInAt: new Date().toISOString(),
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
      code,
    });

    if (!delivered.sent) {
      // FAIL CLOSED — and it is safe to, because wallet sign-in is an alternative to
      // password and OAuth sign-in, never the only way in. An undeliverable code
      // costs convenience, not access, which is what makes refusing the right default
      // rather than a support burden.
      await writeAnonymousSecurityAudit({
        action: "wallet.step_up_send_failed",
        targetTable: "public.wallet_signin_stepups",
        success: false,
        metadata: { reason: delivered.reason, detail: delivered.detail ?? null },
      });
      const undeliverable = NextResponse.json(
        {
          error:
            "We couldn't send your verification code. Sign in with your email instead, or try again.",
        },
        { status: 503 }
      );
      undeliverable.cookies.set(DEVICE_COOKIE, deviceId, deviceCookieOptions());
      return withAuthNoStore(undeliverable);
    }

    await writeAnonymousSecurityAudit({
      actorId: userId,
      action: "wallet.step_up_required",
      targetTable: "public.users",
      targetId: userId,
      success: true,
      metadata: {
        wallet_address: walletAddress,
        device_returning: Boolean(presentedDeviceId),
        code_email: "sent",
      },
    });

    // NOT an error status: the sign-in is not failing, it is waiting. `ok: false`
    // with `stepUpRequired` is a distinct state the client must handle explicitly —
    // collapsing it into the generic failure message would tell a member on a new
    // device that their wallet is wrong.
    const gated = NextResponse.json({
      ok: false,
      stepUpRequired: true,
      stepUpId,
      emailHint: emailHint(email),
    });
    gated.cookies.set(DEVICE_COOKIE, deviceId, deviceCookieOptions());
    return withAuthNoStore(gated);
  }

  // Trusted. Refresh recency so a device in regular use does not silently age out;
  // the failure is ignored deliberately — a bookkeeping write must never fail a
  // sign-in that has already met the gate.
  await admin
    .from("wallet_trusted_devices")
    .update({ last_seen_at: new Date().toISOString(), last_ip: identifier })
    .eq("device_hash", deviceHash)
    .eq("user_id", userId);

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
    metadata: {
      wallet_address: walletAddress,
      method: "solana_wallet",
      device: "recognised",
    },
  });

  // R-021 — DETECTION, and the reason it is here rather than earlier.
  //
  // A relayed sign-in cannot be prevented inside this handshake: the attacker
  // requests the challenge themselves, so they receive whatever binding we issue
  // (see docs/security/wallet-signin-threat-model.md). What CAN be done is to stop
  // it being silent — the account owner is told immediately, with the wallet, the
  // time, the source IP and what to do, so a relay becomes visible within seconds
  // instead of whenever they next log in.
  //
  // Two properties, both deliberate:
  //
  // 1. It runs AFTER the session is minted and can never fail the sign-in.
  //    `notifyWalletSignIn` does not throw, and the audit write is guarded too — a
  //    mail outage must not become an auth outage.
  // 2. The OUTCOME is audited. A notification that silently does not send would be
  //    a false sense of safety, which is the exact failure this whole risk is about,
  //    so "not configured" and "provider failed" are recorded rather than assumed.
  try {
    const notified = await notifyWalletSignIn({
      email,
      walletAddress,
      clientIp: identifier,
      signedInAt: new Date().toISOString(),
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    });

    await writeAnonymousSecurityAudit({
      actorId: userId,
      action: "wallet.signin_notified",
      targetTable: "public.users",
      targetId: userId,
      success: notified.sent,
      metadata: { reason: notified.reason, detail: notified.detail ?? null },
    });
  } catch {
    // Belt and braces. Nothing above should throw; if it somehow does, the sign-in
    // still succeeds — the session is already minted.
  }

  const response = NextResponse.json({ ok: true, redirectTo: "/dashboard" });
  // Refresh the handle on every successful sign-in, so the cookie's own max-age
  // tracks real use rather than dating from the day the device was first trusted.
  response.cookies.set(DEVICE_COOKIE, deviceId, deviceCookieOptions());
  return withAuthNoStore(response);
}
