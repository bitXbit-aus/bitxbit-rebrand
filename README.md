# bitXbit Rebrand

Two-site architecture for the bitXbit ecosystem.

## Structure

```
bitxbit-rebrand/
├── webflow-site/   # Public marketing site (bitxbit.com.au)
└── dashboard-app/  # Member portal (app.bitxbit.com.au)
```

## Sites

### `webflow-site/`

Static HTML marketing site with pages for:

- Home
- How It Works
- Referrals
- Token Economy
- Projects
- Transparency
- FAQ
- Legal Disclaimer
- Style Guide

**Deploy target:** Netlify static hosting

- Base directory: `webflow-site/`
- Build command: `npm run build` (no-op for static site)
- Publish directory: `.`

### `dashboard-app/`

Next.js 14 + Supabase member dashboard with:

- Authentication (magic link / OAuth)
- Member dashboard (`/dashboard`)
- Admin portal (`/admin`)
- Wallet connection
- Rewards & transparency views

**Deploy target:** Netlify Next.js runtime

- Base directory: `dashboard-app/`
- Build command: `next build`
- Publish directory: `.next`

## Environment Variables

The dashboard requires Supabase credentials. Copy `dashboard-app/.env.local.example` to `dashboard-app/.env.local` and fill in your values before running locally.

```bash
cp dashboard-app/.env.local.example dashboard-app/.env.local
```

Required for the dashboard:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`

## Local Development

### Marketing site

```bash
cd webflow-site
npm install
npm run dev
```

### Dashboard

```bash
cd dashboard-app
npm install
npm run dev
```

## Deployment

Both sites can be deployed from this single repository as separate Netlify sites.
