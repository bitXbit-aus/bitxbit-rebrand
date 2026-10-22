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

const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['localhost'],
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: allowedServerActionOrigins(),
    },
  },
};

export default nextConfig;
