-- Phase 1 security foundation (forward-only, data-preserving).
-- This migration intentionally keeps public.users.role/status for compatibility while
-- moving authorization decisions to public.user_authorizations.

-- -----------------------------------------------------------------------------
-- Protected authorization state
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_authorizations (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  can_manage_users BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_rewards BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_content BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_financials BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_security BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_authorizations'::regclass
      AND conname = 'user_authorizations_role_check'
  ) THEN
    ALTER TABLE public.user_authorizations
      ADD CONSTRAINT user_authorizations_role_check
      CHECK (role IN ('member', 'admin')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_authorizations'::regclass
      AND conname = 'user_authorizations_status_check'
  ) THEN
    ALTER TABLE public.user_authorizations
      ADD CONSTRAINT user_authorizations_status_check
      CHECK (status IN ('active', 'suspended', 'deactivated')) NOT VALID;
  END IF;
END $$;

-- Keep the compatibility column capable of representing the protected status values.
DO $$
DECLARE
  current_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_definition
  FROM pg_constraint
  WHERE conrelid = 'public.users'::regclass
    AND conname = 'users_status_check';

  IF current_definition IS NULL OR current_definition NOT ILIKE '%deactivated%' THEN
    ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_check;
    ALTER TABLE public.users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'suspended', 'deactivated')) NOT VALID;
  END IF;
END $$;

INSERT INTO public.user_authorizations (
  user_id,
  role,
  status,
  can_manage_users,
  can_manage_rewards,
  can_manage_content,
  can_manage_financials,
  can_manage_security
)
SELECT
  id,
  role,
  status,
  role = 'admin',
  role = 'admin',
  role = 'admin',
  role = 'admin',
  role = 'admin'
FROM public.users
ON CONFLICT (user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_user_authorizations_role_status
  ON public.user_authorizations (role, status);
CREATE INDEX IF NOT EXISTS idx_user_authorizations_active_admin
  ON public.user_authorizations (user_id)
  WHERE role = 'admin' AND status = 'active';

ALTER TABLE public.user_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_authorizations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_authorizations TO service_role;

-- -----------------------------------------------------------------------------
-- Fixed-search-path authorization helpers. These avoid policy recursion because
-- the table owner executes the protected lookup rather than the calling role.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_authorizations AS ua
    WHERE ua.user_id = auth.uid()
      AND ua.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_authorizations AS ua
    WHERE ua.user_id = auth.uid()
      AND ua.role = 'admin'
      AND ua.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_authorization_capability(capability TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_authorizations AS ua
    WHERE ua.user_id = auth.uid()
      AND ua.status = 'active'
      AND CASE capability
        WHEN 'manage_users' THEN ua.can_manage_users
        WHEN 'manage_rewards' THEN ua.can_manage_rewards
        WHEN 'manage_content' THEN ua.can_manage_content
        WHEN 'manage_financials' THEN ua.can_manage_financials
        WHEN 'manage_security' THEN ua.can_manage_security
        ELSE FALSE
      END
  );
$$;

-- Narrow RPC for middleware/SSR. It returns only the caller's authorization row.
CREATE OR REPLACE FUNCTION public.get_my_authorization()
RETURNS TABLE (
  user_id UUID,
  role TEXT,
  status TEXT,
  can_manage_users BOOLEAN,
  can_manage_rewards BOOLEAN,
  can_manage_content BOOLEAN,
  can_manage_financials BOOLEAN,
  can_manage_security BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    ua.user_id,
    ua.role,
    ua.status,
    ua.can_manage_users,
    ua.can_manage_rewards,
    ua.can_manage_content,
    ua.can_manage_financials,
    ua.can_manage_security
  FROM public.user_authorizations AS ua
  WHERE ua.user_id = auth.uid();
$$;

ALTER FUNCTION public.is_active_user() OWNER TO postgres;
ALTER FUNCTION public.is_active_admin() OWNER TO postgres;
ALTER FUNCTION public.has_authorization_capability(TEXT) OWNER TO postgres;
ALTER FUNCTION public.get_my_authorization() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_authorization_capability(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_authorization() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_authorization_capability(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_authorization() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Compatibility synchronization and signup provisioning
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_user_authorization_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.user_authorizations (
    user_id,
    role,
    status,
    can_manage_users,
    can_manage_rewards,
    can_manage_content,
    can_manage_financials,
    can_manage_security,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.role,
    NEW.status,
    NEW.role = 'admin',
    NEW.role = 'admin',
    NEW.role = 'admin',
    NEW.role = 'admin',
    NEW.role = 'admin',
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    can_manage_users = CASE
      WHEN EXCLUDED.role = 'member' THEN FALSE
      WHEN public.user_authorizations.role <> 'admin' THEN TRUE
      ELSE public.user_authorizations.can_manage_users
    END,
    can_manage_rewards = CASE
      WHEN EXCLUDED.role = 'member' THEN FALSE
      WHEN public.user_authorizations.role <> 'admin' THEN TRUE
      ELSE public.user_authorizations.can_manage_rewards
    END,
    can_manage_content = CASE
      WHEN EXCLUDED.role = 'member' THEN FALSE
      WHEN public.user_authorizations.role <> 'admin' THEN TRUE
      ELSE public.user_authorizations.can_manage_content
    END,
    can_manage_financials = CASE
      WHEN EXCLUDED.role = 'member' THEN FALSE
      WHEN public.user_authorizations.role <> 'admin' THEN TRUE
      ELSE public.user_authorizations.can_manage_financials
    END,
    can_manage_security = CASE
      WHEN EXCLUDED.role = 'member' THEN FALSE
      WHEN public.user_authorizations.role <> 'admin' THEN TRUE
      ELSE public.user_authorizations.can_manage_security
    END,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_from_user_authorization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.users
  SET role = NEW.role,
      status = NEW.status
  WHERE id = NEW.user_id
    AND (role, status) IS DISTINCT FROM (NEW.role, NEW.status);
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_user_authorization_from_profile() OWNER TO postgres;
ALTER FUNCTION public.sync_profile_from_user_authorization() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_user_authorization_from_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_profile_from_user_authorization() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_user_authorization_from_profile ON public.users;
CREATE TRIGGER sync_user_authorization_from_profile
  AFTER INSERT OR UPDATE OF role, status ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_authorization_from_profile();

DROP TRIGGER IF EXISTS sync_profile_from_user_authorization ON public.user_authorizations;
CREATE TRIGGER sync_profile_from_user_authorization
  AFTER INSERT OR UPDATE OF role, status ON public.user_authorizations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_from_user_authorization();

CREATE OR REPLACE FUNCTION public.generate_referral_code(input_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  base TEXT;
  suffix TEXT;
  candidate TEXT;
BEGIN
  base := lower(split_part(input_email, '@', 1));
  base := regexp_replace(base, '[^a-z0-9]', '', 'g');
  base := left(base, 10);

  LOOP
    suffix := substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    candidate := base || '-' || suffix;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.users WHERE referral_code = candidate
    );
  END LOOP;

  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  requested_referrer UUID;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'referred_by', '') ~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    requested_referrer := (NEW.raw_user_meta_data->>'referred_by')::UUID;
  END IF;

  INSERT INTO public.users (
    id,
    email,
    display_name,
    email_verified,
    referral_code,
    referred_by
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email_confirmed_at IS NOT NULL,
    public.generate_referral_code(NEW.email),
    requested_referrer
  );

  INSERT INTO public.user_authorizations (user_id, role, status)
  VALUES (NEW.id, 'member', 'active')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.generate_referral_code(TEXT) OWNER TO postgres;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.generate_referral_code(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Append-only audit foundation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID,
  actor_role TEXT,
  actor_status TEXT,
  actor_authorization JSONB NOT NULL DEFAULT '{}'::JSONB,
  action TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT,
  before_data JSONB,
  after_data JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  request_id TEXT,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.security_audit_log
  ADD COLUMN IF NOT EXISTS actor_role TEXT,
  ADD COLUMN IF NOT EXISTS actor_status TEXT,
  ADD COLUMN IF NOT EXISTS actor_authorization JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Actor IDs are immutable historical attribution, not a live relationship. Remove any
-- prior FK so deleting an auth user cannot rewrite old audit rows to NULL.
DO $$
DECLARE
  actor_fk RECORD;
BEGIN
  FOR actor_fk IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.security_audit_log'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.security_audit_log'::regclass
           AND attname = 'actor_id')
      ]::SMALLINT[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.security_audit_log DROP CONSTRAINT %I',
      actor_fk.conname
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_security_audit_log_created_at
  ON public.security_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_actor_id
  ON public.security_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_target
  ON public.security_audit_log (target_table, target_id, created_at DESC);

ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.security_audit_log FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.security_audit_log FROM service_role;
GRANT SELECT ON TABLE public.security_audit_log TO authenticated;
GRANT SELECT, INSERT ON TABLE public.security_audit_log TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_security_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'security audit rows are immutable';
END;
$$;
ALTER FUNCTION public.prevent_security_audit_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_security_audit_mutation() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS prevent_security_audit_mutation ON public.security_audit_log;
CREATE TRIGGER prevent_security_audit_mutation
  BEFORE UPDATE OR DELETE ON public.security_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_security_audit_mutation();

DROP POLICY IF EXISTS "Security audit active admins read" ON public.security_audit_log;
CREATE POLICY "Security audit active admins read"
  ON public.security_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin());

CREATE OR REPLACE FUNCTION public.write_security_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_row JSONB;
  new_row JSONB;
  target_row JSONB;
  request_headers JSONB;
  actor_authorization_row public.user_authorizations%ROWTYPE;
BEGIN
  old_row := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  new_row := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  target_row := COALESCE(new_row, old_row, '{}'::JSONB);

  BEGIN
    request_headers := NULLIF(current_setting('request.headers', TRUE), '')::JSONB;
  EXCEPTION WHEN OTHERS THEN
    request_headers := '{}'::JSONB;
  END;

  SELECT * INTO actor_authorization_row
  FROM public.user_authorizations
  WHERE user_id = auth.uid();

  INSERT INTO public.security_audit_log (
    actor_id,
    actor_role,
    actor_status,
    actor_authorization,
    action,
    target_table,
    target_id,
    before_data,
    after_data,
    metadata,
    request_id,
    success
  )
  VALUES (
    auth.uid(),
    actor_authorization_row.role,
    actor_authorization_row.status,
    CASE
      WHEN actor_authorization_row.user_id IS NULL THEN '{}'::JSONB
      ELSE jsonb_build_object(
        'can_manage_users', actor_authorization_row.can_manage_users,
        'can_manage_rewards', actor_authorization_row.can_manage_rewards,
        'can_manage_content', actor_authorization_row.can_manage_content,
        'can_manage_financials', actor_authorization_row.can_manage_financials,
        'can_manage_security', actor_authorization_row.can_manage_security
      )
    END,
    lower(TG_OP),
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    COALESCE(target_row->>'id', target_row->>'user_id'),
    old_row,
    new_row,
    jsonb_build_object('database_role', current_user),
    COALESCE(
      request_headers->>'x-request-id',
      request_headers->>'x-correlation-id'
    ),
    TRUE
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'security audit trigger failed for %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.write_security_audit_trigger() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.write_security_audit_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_users_security_changes ON public.users;
CREATE TRIGGER audit_users_security_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.write_security_audit_trigger();

DROP TRIGGER IF EXISTS audit_user_authorizations_changes ON public.user_authorizations;
CREATE TRIGGER audit_user_authorizations_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.user_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.write_security_audit_trigger();

DROP TRIGGER IF EXISTS audit_affiliate_income_changes ON public.affiliate_income;
CREATE TRIGGER audit_affiliate_income_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.affiliate_income
  FOR EACH ROW EXECUTE FUNCTION public.write_security_audit_trigger();

DROP TRIGGER IF EXISTS audit_reward_period_changes ON public.reward_periods;
CREATE TRIGGER audit_reward_period_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.reward_periods
  FOR EACH ROW EXECUTE FUNCTION public.write_security_audit_trigger();

DROP TRIGGER IF EXISTS audit_user_reward_changes ON public.user_rewards;
CREATE TRIGGER audit_user_reward_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.user_rewards
  FOR EACH ROW EXECUTE FUNCTION public.write_security_audit_trigger();

-- -----------------------------------------------------------------------------
-- Exact grants and hardened policies
-- -----------------------------------------------------------------------------
REVOKE UPDATE ON TABLE public.users FROM authenticated;
GRANT UPDATE (display_name) ON TABLE public.users TO authenticated;
REVOKE INSERT ON TABLE public.user_activities FROM authenticated;

ALTER TABLE public.user_activities
  ADD COLUMN IF NOT EXISTS trusted_source TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_user_activities_click_dedupe
  ON public.user_activities (user_id, offer_id, created_at DESC)
  WHERE activity_type = 'click';

CREATE OR REPLACE FUNCTION public.record_trusted_offer_click(
  p_user_id UUID,
  p_offer_id UUID,
  p_expected_url TEXT,
  p_dedupe_seconds INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  canonical_url TEXT;
BEGIN
  IF p_dedupe_seconds < 1 OR p_dedupe_seconds > 300 THEN
    RAISE EXCEPTION 'invalid click dedupe window';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT || ':' || p_offer_id::TEXT, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.user_authorizations
    WHERE user_id = p_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'active user authorization required';
  END IF;

  SELECT referral_url INTO canonical_url
  FROM public.affiliate_offers
  WHERE id = p_offer_id AND active = TRUE;

  IF canonical_url IS NULL OR canonical_url IS DISTINCT FROM p_expected_url THEN
    RAISE EXCEPTION 'active offer and URL relationship could not be verified';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_activities
    WHERE user_id = p_user_id
      AND offer_id = p_offer_id
      AND activity_type = 'click'
      AND created_at >= NOW() - make_interval(secs => p_dedupe_seconds)
  ) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.user_activities (
    user_id,
    offer_id,
    activity_type,
    source_url,
    trusted_source,
    verified_at
  ) VALUES (
    p_user_id,
    p_offer_id,
    'click',
    canonical_url,
    'server_action',
    NOW()
  );
  RETURN TRUE;
END;
$$;
ALTER FUNCTION public.record_trusted_offer_click(UUID, UUID, TEXT, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_trusted_offer_click(UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_trusted_offer_click(UUID, UUID, TEXT, INTEGER)
  TO service_role;

DROP POLICY IF EXISTS "Users read own" ON public.users;
DROP POLICY IF EXISTS "Users read referred" ON public.users;
DROP POLICY IF EXISTS "Users update own" ON public.users;
DROP POLICY IF EXISTS "Users protected read" ON public.users;
DROP POLICY IF EXISTS "Users update safe profile" ON public.users;

CREATE POLICY "Users protected read"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (
    public.is_active_admin()
    OR (public.is_active_user() AND (id = auth.uid() OR referred_by = auth.uid()))
  );

CREATE POLICY "Users update safe profile"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (public.is_active_user() AND id = auth.uid())
  WITH CHECK (public.is_active_user() AND id = auth.uid());

DROP POLICY IF EXISTS "Categories admin write" ON public.categories;
CREATE POLICY "Categories admin write"
  ON public.categories FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

DROP POLICY IF EXISTS "Offers admin all" ON public.affiliate_offers;
CREATE POLICY "Offers admin all"
  ON public.affiliate_offers FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

DROP POLICY IF EXISTS "Activities read own" ON public.user_activities;
DROP POLICY IF EXISTS "Activities insert own" ON public.user_activities;
DROP POLICY IF EXISTS "Activities protected read" ON public.user_activities;
CREATE POLICY "Activities protected read"
  ON public.user_activities FOR SELECT TO authenticated
  USING (
    public.is_active_admin()
    OR (public.is_active_user() AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Income admin all" ON public.affiliate_income;
CREATE POLICY "Income admin all"
  ON public.affiliate_income FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

DROP POLICY IF EXISTS "Allocations admin write" ON public.allocation_models;
CREATE POLICY "Allocations admin write"
  ON public.allocation_models FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

DROP POLICY IF EXISTS "Periods admin write" ON public.reward_periods;
CREATE POLICY "Periods admin write"
  ON public.reward_periods FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

DROP POLICY IF EXISTS "Rewards read own" ON public.user_rewards;
DROP POLICY IF EXISTS "Rewards admin write" ON public.user_rewards;
DROP POLICY IF EXISTS "Rewards protected read" ON public.user_rewards;
CREATE POLICY "Rewards protected read"
  ON public.user_rewards FOR SELECT TO authenticated
  USING (
    public.is_active_admin()
    OR (public.is_active_user() AND user_id = auth.uid())
  );
CREATE POLICY "Rewards admin write"
  ON public.user_rewards FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

DROP POLICY IF EXISTS "Projects admin write" ON public.projects;
CREATE POLICY "Projects admin write"
  ON public.projects FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

DROP POLICY IF EXISTS "Reports admin write" ON public.transparency_reports;
CREATE POLICY "Reports admin write"
  ON public.transparency_reports FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

-- Public reads remain; authenticated storage mutations are removed. Trusted server
-- actions continue to use the service role for asset writes.
DROP POLICY IF EXISTS "Assets authenticated insert" ON storage.objects;
DROP POLICY IF EXISTS "Assets authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "Assets authenticated delete" ON storage.objects;
REVOKE INSERT, UPDATE, DELETE ON TABLE storage.objects FROM authenticated;

-- -----------------------------------------------------------------------------
-- New-write integrity checks. NOT VALID preserves existing rows while enforcing
-- the rules for future inserts and updates.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.affiliate_income'::regclass AND conname = 'affiliate_income_amount_nonnegative') THEN
    ALTER TABLE public.affiliate_income ADD CONSTRAINT affiliate_income_amount_nonnegative CHECK (amount >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reward_periods'::regclass AND conname = 'reward_periods_date_order') THEN
    ALTER TABLE public.reward_periods ADD CONSTRAINT reward_periods_date_order CHECK (end_date >= start_date) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reward_periods'::regclass AND conname = 'reward_periods_total_income_nonnegative') THEN
    ALTER TABLE public.reward_periods ADD CONSTRAINT reward_periods_total_income_nonnegative CHECK (total_income >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_rewards'::regclass AND conname = 'user_rewards_estimated_value_nonnegative') THEN
    ALTER TABLE public.user_rewards ADD CONSTRAINT user_rewards_estimated_value_nonnegative CHECK (estimated_aud_value IS NULL OR estimated_aud_value >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_rewards'::regclass AND conname = 'user_rewards_token_amount_nonnegative') THEN
    ALTER TABLE public.user_rewards ADD CONSTRAINT user_rewards_token_amount_nonnegative CHECK (bitxbit_amount IS NULL OR bitxbit_amount >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.projects'::regclass AND conname = 'projects_funding_goal_nonnegative') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_funding_goal_nonnegative CHECK (funding_goal IS NULL OR funding_goal >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.projects'::regclass AND conname = 'projects_amount_allocated_nonnegative') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_amount_allocated_nonnegative CHECK (amount_allocated >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.transparency_reports'::regclass AND conname = 'transparency_total_income_nonnegative') THEN
    ALTER TABLE public.transparency_reports ADD CONSTRAINT transparency_total_income_nonnegative CHECK (total_income IS NULL OR total_income >= 0) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reward_periods_dates
  ON public.reward_periods (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_user_rewards_period_status
  ON public.user_rewards (reward_period_id, status);
CREATE INDEX IF NOT EXISTS idx_affiliate_income_offer_date
  ON public.affiliate_income (offer_id, date_received);
