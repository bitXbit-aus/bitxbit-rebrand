/** @type {import('next').NextConfig} */
// Server Action origin allowlist (R-003).
//
// Next already rejects a Server Action whose `origin` does not match the
// forwarded host; `allowedOrigins` is the fallback for origins that legitimately
// differ. Entries are `host[:port]`, matched against `new URL(origin).host`.
//
// Deliberately NOT `*.netlify.app`: Next's wildcard matching only works below
// the domain level, so that entry would admit any Netlify-hosted site. Deploy
// previews do not need it — on a preview deployment `origin` and `host` are the
// same host, so Next's default check already accepts them. The authoritative
// host allowlist, including pinned preview hosts, lives in
// lib/host-validation.ts and is enforced in middleware.
function allowedServerActionOrigins() {
  const origins = ['app.bitxbit.com.au'];
  for (const value of (process.env.ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = value.trim();
    if (trimmed) origins.push(trimmed);
  }
  if (process.env.NODE_ENV !== 'production') {
    origins.push('localhost:3000');
  }
  return origins;
}

// Server Action body limit (R-006). Set explicitly rather than inheriting Next's
// 1 MB default silently.
//
// What this DOES cover: the non-multipart (JSON / fetch) action path, checked in
// next/dist/server/app-render/action-handler.js and rejected with an internal 413
// — the browser sees an opaque 500, not the 413.
//
// What this does NOT cover: FILE UPLOADS. Measured 2026-10-22 on a production
// build — Next passes this value to busboy as `fieldSize`, which limits non-file
// fields only, and the plain-form multipart path does not apply it at all. A 5 MB
// file was received intact with this default in force. Upload size is enforced by
// the application instead (lib/asset-policy.ts, unit-tested), which is why that
// limit sits below the platform's own ceiling. Do not rely on this setting to
// bound an upload.
//
// 1 MB is generous for the fields these actions carry (names, descriptions, URLs)
// and keeps the pre-authentication parse bounded: this check runs BEFORE any
// authorization, so raising it would also enlarge what an unauthenticated caller
// can make the server buffer.
const SERVER_ACTION_BODY_SIZE_LIMIT = '1mb';

// R-002 — keep bigint-buffer's vulnerable native addon out of the server bundle.
//
// CVE-2025-3194 (GHSA-3gc7-fjrx-p6mg) is a buffer overflow in `toBigIntLE()`.
// Measured 2026-10-22 against the installed tree: the abort comes from the
// **native C addon** (`bigint_buffer.node`, assertion at bigint-buffer.c:49) and
// fires on **non-Buffer input only** — `null`, `undefined`, a string or a number
// each SIGABRT the process, while *every* Buffer length is handled correctly.
// The package's **pure-JS fallback is safe**: the same inputs raise a catchable
// TypeError instead of aborting.
//
// The reachable path in this app is `@solana/spl-token` → `@solana/buffer-layout-utils`
// → `bigint-buffer`, and that is the ONLY caller in the tree. Its `decode` passes
// `Buffer.from(src)`, so the vulnerable function always receives a Buffer and the
// trigger is unreachable by argument. This exclusion adds a second, structural
// guarantee: the addon is not traced into the function bundle at all, so the safe
// fallback is what runs — the vulnerable code is absent rather than merely
// unreached. Do not remove this without re-reading the R-002 evidence.
const BIGINT_BUFFER_NATIVE_EXCLUDE = ['node_modules/bigint-buffer/build/**'];

const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['localhost'],
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: allowedServerActionOrigins(),
      bodySizeLimit: SERVER_ACTION_BODY_SIZE_LIMIT,
    },
    outputFileTracingExcludes: {
      '*': BIGINT_BUFFER_NATIVE_EXCLUDE,
    },
  },
};

export default nextConfig;
