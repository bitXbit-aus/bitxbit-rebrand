import { test, expect, type Page } from "@playwright/test";
import { RESET_REQUEST_MESSAGE } from "../lib/password-reset";

/**
 * Browser smoke suite.
 *
 * Every assertion here failed at least one of the nine defects found in the
 * wallet session that no other gate could see. The three that matter most:
 *
 *  - **No Next error shell.** A route can return HTTP 200 while the document is
 *    actually Next's global error page (a streamed Server Component failure).
 *    Status code alone is not a pass.
 *  - **No CSP violation.** A blocked wallet iframe or a blocked script shows up
 *    as a `securitypolicyviolation` event, not as a failed request the server can
 *    see.
 *  - **No console/page errors.** A service worker fetch handler that throws is
 *    invisible everywhere except the browser console.
 *
 * NOT covered here, and deliberately so: the wallet *signature* step. Driving the
 * official wallet adapters needs a real extension, which CI cannot install. That
 * half stays with the documented manual procedure; this suite covers everything
 * up to and including the challenge request, plus the surfaces around it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const ERROR_SHELL =
  /Application error: a (client|server)-side exception|Internal Server Error|This page could not be found|500\s*\|\s*Internal/i;

interface CspViolation {
  directive: string;
  blockedURI: string;
}

const IS_NETLIFY_PREVIEW = (() => {
  try {
    return /(^|\.)netlify\.app$/i.test(new URL(process.env.E2E_BASE_URL ?? "").hostname);
  } catch {
    return false;
  }
})();

/**
 * Netlify injects its deploy-preview toolbar as an iframe on *.netlify.app
 * hosts. Our CSP correctly refuses to frame it — that is the control working as
 * intended, not a defect — and the toolbar does not exist on production. Scoped
 * to preview hosts, so the same URI would still fail on a production run.
 */
function isBenignViolation(v: CspViolation): boolean {
  return (
    IS_NETLIFY_PREVIEW &&
    v.directive === "frame-src" &&
    v.blockedURI === "https://app.netlify.com"
  );
}

const EXPECTED_HEADINGS: Record<string, RegExp> = {
  "/auth/login": /Welcome to bitXbit/i,
  "/auth/signup": /Join bitXbit/i,
  "/auth/forgot-password": /Reset your password/i,
};

test.beforeEach(async ({ context }) => {
  // Installed before any page script: collect CSP violations emitted during load.
  await context.addInitScript(() => {
    (window as any).__cspViolations = [] as Array<Record<string, string>>;
    document.addEventListener("securitypolicyviolation", (e) => {
      const ev = e as SecurityPolicyViolationEvent;
      (window as any).__cspViolations.push({
        directive: ev.effectiveDirective || ev.violatedDirective,
        blockedURI: ev.blockedURI,
      });
    });
  });
});

/** Collect console errors and uncaught page errors for the life of a page. */
function watchErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return { consoleErrors, pageErrors };
}

/** Noise that is not an application defect (third-party/analytics/browser). */
function isBenign(text: string): boolean {
  // Netlify's deploy-preview toolbar iframe, blocked by our own CSP. Preview-only
  // and not our content; on a production run the same text would still fail.
  if (
    IS_NETLIFY_PREVIEW &&
    /app\.netlify\.com/i.test(text) &&
    /Content Security Policy|violates the following/i.test(text)
  ) {
    return true;
  }
  return /favicon|ResizeObserver loop|Failed to load resource: the server responded with a status of 404 \(\)/i.test(
    text
  );
}

/** Dismiss the Plausible consent banner if present, so it cannot intercept clicks. */
async function dismissConsent(page: Page) {
  const decline = page.getByRole("button", { name: /^decline$/i });
  if (await decline.count()) {
    await decline.first().click().catch(() => {});
  }
}

async function cspViolations(page: Page) {
  return page.evaluate(() => (window as any).__cspViolations ?? []);
}

for (const [path, heading] of Object.entries(EXPECTED_HEADINGS)) {
  test(`${path} renders with page-specific content, no error shell, no CSP/console errors`, async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = watchErrors(page);

    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.status(), `${path} HTTP status`).toBeLessThan(400);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);

    // A 200 that is actually Next's global error shell must fail.
    const bodyText = (await page.locator("body").innerText()) || "";
    expect(ERROR_SHELL.test(bodyText), `error shell on ${path}`).toBe(false);

    const violations = ((await cspViolations(page)) as CspViolation[]).filter(
      (v) => !isBenignViolation(v)
    );
    expect(violations, `CSP violations on ${path}: ${JSON.stringify(violations)}`).toEqual([]);

    expect(pageErrors, `uncaught page errors on ${path}`).toEqual([]);
    expect(consoleErrors.filter((m) => !isBenign(m)), `console errors on ${path}`).toEqual([]);
  });
}

test("every chunk the served document references returns 200 (asset-skew guard)", async ({
  page,
}) => {
  // Blank pages after a deploy are usually a cached document pointing at chunk
  // names the new build deleted. Fetch the document, then prove every chunk it
  // names still exists on THIS deployment.
  const resp = await page.request.get("/auth/login");
  expect(resp.status()).toBe(200);
  const html = await resp.text();

  const urls = Array.from(
    new Set(
      (html.match(/\/_next\/(?:static|image)\/[^"'\s)]+?\.(?:js|css)/g) ?? [])
    )
  );
  expect(urls.length, "expected the document to reference build assets").toBeGreaterThan(0);

  for (const url of urls) {
    const asset = await page.request.get(url);
    expect(asset.status(), `asset ${url} must be 200 on this deploy`).toBe(200);
  }
});

test("forgot-password gives an identical message for two unknown addresses (no enumeration)", async ({
  page,
}) => {
  const messages: string[] = [];

  for (const email of [
    `smoke-unknown-a-${Date.now()}@example.invalid`,
    `smoke-unknown-b-${Date.now()}@example.invalid`,
  ]) {
    await page.goto("/auth/forgot-password", { waitUntil: "networkidle" });
    await dismissConsent(page);

    await page.getByLabel(/email/i).fill(email);
    await page.getByRole("button", { name: /send reset link/i }).click();

    const panel = page.getByRole("status");
    await expect(panel).toBeVisible();
    const text = (await panel.innerText()).trim();
    messages.push(text);

    // The specific leak we are guarding against.
    expect(text).not.toMatch(/not found|no account|does not exist|unregistered/i);
  }

  expect(messages[0]).toBe(messages[1]);
  expect(messages[0]).toBe(RESET_REQUEST_MESSAGE);
});

test("reset-password without a session redirects to sign-in with a legible reason", async ({
  page,
}) => {
  await page.goto("/auth/reset-password", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/auth\/login\?error=reset_required/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Welcome to bitXbit/i);
  await expect(page.getByRole("status")).toContainText(/expired or was already used/i);

  const bodyText = (await page.locator("body").innerText()) || "";
  expect(ERROR_SHELL.test(bodyText)).toBe(false);
});

test("wallet sign-in block is present and the challenge endpoint answers with JSON", async ({
  page,
}) => {
  const { consoleErrors, pageErrors } = watchErrors(page);

  await page.goto("/auth/login", { waitUntil: "networkidle" });

  // The wallet block must be present (it is deliberately separate from OAuth).
  await expect(page.getByText(/Wallet sign-in is for existing members/i)).toBeVisible();

  // Exercise the challenge API from the page context. This is the client→server
  // half of wallet sign-in that CI can reach without an extension; a CSP or
  // routing regression shows up here instead of after deploy.
  const result = await page.evaluate(async () => {
    const res = await fetch("/api/auth/wallet/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // A valid, well-known base58 public key (wrapped SOL mint address).
        walletAddress: "So11111111111111111111111111111111111111112",
      }),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text: text.slice(0, 200) };
  });

  expect(result.status, `challenge status: ${result.text}`).toBeLessThan(500);
  expect(result.json, "challenge must return JSON, not an error page").not.toBeNull();

  // On success the shape carries a challenge to sign; a controlled 4xx is also
  // acceptable (rate limit / validation) as long as it is JSON, not a 5xx.
  if (result.status === 200) {
    const body = result.json as { message?: unknown };
    expect(typeof body.message, "challenge should carry a message to sign").toBe("string");
  }

  const violations = ((await cspViolations(page)) as CspViolation[]).filter(
    (v) => !isBenignViolation(v)
  );
  expect(violations, `CSP violations: ${JSON.stringify(violations)}`).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((m) => !isBenign(m))).toEqual([]);
});
