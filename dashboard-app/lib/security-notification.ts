/**
 * Security notifications — the compensating control for R-021.
 *
 * ## Why this exists
 *
 * Wallet sign-in can be attacked by **signature relay**: the challenge endpoint is
 * public by design, so an attacker requests a challenge for a victim's wallet
 * address, shows the message to the victim on another site, and relays the
 * signature back for a session. Nothing in the handshake can stop that — the
 * attacker receives whatever binding we issue (see
 * `docs/security/wallet-signin-threat-model.md`, register R-021).
 *
 * Prevention needs an independent factor, which is a product decision. **Detection
 * needs nothing from the user at sign-in time**: if the account owner is told
 * immediately, a relayed sign-in stops being silent, and the victim can change
 * their password and unlink the wallet before the attacker does anything durable.
 * That is what this module sends.
 *
 * ## Two properties are load-bearing
 *
 * 1. **It can never fail a sign-in.** Every path returns an outcome and nothing
 *    throws — a notification is worth having only if the thing it observes still
 *    works when the notification does not. The session is already minted before
 *    this runs, and a mail outage must not become an auth outage.
 * 2. **A non-send is never silent.** The outcome is returned and audited by the
 *    caller, so "not configured" and "provider rejected it" are both visible
 *    rather than looking identical to "no sign-ins happened".
 *
 * The trade-off taken deliberately: the send is **awaited** (bounded) rather than
 * fire-and-forget. In a serverless function a floating promise may never run, and a
 * security alert that silently does not send is worse than a few hundred
 * milliseconds of latency on sign-in.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Bounded so a slow provider cannot hold a sign-in open. */
export const NOTIFICATION_TIMEOUT_MS = 2500;

/** Where the alert comes from. Must be a domain verified with the provider. */
const DEFAULT_FROM = "bitXbit Security <hello@bitxbit.com.au>";

/** Support address shown in the alert. */
export const SUPPORT_EMAIL = "hello@bitxbit.com.au";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendReason = "sent" | "not_configured" | "failed";

export interface SendOutcome {
  sent: boolean;
  reason: SendReason;
  /** Present only for `failed` — never a provider secret, only its status/reason. */
  detail?: string;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface WalletSignInNoticeInput {
  email: string;
  walletAddress: string;
  /** The trusted client identifier (a real client IP, per R-004). */
  clientIp: string;
  /** ISO timestamp of the sign-in. */
  signedInAt: string;
  /** Canonical app URL, e.g. https://app.bitxbit.com.au */
  appUrl: string;
}

/** Minimal HTML escaping. Values here are member-supplied or header-derived. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `2026-11-03T10:42:07.123Z` -> `2026-11-03 10:42 UTC`. Stable and testable. */
export function formatUtc(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "unknown";
  return `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** The host shown to the member as the only place a prompt is legitimate. */
export function notificationHost(appUrl: string): string {
  try {
    return new URL(appUrl).host;
  } catch {
    return "app.bitxbit.com.au";
  }
}

/**
 * Build the wallet sign-in alert.
 *
 * Pure, so the wording is testable. What it must contain, and why:
 *
 * - **what happened** and **which wallet**, so the member can recognise it;
 * - **when** and **from where (IP)**, which is how a person actually decides
 *   "was that me?" — the whole value of the alert is that judgement;
 * - **what to do if it was not them**, in order: change the password, unlink the
 *   wallet, contact support. A warning without an action is noise;
 * - **the one sentence that would have prevented the attack**: never sign a
 *   bitXbit message anywhere but this host. That line is also the cheapest part of
 *   mitigation 3 in the threat model, delivered where the member will read it.
 */
export function buildWalletSignInNotification(
  input: WalletSignInNoticeInput
): EmailMessage {
  const when = formatUtc(input.signedInAt);
  const host = notificationHost(input.appUrl);
  const resetUrl = `${input.appUrl.replace(/\/+$/, "")}/auth/forgot-password`;

  const subject = "Wallet sign-in to your bitXbit account";

  const text = [
    "A wallet was used to sign in to your bitXbit account.",
    "",
    `When:    ${when}`,
    `Wallet:  ${input.walletAddress}`,
    `From IP: ${input.clientIp}`,
    "",
    "If this was you, no action is needed.",
    "",
    "If this was NOT you, someone has obtained a signature from your wallet. Please:",
    `  1. Reset your password: ${resetUrl}`,
    "  2. Unlink the wallet from Dashboard -> Wallet",
    `  3. Tell us: ${SUPPORT_EMAIL}`,
    "",
    `bitXbit only ever asks you to sign a message on ${host}. If you were asked to`,
    "sign anywhere else, it was not us, and the signature should be treated as",
    "compromised.",
    "",
    "— bitXbit",
  ].join("\n");

  const e = escapeHtml;
  const html = `<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b0f19;padding:24px;color:#cbd5e1;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" border="0" style="background:#111827;border:1px solid #1f2937;border-radius:12px;max-width:480px;">
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 16px;font-size:20px;color:#60a5fa;">Wallet sign-in</h1>
        <p style="margin:0 0 16px;line-height:1.5;">A wallet was used to sign in to your bitXbit account.</p>
        <table cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:1.7;">
          <tr><td style="color:#94a3b8;">When</td><td style="padding-left:12px;">${e(when)}</td></tr>
          <tr><td style="color:#94a3b8;">Wallet</td><td style="padding-left:12px;word-break:break-all;">${e(input.walletAddress)}</td></tr>
          <tr><td style="color:#94a3b8;">From IP</td><td style="padding-left:12px;">${e(input.clientIp)}</td></tr>
        </table>
        <p style="margin:20px 0 8px;line-height:1.5;">If this was you, no action is needed.</p>
        <p style="margin:0 0 8px;line-height:1.5;"><strong style="color:#f8fafc;">If this was NOT you</strong>, someone has obtained a signature from your wallet:</p>
        <ol style="margin:0 0 16px;padding-left:20px;line-height:1.7;">
          <li>Reset your password at <a href="${e(resetUrl)}" style="color:#60a5fa;">${e(resetUrl)}</a></li>
          <li>Unlink the wallet from Dashboard &rarr; Wallet</li>
          <li>Tell us at <a href="mailto:${e(SUPPORT_EMAIL)}" style="color:#60a5fa;">${e(SUPPORT_EMAIL)}</a></li>
        </ol>
        <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
          bitXbit only ever asks you to sign a message on <strong>${e(host)}</strong>. If you were asked to sign anywhere else, it was not us, and the signature should be treated as compromised.
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</div>`;

  return { to: input.email, subject, text, html };
}

/**
 * Build the step-up code email (R-021 prevention).
 *
 * Deliberately **not** the alert with a code bolted on, because the two have
 * different jobs and different risks:
 *
 * - It carries a **secret**, so it leads with the code and says plainly that the
 *   code must never be shared — the one instruction that matters when the person
 *   asking for it is a convincing stranger.
 * - It carries **no approval link**. An "approve this sign-in" button would let the
 *   victim authorise the *attacker's* pending attempt, since the attacker's browser
 *   is the one waiting for a session. The factor has to be entered in the browser
 *   that is signing in.
 * - It is the only email sent for a stepped-up sign-in. One email per sign-in, never
 *   two: the warning that would otherwise come from the R-021 alert is folded in
 *   here, so a member on a new device is not told the same thing twice.
 */
export function buildWalletStepUpEmail(
  input: WalletSignInNoticeInput & { code: string }
): EmailMessage {
  const when = formatUtc(input.signedInAt);
  const host = notificationHost(input.appUrl);

  const subject = `Your bitXbit sign-in code: ${input.code}`;

  const text = [
    `Your bitXbit sign-in code is: ${input.code}`,
    "",
    "Enter it in the browser you are signing in from. It expires in 10 minutes.",
    "",
    `When:    ${when}`,
    `Wallet:  ${input.walletAddress}`,
    `From IP: ${input.clientIp}`,
    "",
    "Only enter this code if YOU started a wallet sign-in just now.",
    `If you did not, do NOT share this code with anyone — not even someone`,
    `claiming to be bitXbit. Someone is trying to sign in as you. Reset your`,
    `password and unlink the wallet, then tell us: ${SUPPORT_EMAIL}`,
    "",
    `bitXbit only ever asks you to sign a message on ${host}. If you were asked to`,
    "sign anywhere else, it was not us, and the signature should be treated as",
    "compromised.",
    "",
    "— bitXbit",
  ].join("\n");

  const e = escapeHtml;
  const html = `<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b0f19;padding:24px;color:#cbd5e1;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" border="0" style="background:#111827;border:1px solid #1f2937;border-radius:12px;max-width:480px;">
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 16px;font-size:20px;color:#60a5fa;">New device sign-in</h1>
        <p style="margin:0 0 16px;line-height:1.5;">Enter this code in the browser you are signing in from. It expires in 10 minutes.</p>
        <p style="margin:0 0 24px;font-size:32px;letter-spacing:6px;font-weight:700;color:#f8fafc;background:#0b0f19;border:1px solid #1f2937;border-radius:8px;padding:16px;text-align:center;">${e(input.code)}</p>
        <table cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:1.7;">
          <tr><td style="color:#94a3b8;">When</td><td style="padding-left:12px;">${e(when)}</td></tr>
          <tr><td style="color:#94a3b8;">Wallet</td><td style="padding-left:12px;word-break:break-all;">${e(input.walletAddress)}</td></tr>
          <tr><td style="color:#94a3b8;">From IP</td><td style="padding-left:12px;">${e(input.clientIp)}</td></tr>
        </table>
        <p style="margin:20px 0 0;line-height:1.5;">Only enter this code if <strong style="color:#f8fafc;">you</strong> started a wallet sign-in just now.</p>
        <p style="margin:12px 0 0;line-height:1.5;"><strong style="color:#f87171;">If you did not, do not share this code with anyone</strong> — not even someone claiming to be bitXbit. Someone is trying to sign in as you. Reset your password, unlink the wallet, and tell us at <a href="mailto:${e(SUPPORT_EMAIL)}" style="color:#60a5fa;">${e(SUPPORT_EMAIL)}</a>.</p>
        <p style="margin:20px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
          bitXbit only ever asks you to sign a message on <strong>${e(host)}</strong>. If you were asked to sign anywhere else, it was not us, and the signature should be treated as compromised.
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</div>`;

  return { to: input.email, subject, text, html };
}

/**
 * Send one email through the provider's REST API. **Never throws.**
 *
 * No API key means NO REQUEST IS MADE — a missing configuration must not turn into
 * an unauthenticated call, and it must be distinguishable from a provider failure
 * so the caller can report it honestly.
 */
export async function sendSecurityNotification(
  message: EmailMessage,
  options: {
    apiKey?: string;
    from?: string;
    fetcher?: Fetcher;
    timeoutMs?: number;
  } = {}
): Promise<SendOutcome> {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY ?? "";
  const from = options.from ?? process.env.SECURITY_NOTIFICATION_FROM ?? DEFAULT_FROM;
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? NOTIFICATION_TIMEOUT_MS;

  if (!apiKey) {
    return { sent: false, reason: "not_configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { sent: false, reason: "failed", detail: `provider status ${response.status}` };
    }
    return { sent: true, reason: "sent" };
  } catch (error) {
    // A timeout, DNS failure, TLS failure or a body that is not a Response: all the
    // same to the caller — the alert did not go out, and the sign-in must not care.
    const detail = error instanceof Error ? error.name : "unknown error";
    return { sent: false, reason: "failed", detail };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build and send the step-up code email. **Never throws.**
 *
 * Note the asymmetry with `notifyWalletSignIn`: that one is fail-soft because it is
 * an *observation*, and a mail outage must not become an auth outage. This one is
 * part of a *gate* — the caller must fail **closed** when it returns `sent: false`,
 * which is precisely what the return value exists to let it do.
 */
export async function sendWalletStepUpCode(
  input: WalletSignInNoticeInput & { code: string },
  deps: { apiKey?: string; from?: string; fetcher?: Fetcher; timeoutMs?: number } = {}
): Promise<SendOutcome> {
  try {
    if (!input.email || !input.code) {
      return { sent: false, reason: "not_configured", detail: "no recipient or code" };
    }
    return await sendSecurityNotification(buildWalletStepUpEmail(input), deps);
  } catch (error) {
    return {
      sent: false,
      reason: "failed",
      detail: error instanceof Error ? error.name : "unknown error",
    };
  }
}

/**
 * Build and send the wallet sign-in alert. **Never throws** — see property 1 above.
 *
 * The `deps` seam exists so the route's behaviour can be tested without a provider.
 */
export async function notifyWalletSignIn(
  input: WalletSignInNoticeInput,
  deps: { apiKey?: string; from?: string; fetcher?: Fetcher; timeoutMs?: number } = {}
): Promise<SendOutcome> {
  try {
    if (!input.email) {
      return { sent: false, reason: "not_configured", detail: "no recipient" };
    }
    return await sendSecurityNotification(buildWalletSignInNotification(input), deps);
  } catch (error) {
    return {
      sent: false,
      reason: "failed",
      detail: error instanceof Error ? error.name : "unknown error",
    };
  }
}
