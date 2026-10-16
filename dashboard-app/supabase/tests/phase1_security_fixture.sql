CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  email_confirmed_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID;
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', TRUE), ''), current_user);
$$;

CREATE TABLE storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT FALSE,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[]
);
CREATE TABLE storage.objects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bucket_id TEXT NOT NULL REFERENCES storage.buckets(id),
  name TEXT NOT NULL
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
INSERT INTO storage.buckets (id, name, public) VALUES ('assets', 'assets', TRUE);
CREATE POLICY "Assets public read" ON storage.objects FOR SELECT USING (bucket_id = 'assets');
CREATE POLICY "Assets authenticated insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'assets');
CREATE POLICY "Assets authenticated update" ON storage.objects FOR UPDATE USING (bucket_id = 'assets');
CREATE POLICY "Assets authenticated delete" ON storage.objects FOR DELETE USING (bucket_id = 'assets');

CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  wallet_address TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  referral_code TEXT UNIQUE,
  referred_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  display_order INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.affiliate_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  referral_url TEXT NOT NULL, description TEXT, benefit_text TEXT,
  reward_eligible BOOLEAN NOT NULL DEFAULT TRUE, active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0, logo_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.user_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  offer_id UUID REFERENCES public.affiliate_offers(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('click', 'signup', 'purchase', 'other')),
  source_url TEXT, ip_address INET, user_agent TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.affiliate_income (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), source TEXT NOT NULL,
  offer_id UUID REFERENCES public.affiliate_offers(id) ON DELETE SET NULL,
  amount DECIMAL(12,2) NOT NULL, currency TEXT NOT NULL DEFAULT 'AUD', date_received DATE NOT NULL,
  proof_url TEXT, notes TEXT, created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.allocation_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT NOT NULL,
  community_rewards_pct DECIMAL(5,2) NOT NULL, liquidity_pct DECIMAL(5,2) NOT NULL,
  buybacks_pct DECIMAL(5,2) NOT NULL, projects_pct DECIMAL(5,2) NOT NULL,
  operations_pct DECIMAL(5,2) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT FALSE,
  effective_date DATE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.reward_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), start_date DATE NOT NULL, end_date DATE NOT NULL,
  total_income DECIMAL(12,2) NOT NULL DEFAULT 0,
  allocation_model_id UUID REFERENCES public.allocation_models(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'calculating', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.user_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reward_period_id UUID NOT NULL REFERENCES public.reward_periods(id) ON DELETE CASCADE,
  estimated_aud_value DECIMAL(12,2), bitxbit_amount DECIMAL(18,8), status TEXT NOT NULL DEFAULT 'pending',
  distribution_tx_hash TEXT, distributed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT NOT NULL, description TEXT,
  funding_goal DECIMAL(12,2), amount_allocated DECIMAL(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planning', impact_statement TEXT, image_url TEXT,
  display_order INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.transparency_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), report_month TEXT NOT NULL, report_year INT NOT NULL,
  total_income DECIMAL(12,2), allocation_snapshot JSONB, summary_text TEXT, proof_urls TEXT[],
  published_by UUID REFERENCES public.users(id) ON DELETE SET NULL, published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_income ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocation_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transparency_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own" ON public.users FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users read referred" ON public.users FOR SELECT USING (referred_by = auth.uid());
CREATE POLICY "Users update own" ON public.users FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Categories admin write" ON public.categories FOR ALL USING (TRUE);
CREATE POLICY "Offers admin all" ON public.affiliate_offers FOR ALL USING (TRUE);
CREATE POLICY "Activities read own" ON public.user_activities FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Activities insert own" ON public.user_activities FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Income admin all" ON public.affiliate_income FOR ALL USING (TRUE);
CREATE POLICY "Allocations admin write" ON public.allocation_models FOR ALL USING (TRUE);
CREATE POLICY "Periods admin write" ON public.reward_periods FOR ALL USING (TRUE);
CREATE POLICY "Rewards read own" ON public.user_rewards FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Rewards admin write" ON public.user_rewards FOR ALL USING (TRUE);
CREATE POLICY "Projects admin write" ON public.projects FOR ALL USING (TRUE);
CREATE POLICY "Reports admin write" ON public.transparency_reports FOR ALL USING (TRUE);

GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO authenticated, service_role;
