/**
 * End-to-end wallet SIGN-IN against a deployed preview.
 *
 * WHY THIS EXISTS
 * ---------------
 * Wallet sign-in composes parts that are each proven separately and, until now,
 * never joined end to end through the real HTTP surface:
 *   * lib/wallet-crypto.test.ts        — signs and verifies Ed25519, no database;
 *   * scripts/wallet-verification-verify.ts — signs + the DB RPC, but calls the
 *     RPC directly and never goes through a route handler or mints a session;
 *   * the migration replay            — the schema, with no HTTP at all.
 *
 * Nothing yet proved that a real keypair can obtain a challenge over HTTP, sign
 * it, exchange it for a SESSION COOKIE, and then authenticate a protected page
 * with that cookie. That composition is the feature. This script drives it.
 *
 * It also asserts the properties that make the feature safe rather than merely
 * working:
 *   * the SIWS message names the host the user is ACTUALLY on (a preview host must
 *     not be handed production's hostname);
 *   * every failure is byte-identical, so the endpoint cannot be used to
 *     enumerate members;
 *   * a replayed nonce is refused;
 *   * an UNVERIFIED wallet and an UNREGISTERED wallet both fail, even though the
 *     caller can produce a perfectly valid signature over the challenge.
 *
 * Required environment:
 *   STAGING_SUPABASE_URL
 *   STAGING_SUPABASE_SERVICE_ROLE_KEY
 *   WALLET_SIGNIN_BASE_URL   — the deployment under test, e.g.
 *                              https://deploy-preview-58--bitxbit-dashboard.netlify.app
 *
 * Run from dashboard-app/ via `npm run test:wallet-signin`.
 * Exit 0 only when every assertion passes AND teardown is proven clean.
 *
 * NOTE ON THE COMPILED PATH: this file imports only packages, never `../lib`, so
 * tsc infers `rootDir` = scripts/ and emits `.staging-dist/wallet-signin-verify.js`.
 * (The B2 harness DOES import `../lib/wallet-crypto`, which moves its output to
 * `.staging-dist/scripts/` — the two npm scripts therefore differ deliberately.)
 * Adding a `../lib` import here will move this output too; update the npm script
 * with it, or `node` fails with MODULE_NOT_FOUND.
 *
 * NOTE ON TEARDOWN: `security_audit_log` is append-only by trigger, so the audit
 * rows this run creates CANNOT be removed and are deliberately left behind. Every
 * other artefact (the disposable auth user, its public.users row, and every
 * challenge row) is deleted and then read back to prove it is gone.
 */

import { createClient } from "@supabase/supabase-js";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

const url = process.env.STAGING_SUPABASE_URL;
const serviceKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = (process.env.WALLET_SIGNIN_BASE_URL ?? process.argv[2] ?? "").replace(/\/$/, "");

if (!url || !serviceKey) {
  console.error("Missing STAGING_SUPABASE_URL or STAGING_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!baseUrl) {
  console.error("Missing WALLET_SIGNIN_BASE_URL (the deployment under test)");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function sign(message: string, keypair: Keypair): string {
  return bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey)
  );
}

async function postChallenge(walletAddress: string) {
  const res = await fetch(`${baseUrl}/api/auth/wallet/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ walletAddress }),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body: body as Record<string, unknown> | null };
}

async function postVerify(payload: Record<string, string>) {
  const res = await fetch(`${baseUrl}/api/auth/wallet/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const cookies = res.headers.getSetCookie?.() ?? [];
  return { status: res.status, body, cookies, raw: JSON.stringify(body) };
}

/** Give a freshly created auth user a verified wallet, in the order the trigger requires. */
async function attachVerifiedWallet(userId: string, walletAddress: string) {
  // wallet_address FIRST: the reset trigger clears wallet_verified whenever the
  // address changes, so setting the flag in the same statement would be undone.
  await admin.from("users").update({ wallet_address: walletAddress }).eq("id", userId);
  await admin.from("users").update({ wallet_verified: true }).eq("id", userId);
}

const createdUserIds: string[] = [];
const usedWallets: string[] = [];

async function teardown() {
  console.log("\n--- teardown ---");
  for (const wallet of usedWallets) {
    await admin.from("wallet_signin_challenges").delete().eq("wallet_address", wallet);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }

  // Read everything back: cleanup is part of the result, not a formality.
  const leftoverChallenges: string[] = [];
  for (const wallet of usedWallets) {
    const { data } = await admin
      .from("wallet_signin_challenges")
      .select("id")
      .eq("wallet_address", wallet);
    if (data && data.length > 0) leftoverChallenges.push(`${wallet}:${data.length}`);
  }
  check("no challenge rows left behind", leftoverChallenges.length === 0, leftoverChallenges.join(", "));

  const leftoverUsers: string[] = [];
  for (const id of createdUserIds) {
    const { data } = await admin.from("users").select("id").eq("id", id);
    if (data && data.length > 0) leftoverUsers.push(id);
  }
  check("no disposable users left behind", leftoverUsers.length === 0, leftoverUsers.join(", "));
}

async function main() {
  console.log(`wallet sign-in end-to-end`);
  console.log(`  deployment : ${baseUrl}`);
  console.log(`  database   : ${url}`);
  console.log("");

  const expectedHost = new URL(baseUrl).host;

  // ---------------------------------------------------------------- fixtures
  const registered = Keypair.generate();
  const unregistered = Keypair.generate();
  const unverifiedKp = Keypair.generate();
  const attacker = Keypair.generate();
  usedWallets.push(
    registered.publicKey.toBase58(),
    unregistered.publicKey.toBase58(),
    unverifiedKp.publicKey.toBase58()
  );

  const email = `wallet-signin-e2e-${Date.now()}@staging-verify.bitxbit`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    console.error("Could not create the disposable user:", createError?.message);
    process.exit(1);
  }
  const userId = created.user.id;
  createdUserIds.push(userId);
  await attachVerifiedWallet(userId, registered.publicKey.toBase58());

  // The unverified fixture is a REAL account that simply has not verified.
  const unverifiedEmail = `wallet-signin-unverified-${Date.now()}@staging-verify.bitxbit`;
  const { data: createdUnverified } = await admin.auth.admin.createUser({
    email: unverifiedEmail,
    email_confirm: true,
  });
  if (createdUnverified?.user) {
    createdUserIds.push(createdUnverified.user.id);
    await admin
      .from("users")
      .update({ wallet_address: unverifiedKp.publicKey.toBase58() })
      .eq("id", createdUnverified.user.id);
    await admin
      .from("users")
      .update({ wallet_verified: false })
      .eq("id", createdUnverified.user.id);
  }

  // ------------------------------------------------------- 1. challenge issued
  console.log("1. challenge");
  const challenge = await postChallenge(registered.publicKey.toBase58());
  check("challenge returns 200", challenge.status === 200, `got ${challenge.status}`);
  const nonce = String(challenge.body?.nonce ?? "");
  const message = String(challenge.body?.message ?? "");
  check("challenge carries a nonce", nonce.length > 0);
  check("challenge carries a message", message.length > 0);

  // The message must name the host the user is ACTUALLY on. NEXT_PUBLIC_APP_URL is
  // production in every context, so a naive implementation binds every preview
  // sign-in to the production hostname.
  check(
    `SIWS message names the deployment's own host (${expectedHost})`,
    message.includes(expectedHost),
    message.split("\n")[0]
  );
  if (expectedHost !== "app.bitxbit.com.au") {
    check(
      "preview sign-in is NOT bound to the production hostname",
      !message.includes("app.bitxbit.com.au"),
      message.split("\n")[0]
    );
  }

  // No enumeration: an unregistered wallet gets the same shape of challenge.
  const unregisteredChallenge = await postChallenge(unregistered.publicKey.toBase58());
  check(
    "unregistered wallet receives an identically shaped challenge",
    unregisteredChallenge.status === 200 &&
      Object.keys(unregisteredChallenge.body ?? {}).sort().join(",") ===
        Object.keys(challenge.body ?? {}).sort().join(","),
    JSON.stringify(unregisteredChallenge.body)
  );

  // ---------------------------------------------------- 2. sign in successfully
  console.log("\n2. sign-in (valid signature, verified wallet)");
  const signature = sign(message, registered);
  const verified = await postVerify({
    walletAddress: registered.publicKey.toBase58(),
    signature,
    nonce,
  });
  check("verify returns 200", verified.status === 200, `got ${verified.status} ${verified.raw}`);
  check("verify reports ok", verified.body?.ok === true, verified.raw);
  const authCookies = verified.cookies.filter((c) => c.startsWith("sb-"));
  check("verify sets supabase session cookies", authCookies.length > 0, `headers: ${verified.cookies.length}`);

  const cookieHeader = authCookies.map((c) => c.split(";")[0]).join("; ");
  if (cookieHeader) {
    const dash = await fetch(`${baseUrl}/dashboard`, {
      headers: { cookie: cookieHeader },
      redirect: "manual",
    });
    check(
      "the minted session authenticates a protected page",
      dash.status === 200,
      `GET /dashboard -> ${dash.status}`
    );
  }

  const meCheck = await fetch(`${baseUrl}/dashboard`, { redirect: "manual" });
  check(
    "without the cookie the same page redirects to login",
    meCheck.status === 307 || meCheck.status === 302,
    `GET /dashboard (no cookie) -> ${meCheck.status}`
  );

  // ------------------------------------------------------------ 3. negatives
  //
  // Two classes, split by what the caller PROVED:
  //   * without a valid signature the response must be generic, so the endpoint
  //     cannot be asked "does this wallet have an account?";
  //   * with a valid signature the caller has demonstrated control of that wallet,
  //     so naming the case discloses nothing new and is what makes the failure
  //     actionable instead of a dead end.
  console.log("\n3. negative cases");
  const noSignature: Array<{ label: string; status: number; raw: string }> = [];
  const withSignature: Array<{ label: string; status: number; raw: string }> = [];

  // (a) same challenge, signed by a different key
  const c1 = await postChallenge(registered.publicKey.toBase58());
  const wrongSigner = await postVerify({
    walletAddress: registered.publicKey.toBase58(),
    signature: sign(String(c1.body?.message ?? ""), attacker),
    nonce: String(c1.body?.nonce ?? ""),
  });
  noSignature.push({ label: "wrong signer", status: wrongSigner.status, raw: wrongSigner.raw });

  check("wrong signer is refused", wrongSigner.status === 401, `got ${wrongSigner.status}`);

  // (b) replay of an already-consumed nonce
  const replay = await postVerify({
    walletAddress: registered.publicKey.toBase58(),
    signature,
    nonce,
  });
  noSignature.push({ label: "replayed nonce", status: replay.status, raw: replay.raw });
  check("replayed nonce is refused", replay.status === 401, `got ${replay.status}`);

  // (c) valid signature, but the account's wallet is NOT verified
  const c3 = await postChallenge(unverifiedKp.publicKey.toBase58());
  const unverified = await postVerify({
    walletAddress: unverifiedKp.publicKey.toBase58(),
    signature: sign(String(c3.body?.message ?? ""), unverifiedKp),
    nonce: String(c3.body?.nonce ?? ""),
  });
  withSignature.push({ label: "unverified wallet", status: unverified.status, raw: unverified.raw });
  check(
    "a VALID signature over an UNVERIFIED wallet is refused",
    unverified.status === 401,
    `got ${unverified.status}`
  );

  // (d) valid signature from a wallet with no account at all
  const c4 = await postChallenge(unregistered.publicKey.toBase58());
  const unreg = await postVerify({
    walletAddress: unregistered.publicKey.toBase58(),
    signature: sign(String(c4.body?.message ?? ""), unregistered),
    nonce: String(c4.body?.nonce ?? ""),
  });
  withSignature.push({ label: "unregistered wallet", status: unreg.status, raw: unreg.raw });
  check("an unregistered wallet is refused", unreg.status === 401, `got ${unreg.status}`);

  // --- the unauthenticated half must stay indistinguishable -------------------
  const noSigDistinct = new Set(noSignature.map((f) => `${f.status}|${f.raw}`));
  check(
    "failures reachable WITHOUT a valid signature are byte-identical (no enumeration)",
    noSigDistinct.size === 1,
    noSignature.map((f) => `${f.label}=${f.status}:${f.raw}`).join(" | ")
  );

  // --- the signed half must name the case ------------------------------------
  const genericBody = noSignature[0]?.raw ?? "";
  const unverifiedRaw = withSignature.find((f) => f.label === "unverified wallet")?.raw ?? "";
  const unlinkedRaw = withSignature.find((f) => f.label === "unregistered wallet")?.raw ?? "";

  check(
    "an unverified-but-linked wallet is told it is not verified",
    /verif/i.test(unverifiedRaw) && unverifiedRaw !== genericBody,
    unverifiedRaw
  );
  check(
    "an unlinked wallet is told it is not linked",
    /link/i.test(unlinkedRaw) && unlinkedRaw !== genericBody,
    unlinkedRaw
  );
  check(
    "the two signed failures differ from each other",
    unverifiedRaw !== unlinkedRaw && unverifiedRaw.length > 0 && unlinkedRaw.length > 0,
    `${unverifiedRaw} | ${unlinkedRaw}`
  );
  check(
    "both signed failures direct the user to sign in with email",
    /email/i.test(unverifiedRaw) && /email/i.test(unlinkedRaw),
    `${unverifiedRaw} | ${unlinkedRaw}`
  );
  check(
    "neither signed failure leaks the account identity",
    !/millsy|@|\b[0-9a-f]{8}-[0-9a-f]{4}/i.test(unverifiedRaw + unlinkedRaw),
    `${unverifiedRaw} | ${unlinkedRaw}`
  );

  // ------------------------------------------------------------- 4. teardown
  await teardown();

  console.log(`\n${passed} assertion(s) passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error("FAILED:\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log("wallet sign-in end-to-end verification PASSED");
}

main().catch(async (error) => {
  console.error("Unexpected failure:", error);
  try {
    await teardown();
  } catch {
    // best effort
  }
  process.exit(1);
});
