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
import {
  DEVICE_COOKIE,
  deviceCookieOptions,
  deviceLabel,
  hashDeviceId,
  hashStepUpCode,
  newDeviceId,
  parseStepUpStatus,
  stepUpKey,
} from "@/lib/wallet-stepup";

/**
 * R-021 prevention — step 4 of wallet sign-in: complete the step-up.
 *
 * Reached only when `/api/auth/wallet/verify` verified a wallet signature AND the
 * presenting device was not trusted. The session is minted HERE and nowhere else in
 * this flow, after the code is accepted.
 *
 * Why a step-up exists at all: a signature can be relayed. An attacker can request a
 * challenge for the victim's wallet, show the message to the victim on a site they
 * control, and submit the resulting signature. Nothing in that handshake can stop it
 * — the attacker *is* the challenge requester and receives whatever binding we issue
 * (`docs/security/wallet-signin-threat-model.md`). What can stop it is a factor the
 * attacker does not have, entered in the browser that is signing in.
 *
 * One generic failure for every rejected code. The caller already holds the step-up
 * id, so there is no member to enumerate here — but saying which check failed would
 * also tell an attacker how far they got, and there is no reason to.
 */

const STEPUP_RATE_LIMIT = {
  windowMs: 600_000,
  maxRequests: 10,
  keyPrefix: "api:wallet-stepup",
};

/** One message for every rejection: wrong, expired, exhausted, reused, unknown. */
const GENERIC_FAILURE = {
  error:
    "That code didn't work or has expired. Sign in with your wallet again to get a new one.",
};

/** Used when the code is correct but we cannot mint — never a partial success. */
const MINT_FAILURE = { error: "Sign-in failed. Please try again." };

export async function POST(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, STEPUP_RATE_LIMIT);
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
  const stepUpId = typeof body.stepUpId === "string" ? body.stepUpId.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  // Shape checks first: a malformed step-up id or code is a caller error, and
  // handing it to the RPC would only produce a parameter exception.
  if (!/^[0-9a-f-]{36}$/i.test(stepUpId) || !/^\d{6}$/.test(code)) {
    return withAuthNoStore(NextResponse.json(GENERIC_FAILURE, { status: 400 }));
  }

  const key = stepUpKey();
  if (!key) {
    // Fail CLOSED. No key means the HMAC cannot be computed, so there is nothing to
    // compare a code against — and treating that as "verified" would be the worst
    // possible default for the one control that stands between a relayed signature
    // and a session.
    await writeAnonymousSecurityAudit({
      action: "wallet.step_up_failed",
      targetTable: "public.wallet_signin_stepups",
      success: false,
      metadata: { reason: "no_step_up_key" },
    });
    return withAuthNoStore(NextResponse.json(MINT_FAILURE, { status: 503 }));
  }

  const admin = createServiceClient();

  const { data, error } = await admin.rpc("complete_wallet_stepup", {
    p_id: stepUpId,
    p_code_hmac: hashStepUpCode(code, key),
  });

  if (error) {
    // The RPC only raises on invalid parameters — no write to lose here, unlike the
    // failure paths inside it, which return a status precisely so their writes survive.
    await writeAnonymousSecurityAudit({
      action: "wallet.step_up_failed",
      targetTable: "public.wallet_signin_stepups",
      success: false,
      metadata: { reason: "rpc_error" },
    });
    return withAuthNoStore(NextResponse.json(GENERIC_FAILURE, { status: 401 }));
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const status = parseStepUpStatus(result.status);

  if (status !== "ok") {
    // Audited as a refusal with its reason, not as a mutation failure: a member who
    // mistyped a code is not an attack, and a log that cannot tell them apart gets
    // ignored. The row is single-use or consumed by the RPC in every one of these
    // cases, so nothing is retryable against the same step-up.
    await writeAnonymousSecurityAudit({
      action: "wallet.step_up_failed",
      targetTable: "public.wallet_signin_stepups",
      success: false,
      metadata: { reason: status },
    });
    return withAuthNoStore(NextResponse.json(GENERIC_FAILURE, { status: 401 }));
  }

  const userId = typeof result.user_id === "string" ? result.user_id : "";
  if (!userId) {
    await writeAnonymousSecurityAudit({
      action: "wallet.step_up_failed",
      targetTable: "public.wallet_signin_stepups",
      success: false,
      metadata: { reason: "no_user_resolved" },
    });
    return withAuthNoStore(NextResponse.json(MINT_FAILURE, { status: 500 }));
  }

  const { data: userRow, error: userError } = await admin
    .from("users")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  const email =
    !userError && userRow && typeof userRow.email === "string" ? userRow.email : null;

  if (!email) {
    return withAuthNoStore(NextResponse.json(MINT_FAILURE, { status: 500 }));
  }

  // Same passwordless plumbing the magic-link and wallet sign-in paths use, so the
  // session lands in exactly the same cookies. Unchanged by this feature.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const tokenHash = link?.properties?.hashed_token ?? null;
  if (linkError || !tokenHash) {
    return withAuthNoStore(NextResponse.json(MINT_FAILURE, { status: 500 }));
  }

  const supabase = await createClient();
  const { data: otp, error: otpError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });

  if (otpError || !otp?.session) {
    return withAuthNoStore(NextResponse.json(MINT_FAILURE, { status: 500 }));
  }

  // Trust the device that COMPLETED the step-up — not one that requested it. That
  // distinction is what stops an attacker who initiated a step-up from earning trust
  // for their own browser: the trust is written against whatever browser presents the
  // correct code, and the attacker does not have it.
  const cookieStore = await cookies();
  const existing = cookieStore.get(DEVICE_COOKIE)?.value ?? "";
  const deviceId = existing || newDeviceId();
  const deviceHash = hashDeviceId(deviceId);
  const userAgent = request.headers.get("user-agent");

  const { error: trustError } = await admin.rpc("trust_wallet_device", {
    p_device_hash: deviceHash,
    p_user_id: userId,
    p_label: deviceLabel(userAgent),
    p_last_ip: identifier,
    p_public_key: null,
  });

  await writeAnonymousSecurityAudit({
    actorId: userId,
    action: "wallet.step_up_completed",
    targetTable: "public.users",
    targetId: userId,
    success: true,
    metadata: { device_trusted: !trustError },
  });

  await writeAnonymousSecurityAudit({
    actorId: userId,
    action: "wallet.signed_in",
    targetTable: "public.users",
    targetId: userId,
    metadata: { method: "solana_wallet", device: "stepped_up" },
  });

  // No second email here. The code email already carried the warning this sign-in
  // needs (wallet, time, source IP, and what to do if it was not them), and sending
  // the standing alert as well would tell a member on a new device the same thing
  // twice. One email per sign-in — recorded as such at the point it was sent.
  const response = NextResponse.json({ ok: true, redirectTo: "/dashboard" });
  response.cookies.set(DEVICE_COOKIE, deviceId, deviceCookieOptions());
  return withAuthNoStore(response);
}
