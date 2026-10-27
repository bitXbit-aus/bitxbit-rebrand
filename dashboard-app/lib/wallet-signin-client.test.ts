import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  requestWalletSignInChallenge,
  submitWalletSignIn,
} from "./wallet-signin-client";

/**
 * The client half of wallet sign-in. These exist because the only other way this
 * code gets exercised is by hand in a browser with a wallet extension installed —
 * which is exactly the path that cannot run in CI. The interesting cases are the
 * failures, and specifically that they stay generic: the server collapses every
 * failure reason into one response so it cannot be used to enumerate members, and
 * the client must not reintroduce a distinction.
 */

const WALLET = "DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function capturingFetcher(response: Response | Error) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fetcher, calls };
}

describe("requestWalletSignInChallenge", () => {
  it("returns the challenge on success", async () => {
    const { fetcher, calls } = capturingFetcher(
      jsonResponse({ nonce: "n-1", message: "line1\nline2", expiresAt: "2026-01-01T00:00:00Z" })
    );
    const challenge = await requestWalletSignInChallenge(WALLET, fetcher);
    assert.deepEqual(challenge, {
      nonce: "n-1",
      message: "line1\nline2",
      expiresAt: "2026-01-01T00:00:00Z",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/auth/wallet/challenge");
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { walletAddress: WALLET });
  });

  it("collapses a non-200 into null", async () => {
    const { fetcher } = capturingFetcher(jsonResponse({ error: "rate limited" }, 429));
    assert.equal(await requestWalletSignInChallenge(WALLET, fetcher), null);
  });

  it("collapses a 500 into null", async () => {
    // The migration-028-absent case on an unmigrated deployment returns exactly this.
    const { fetcher } = capturingFetcher(jsonResponse({ error: "Could not start sign-in." }, 500));
    assert.equal(await requestWalletSignInChallenge(WALLET, fetcher), null);
  });

  it("rejects a response missing the nonce or message", async () => {
    for (const body of [{}, { nonce: "n" }, { message: "m" }, { nonce: 1, message: 2 }]) {
      const { fetcher } = capturingFetcher(jsonResponse(body));
      assert.equal(await requestWalletSignInChallenge(WALLET, fetcher), null, JSON.stringify(body));
    }
  });

  it("tolerates a missing expiresAt without failing the caller", async () => {
    const { fetcher } = capturingFetcher(jsonResponse({ nonce: "n", message: "m" }));
    const challenge = await requestWalletSignInChallenge(WALLET, fetcher);
    assert.equal(challenge?.expiresAt, "");
  });

  it("collapses a network error or non-JSON body into null", async () => {
    const { fetcher: throwing } = capturingFetcher(new Error("offline"));
    assert.equal(await requestWalletSignInChallenge(WALLET, throwing), null);

    const { fetcher: garbage } = capturingFetcher(
      new Response("<html>not json</html>", { status: 200 })
    );
    assert.equal(await requestWalletSignInChallenge(WALLET, garbage), null);
  });
});

describe("submitWalletSignIn", () => {
  const params = { walletAddress: WALLET, signature: "sig", nonce: "n-1" };

  it("returns the server's redirect on success", async () => {
    const { fetcher, calls } = capturingFetcher(
      jsonResponse({ ok: true, redirectTo: "/dashboard" })
    );
    assert.deepEqual(await submitWalletSignIn(params, fetcher), {
      ok: true,
      redirectTo: "/dashboard",
    });
    assert.equal(calls[0].url, "/api/auth/wallet/verify");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), params);
  });

  it("never reports success for any failure", async () => {
    for (const response of [
      jsonResponse({ error: "Sign-in failed." }, 401),
      jsonResponse({ error: "Sign-in failed." }, 400),
      jsonResponse({ ok: false }),
      jsonResponse({}),
      // A body claiming success behind a failure status must NOT be trusted.
      jsonResponse({ ok: true, redirectTo: "/dashboard" }, 500),
    ]) {
      const { fetcher } = capturingFetcher(response);
      assert.equal((await submitWalletSignIn(params, fetcher)).ok, false);
    }
  });

  it("passes the server's guidance through when the server gives one", async () => {
    // Reachable only after a valid signature, so the server names the case.
    const guidance =
      "That wallet isn't linked to a bitXbit account yet. Sign in with your email, then link it from Dashboard → Wallet.";
    const { fetcher } = capturingFetcher(jsonResponse({ error: guidance }, 401));
    assert.deepEqual(await submitWalletSignIn(params, fetcher), {
      ok: false,
      error: guidance,
    });
  });

  it("omits the error when the server sent none, or sent a non-string", async () => {
    for (const body of [{}, { error: 123 }, { error: null }, { error: { nested: true } }]) {
      const { fetcher } = capturingFetcher(jsonResponse(body, 401));
      assert.deepEqual(await submitWalletSignIn(params, fetcher), { ok: false }, JSON.stringify(body));
    }
  });

  it("refuses an oversized error string instead of rendering it", async () => {
    const { fetcher } = capturingFetcher(jsonResponse({ error: "x".repeat(301) }, 401));
    assert.deepEqual(await submitWalletSignIn(params, fetcher), { ok: false });
  });

  it("does NOT follow an absolute redirect target", async () => {
    // A redirect target arriving over the wire is an open-redirect sink; only a
    // root-relative path is accepted.
    for (const evil of ["https://evil.example/steal", "//evil.example", "http://x"]) {
      const { fetcher } = capturingFetcher(jsonResponse({ ok: true, redirectTo: evil }));
      assert.deepEqual(
        await submitWalletSignIn(params, fetcher),
        { ok: true, redirectTo: "/dashboard" },
        evil
      );
    }
  });

  it("falls back to /dashboard when no redirect is supplied", async () => {
    const { fetcher } = capturingFetcher(jsonResponse({ ok: true }));
    assert.deepEqual(await submitWalletSignIn(params, fetcher), {
      ok: true,
      redirectTo: "/dashboard",
    });
  });

  it("collapses a network error or non-JSON body into { ok: false }", async () => {
    const { fetcher: throwing } = capturingFetcher(new Error("offline"));
    assert.deepEqual(await submitWalletSignIn(params, throwing), { ok: false });

    const { fetcher: garbage } = capturingFetcher(
      new Response("<html>not json</html>", { status: 200 })
    );
    assert.deepEqual(await submitWalletSignIn(params, garbage), { ok: false });
  });
});
