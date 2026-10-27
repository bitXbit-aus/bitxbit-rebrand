/**
 * The Content-Security-Policy, defined once.
 *
 * This was previously emitted from two places — `middleware.ts` (per response) and
 * `netlify.toml` (a CDN header rule) — with a test that merely asserted the two copies
 * agreed. Two copies that must stay equal is a control that regresses silently: a fix
 * applied to one path passes on that path and fails on the other. The module below is
 * now the only source, and `lib/csp-policy.test.ts` fails if a second one reappears.
 *
 * Emitted by middleware, which matches every document request:
 *   matcher: /((?!_next/static|_next/image|favicon.ico|.*\.(svg|png|jpg|jpeg|gif|webp)$).*)
 *
 * Static assets (images, `_next/static`, `favicon.ico`) therefore no longer carry a CSP
 * header. That is deliberate: a CSP on a PNG or a JS chunk governs nothing (it constrains
 * document behaviour, not asset delivery), and the duplication it used to justify was the
 * actual risk. If a document ever needs to be served outside middleware, it needs this
 * header added back deliberately — not by keeping a stale second copy alive.
 *
 * Directive notes that exist because a real breakage was traced to them:
 *
 * - `frame-src` governs which origins THIS page may embed. It is NOT `frame-ancestors`
 *   (who may embed us), so naming wallet origins here does not weaken clickjacking
 *   protection. Without it, `default-src 'self'` is the fallback and blocks the wallet
 *   connect iframe: `connect.solflare.com` for Solflare, `keys.coinbase.com` for
 *   Coinbase. That produced a white "This content is blocked." screen during sign-in,
 *   with a healthy server and a SUCCEEDED audit-log entry.
 * - `frame-ancestors 'none'` must stay as-is. Widening it would be the wrong fix for a
 *   blocked wallet iframe and would trade away clickjacking protection.
 * - `connect-src` lists `api.mainnet-beta.solana.com` and NOT `api.devnet.solana.com`.
 *   The browser is mainnet-pinned (`components/providers/wallet-provider.tsx` sets
 *   `WalletAdapterNetwork.Mainnet`), so devnet was never used by any client-side request;
 *   it was removed rather than kept for symmetry. Server-side RPC (payouts) is chosen by
 *   `SOLANA_RPC_URL` and is not subject to CSP. See R-011.
 */

const DIRECTIVES = [
  "default-src 'self'",
  // 'unsafe-eval' is present in every context, including production. Next's build does
  // not require it at runtime; removing it is a separate hardening change that must be
  // proven in a real browser (hydration) rather than bundled into a consolidation.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://plausible.io",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "frame-src 'self' https://connect.solflare.com https://keys.coinbase.com",
  [
    "connect-src 'self'",
    "https://*.supabase.co",
    "https://api.mainnet-beta.solana.com",
    "https://public-api.birdeye.so",
    "https://api.dexscreener.com",
    "https://plausible.io",
  ].join(" "),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
] as const;

export const CSP_HEADER = "Content-Security-Policy";

/** The single content-security-policy value for every document response. */
export const CONTENT_SECURITY_POLICY = DIRECTIVES.join("; ") + ";";
