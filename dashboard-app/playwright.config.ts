import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke test configuration.
 *
 * This suite runs against an ALREADY-DEPLOYED URL (a Netlify deploy preview, or
 * production), never against a local build. That is deliberate: the defect class
 * it exists to catch — a CSP that blocks a wallet's connect iframe, a service
 * worker whose fetch handler throws, deploy/asset skew between a cached document
 * and newer chunks, a route that streams a Server Component failure while
 * returning 200 — cannot be reproduced from `tsc`, `npm test` or a local build.
 * It only appears in a real browser talking to a real deployment.
 *
 * `E2E_BASE_URL` is required so a misconfigured run fails loudly instead of
 * silently smoke-testing `about:blank`.
 */
const baseURL = process.env.E2E_BASE_URL;

if (!baseURL) {
  throw new Error(
    "E2E_BASE_URL is required — set it to the deployed URL to smoke-test (e.g. https://deploy-preview-68--bitxbit-dashboard.netlify.app)."
  );
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  // Serial: these are a handful of pages against one deployment, and serialising
  // keeps the console/CSP assertions attributable to a single navigation.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
