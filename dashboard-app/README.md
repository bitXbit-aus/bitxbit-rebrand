# bitXbit Dashboard

A Next.js 14 member and admin dashboard for the bitXbit referral ecosystem, backed by Supabase.

## Features

- **Authentication**: Magic link email auth via Supabase Auth
- **Member Dashboard**: Overview, profile, rewards, activity, wallet, transparency
- **Admin Dashboard**: Offers, categories, income tracking, rewards management, users, reports, transparency updates, projects
- **Row Level Security**: Database policies enforce role-based access
- **Wallet Integration**: Placeholder for Solana wallet adapter

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui components
- Supabase (Postgres, Auth, RLS)

## Getting Started

### 1. Install dependencies

```bash
cd dashboard-app
npm install
```

### 2. Environment variables

Copy `.env.local.example` to `.env.local` and fill in your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Apply database schema

In Supabase SQL Editor, run the contents of `supabase/migrations/001_initial_schema.sql`.

### 4. Run the development server

```bash
npm run dev
```

Open http://localhost:3000.

### 5. Make your first user an admin

After signing up, run this SQL in Supabase SQL Editor:

```sql
UPDATE public.users SET role = 'admin' WHERE email = 'your@email.com';
```

## Project Structure

```
app/
  auth/          # Login, signup, callback
  dashboard/     # Member pages
  admin/         # Admin pages
  layout.tsx     # Root layout
  globals.css    # Tailwind + custom styles
components/
  ui/            # shadcn/ui components
  dashboard/     # Dashboard layout, sidebar
types/           # TypeScript types
lib/
  utils.ts       # Helpers
  supabase/      # Client + server clients
  actions.ts     # Server actions
supabase/
  migrations/    # SQL schema
```

## Database Schema

### Key Tables

- `users` — extends Supabase Auth with display_name, wallet_address, role, status
- `categories` — offer categories
- `affiliate_offers` — referral links
- `user_activities` — click/signup tracking
- `affiliate_income` — income records
- `allocation_models` — ecosystem allocation percentages
- `reward_periods` — monthly/quarterly reward windows
- `user_rewards` — per-user reward allocations
- `projects` — funded initiatives
- `transparency_reports` — monthly public reports

## Row Level Security

- Members can read their own data only
- Admins can read and write everything
- Affiliate offers and projects are publicly readable when active

## Deployment

Recommended: Vercel

```bash
vercel --prod
```

Set environment variables in Vercel dashboard.

## Roadmap

- [ ] Integrate Solana Wallet Adapter for real wallet connection
- [ ] Add reward distribution transactions on-chain
- [ ] Build affiliate click tracking with UTM parameters
- [ ] Automate income allocation calculations
- [ ] Add email notifications for new rewards
