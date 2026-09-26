-- ============================================
-- bitXbit Supabase Schema
-- Version: 1.0
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS (extends Supabase Auth)
-- ============================================
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  wallet_address TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================
-- CATEGORIES
-- ============================================
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  display_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- AFFILIATE OFFERS
-- ============================================
CREATE TABLE public.affiliate_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  referral_url TEXT NOT NULL,
  description TEXT,
  benefit_text TEXT,
  reward_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- USER ACTIVITIES
-- ============================================
CREATE TABLE public.user_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  offer_id UUID REFERENCES public.affiliate_offers(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('click', 'signup', 'purchase', 'other')),
  source_url TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_activities_user_id ON public.user_activities(user_id);
CREATE INDEX idx_user_activities_created_at ON public.user_activities(created_at);

-- ============================================
-- AFFILIATE INCOME
-- ============================================
CREATE TABLE public.affiliate_income (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source TEXT NOT NULL,
  offer_id UUID REFERENCES public.affiliate_offers(id) ON DELETE SET NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  date_received DATE NOT NULL,
  proof_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_affiliate_income_date ON public.affiliate_income(date_received);

-- ============================================
-- ALLOCATION MODELS
-- ============================================
CREATE TABLE public.allocation_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  community_rewards_pct DECIMAL(5,2) NOT NULL,
  liquidity_pct DECIMAL(5,2) NOT NULL,
  buybacks_pct DECIMAL(5,2) NOT NULL,
  projects_pct DECIMAL(5,2) NOT NULL,
  operations_pct DECIMAL(5,2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_alloc_sum CHECK (
    community_rewards_pct + liquidity_pct + buybacks_pct + projects_pct + operations_pct = 100
  ),
  CONSTRAINT chk_alloc_positive CHECK (
    community_rewards_pct >= 0 AND liquidity_pct >= 0 AND buybacks_pct >= 0 AND projects_pct >= 0 AND operations_pct >= 0
  )
);

-- ============================================
-- REWARD PERIODS
-- ============================================
CREATE TABLE public.reward_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_income DECIMAL(12,2) NOT NULL DEFAULT 0,
  allocation_model_id UUID REFERENCES public.allocation_models(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'calculating' CHECK (status IN ('calculating', 'approved', 'distributed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- USER REWARDS
-- ============================================
CREATE TABLE public.user_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reward_period_id UUID NOT NULL REFERENCES public.reward_periods(id) ON DELETE CASCADE,
  estimated_aud_value DECIMAL(12,2),
  bitxbit_amount DECIMAL(18,8),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'distributed', 'rejected')),
  distribution_tx_hash TEXT,
  distributed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_rewards_user_id ON public.user_rewards(user_id);
CREATE INDEX idx_user_rewards_period ON public.user_rewards(reward_period_id);

-- ============================================
-- PROJECTS
-- ============================================
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  funding_goal DECIMAL(12,2),
  amount_allocated DECIMAL(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'completed', 'paused')),
  impact_statement TEXT,
  image_url TEXT,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- TRANSPARENCY REPORTS
-- ============================================
CREATE TABLE public.transparency_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_month TEXT NOT NULL,
  report_year INT NOT NULL,
  total_income DECIMAL(12,2),
  allocation_snapshot JSONB,
  summary_text TEXT,
  proof_urls TEXT[],
  published_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
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

-- Users: members read own, admins read all
CREATE POLICY "Users read own" ON public.users
  FOR SELECT USING (auth.uid() = id OR EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'
  ));

CREATE POLICY "Users update own" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Categories: public read, admin write
CREATE POLICY "Categories public read" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Categories admin write" ON public.categories
  FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Affiliate Offers: public read active, admin all
CREATE POLICY "Offers public read" ON public.affiliate_offers
  FOR SELECT USING (active = true);
CREATE POLICY "Offers admin all" ON public.affiliate_offers
  FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- User Activities: read own, admin read all, insert own
CREATE POLICY "Activities read own" ON public.user_activities
  FOR SELECT USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'
  ));
CREATE POLICY "Activities insert own" ON public.user_activities
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Affiliate Income: admin only
CREATE POLICY "Income admin all" ON public.affiliate_income
  FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Allocation Models: public read, admin write
CREATE POLICY "Allocations public read" ON public.allocation_models FOR SELECT USING (true);
CREATE POLICY "Allocations admin write" ON public.allocation_models
  FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Reward Periods: public read, admin write
CREATE POLICY "Periods public read" ON public.reward_periods FOR SELECT USING (true);
CREATE POLICY "Periods admin write" ON public.reward_periods
  FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- User Rewards: read own, admin all
CREATE POLICY "Rewards read own" ON public.user_rewards
  FOR SELECT USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'
  ));
CREATE POLICY "Rewards admin write" ON public.user_rewards
  FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Projects: public read, admin write
CREATE POLICY "Projects public read" ON public.projects FOR SELECT USING (true);
CREATE POLICY "Projects admin write" ON public.projects
  FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Transparency Reports: public read, admin write
CREATE POLICY "Reports public read" ON public.transparency_reports FOR SELECT USING (true);
CREATE POLICY "Reports admin write" ON public.transparency_reports
  FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, email_verified)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), NEW.email_confirmed_at IS NOT NULL);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Calculate total income for a period
CREATE OR REPLACE FUNCTION public.calculate_period_income(period_id UUID)
RETURNS DECIMAL AS $$
DECLARE
  start_d DATE;
  end_d DATE;
  total DECIMAL;
BEGIN
  SELECT start_date, end_date INTO start_d, end_d FROM public.reward_periods WHERE id = period_id;
  SELECT COALESCE(SUM(amount), 0) INTO total
  FROM public.affiliate_income
  WHERE date_received >= start_d AND date_received <= end_d;
  RETURN total;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEED DATA
-- ============================================

INSERT INTO public.categories (name, slug, display_order) VALUES
  ('Crypto Exchange', 'crypto', 1),
  ('Wallet', 'wallets', 2),
  ('DeFi', 'defi', 3),
  ('AI Tool', 'ai', 4),
  ('Wellness', 'wellness', 5),
  ('Business', 'business', 6),
  ('Education', 'education', 7),
  ('Regenerative Living', 'regenerative', 8);

INSERT INTO public.allocation_models (name, community_rewards_pct, liquidity_pct, buybacks_pct, projects_pct, operations_pct, is_active, effective_date) VALUES
  ('Initial Model 2025', 40, 25, 15, 10, 10, true, '2025-01-01');

INSERT INTO public.projects (name, description, funding_goal, amount_allocated, status, impact_statement, display_order) VALUES
  ('New Earth Healing Clinic', 'A regenerative healing centre offering holistic therapies and accessible community wellness programs.', 50000, 12000, 'active', 'Every referral click helps fund accessible healing for people who need it most.', 1),
  ('Token Liquidity Building', 'Sustained allocation to liquidity pools ensures smoother trading and market depth for bitxbit.', NULL, 8500, 'active', 'Building healthy markets, bit by bit.', 2),
  ('Token Buyback Reserve', 'A portion of affiliate income is used to purchase bitxbit from the open market.', NULL, 6200, 'active', 'Community-supported stability mechanism.', 3);
