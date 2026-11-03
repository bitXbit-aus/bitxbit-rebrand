import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SUPPORT_EMAIL,
  buildWalletSignInNotification,
  escapeHtml,
  formatUtc,
  notificationHost,
  notifyWalletSignIn,
  sendSecurityNotification,
  type EmailMessage,
} from "./security-notification";

const APP_URL = "https://app.bitxbit.com.au";
const WALLET = "86Wo1UkZzM57PE233WjRruJeFL7d49yH7Q1mqdiw4xEA";
const IP = "203.0.113.7";
const AT = "2026-11-03T10:42:07.123Z";

const notice = () =>
  buildWalletSignInNotification({
    email: "member@example.com",
    walletAddress: WALLET,
    clientIp: IP,
    signedInAt: AT,
    appUrl: APP_URL,
  });

// ---------------------------------------------------------------- the content

test("the alert names the event, the wallet, the time and the source", () => {
  const { subject, text } = notice();
  assert.equal(subject, "Wallet sign-in to your bitXbit account");
  assert.match(text, new RegExp(WALLET));
  assert.match(text, /2026-11-03 10:42 UTC/);
  assert.match(text, new RegExp(IP.replace(/\./g, "\\.")));
});

test("the alert tells the member what to DO, in order, with a working link", () => {
  // A warning with no action is noise. This is the whole point of the alert.
  const { text, html } = notice();
  assert.match(text, /Reset your password: https:\/\/app\.bitxbit\.com\.au\/auth\/forgot-password/);
  assert.match(text, /Unlink the wallet/);
  assert.match(text, new RegExp(SUPPORT_EMAIL.replace(".", "\\.")));
  assert.match(html, /auth\/forgot-password/);
});

test("the alert states the ONLY host a prompt is legitimate on", () => {
  // The cheapest part of mitigation 3, delivered where the member will read it —
  // and the sentence that would have defused the relay this control detects.
  const { text, html } = notice();
  assert.match(text, /only ever asks you to sign a message on app\.bitxbit\.com\.au/);
  assert.match(html, /app\.bitxbit\.com\.au/);
});

test("the alert is deterministic for the same input", () => {
  assert.deepEqual(notice(), notice());
});

test("a trailing slash on the app URL does not produce a double slash in the link", () => {
  const { text } = buildWalletSignInNotification({
    email: "m@example.com",
    walletAddress: WALLET,
    clientIp: IP,
    signedInAt: AT,
    appUrl: "https://app.bitxbit.com.au/",
  });
  assert.equal(text.includes("com.au//auth"), false);
});

// ---------------------------------------------------------------- escaping

test("HTML escaping covers every character that can break out of an attribute or node", () => {
  assert.equal(escapeHtml(`<&">'`), "&lt;&amp;&quot;&gt;&#39;");
});

test("a hostile value cannot inject markup into the HTML part", () => {
  // The IP arrives from request headers and the wallet from the caller, so neither
  // may be able to close a tag inside the email.
  const hostile = `"><script>alert(1)</script>`;
  const { html, text } = buildWalletSignInNotification({
    email: "m@example.com",
    walletAddress: hostile,
    clientIp: hostile,
    signedInAt: AT,
    appUrl: APP_URL,
  });
  assert.equal(html.includes("<script>"), false, "raw <script> must not survive into the HTML part");
  assert.match(html, /&lt;script&gt;/);
  // The plain-text part carries it verbatim, which is correct — it is not markup.
  assert.ok(text.includes(hostile));
});

// ---------------------------------------------------------------- formatting

test("formatUtc renders a stable UTC stamp and refuses to invent one", () => {
  assert.equal(formatUtc("2026-11-03T10:42:07.123Z"), "2026-11-03 10:42 UTC");
  assert.equal(formatUtc("not-a-date"), "unknown");
});

test("notificationHost degrades to the production host rather than throwing", () => {
  assert.equal(notificationHost("https://deploy-preview-82--bitxbit-dashboard.netlify.app"), "deploy-preview-82--bitxbit-dashboard.netlify.app");
  assert.equal(notificationHost(""), "app.bitxbit.com.au");
  assert.equal(notificationHost("nonsense"), "app.bitxbit.com.au");
});

// ---------------------------------------------------------------- the sender

interface Call {
  url: string;
  init?: RequestInit;
}

function recordingFetcher(response: Response | (() => Response | Promise<Response>)) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return typeof response === "function" ? await response() : response;
  };
  return { fetcher, calls };
}

const message: EmailMessage = {
  to: "member@example.com",
  subject: "Wallet sign-in to your bitXbit account",
  text: "body",
  html: "<p>body</p>",
};

test("with NO api key, no request is made at all", async () => {
  // A missing configuration must not become an unauthenticated call — and it must be
  // distinguishable from a provider failure.
  const { fetcher, calls } = recordingFetcher(new Response("{}", { status: 200 }));
  const outcome = await sendSecurityNotification(message, { apiKey: "", fetcher });
  assert.deepEqual(outcome, { sent: false, reason: "not_configured" });
  assert.equal(calls.length, 0, "no request may be attempted without a key");
});

test("a successful send reports sent and carries the payload the provider expects", async () => {
  const { fetcher, calls } = recordingFetcher(new Response("{}", { status: 200 }));
  const outcome = await sendSecurityNotification(message, { apiKey: "k", fetcher, from: "bitXbit <x@y.z>" });
  assert.deepEqual(outcome, { sent: true, reason: "sent" });
  assert.equal(calls.length, 1);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer k");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.from, "bitXbit <x@y.z>");
  assert.equal(body.to, "member@example.com");
  assert.equal(body.subject, message.subject);
  assert.equal(body.text, "body");
  assert.equal(body.html, "<p>body</p>");
});

test("a provider rejection is reported as failed with its status, never as sent", async () => {
  const { fetcher } = recordingFetcher(new Response("nope", { status: 500 }));
  const outcome = await sendSecurityNotification(message, { apiKey: "k", fetcher });
  assert.equal(outcome.sent, false);
  assert.equal(outcome.reason, "failed");
  assert.match(String(outcome.detail), /500/);
});

test("a transport error is reported as failed and does NOT throw", async () => {
  const fetcher = async () => {
    throw new TypeError("fetch failed");
  };
  const outcome = await sendSecurityNotification(message, { apiKey: "k", fetcher });
  assert.equal(outcome.sent, false);
  assert.equal(outcome.reason, "failed");
});

test("a hanging provider is abandoned at the timeout and reported as failed", async () => {
  // Exercises the real abort path rather than simulating its result.
  const fetcher = (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
      );
    });
  const outcome = await sendSecurityNotification(message, { apiKey: "k", fetcher, timeoutMs: 20 });
  assert.equal(outcome.sent, false);
  assert.equal(outcome.reason, "failed");
  assert.equal(outcome.detail, "AbortError");
});

// -------------------------------------------- the property that matters most

test("notifyWalletSignIn NEVER throws, whatever the transport does", async () => {
  // The load-bearing guarantee: the session is already minted when this runs, so a
  // mail outage must not become an auth outage.
  const input = {
    email: "member@example.com",
    walletAddress: WALLET,
    clientIp: IP,
    signedInAt: AT,
    appUrl: APP_URL,
  };

  const exploding = await notifyWalletSignIn(input, {
    apiKey: "k",
    fetcher: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(exploding.sent, false);

  const rejecting = await notifyWalletSignIn(input, {
    apiKey: "k",
    fetcher: async () => new Response("nope", { status: 503 }),
  });
  assert.equal(rejecting.sent, false);

  const unconfigured = await notifyWalletSignIn(input, { apiKey: "" });
  assert.equal(unconfigured.reason, "not_configured");

  // A missing recipient is a configuration problem, not a crash.
  const noRecipient = await notifyWalletSignIn({ ...input, email: "" }, { apiKey: "k" });
  assert.equal(noRecipient.sent, false);
  assert.equal(noRecipient.reason, "not_configured");
});

test("a malformed input is caught and reported, never thrown", async () => {
  // This case exists because a mutation run found the gap: deleting the try/catch in
  // notifyWalletSignIn changed NOTHING for the transport failures above, since
  // sendSecurityNotification already never throws. The catch is load-bearing only for
  // the BUILDER, which does throw on malformed input (escaping an absent wallet
  // address is a TypeError) — so without this test the guard was untested, and the
  // mutation that removed it went unnoticed.
  const outcome = await notifyWalletSignIn(
    {
      email: "member@example.com",
      walletAddress: undefined as unknown as string,
      clientIp: IP,
      signedInAt: AT,
      appUrl: APP_URL,
    },
    { apiKey: "k", fetcher: async () => new Response("{}", { status: 200 }) }
  );
  assert.equal(outcome.sent, false);
  assert.equal(outcome.reason, "failed");
  assert.equal(outcome.detail, "TypeError");
});

// ---------------------------------------------------------------- the wiring

const APP_ROOT = join(__dirname, "..");
const route = readFileSync(
  join(APP_ROOT, "app", "api", "auth", "wallet", "verify", "route.ts"),
  "utf8"
);

test("the sign-in route notifies the account owner AFTER the session is minted", () => {
  const mintAt = route.indexOf("verifyOtp(");
  const notifyAt = route.indexOf("notifyWalletSignIn(");
  assert.notEqual(mintAt, -1, "the route must mint the session");
  assert.notEqual(notifyAt, -1, "the route must notify the account owner");
  assert.ok(
    notifyAt > mintAt,
    "the notification must run after the session is minted — a mail problem must never precede auth"
  );
});

test("the notification block is guarded so it cannot fail the sign-in", () => {
  // Structural, and specific: the call must sit inside a try/catch. The behavioural
  // half (that the helper does not throw) is tested above.
  assert.match(
    route,
    /try \{[\s\S]{0,600}notifyWalletSignIn\([\s\S]{0,900}\} catch \{/,
    "the notification must be wrapped in try/catch"
  );
  // And the success response must not depend on the outcome.
  const notifyAt = route.indexOf("notifyWalletSignIn(");
  const responseAt = route.indexOf('{ ok: true, redirectTo: "/dashboard" }');
  assert.ok(responseAt > notifyAt, "the success response must follow the notification");
  assert.equal(
    /notified\.sent[\s\S]{0,120}(return|NextResponse)/.test(route),
    false,
    "the notification outcome must not gate the sign-in response"
  );
});

test("the notification outcome is audited, so a non-send is never silent", () => {
  assert.match(route, /wallet\.signin_notified/);
  assert.match(route, /success: notified\.sent/);
  assert.match(route, /reason: notified\.reason/);
});
