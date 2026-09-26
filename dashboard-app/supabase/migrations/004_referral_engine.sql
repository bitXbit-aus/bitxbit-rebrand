-- Referral engine: add referral tracking to users table

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_referred_by ON public.users(referred_by);

-- Function to generate a unique referral code
CREATE OR REPLACE FUNCTION public.generate_referral_code(input_email TEXT)
RETURNS TEXT AS $$
DECLARE
  base TEXT;
  suffix TEXT;
  candidate TEXT;
  exists_check BOOLEAN;
BEGIN
  base := lower(split_part(input_email, '@', 1));
  base := regexp_replace(base, '[^a-z0-9]', '', 'g');
  base := left(base, 10);

  LOOP
    suffix := substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    candidate := base || '-' || suffix;
    SELECT EXISTS (SELECT 1 FROM public.users WHERE referral_code = candidate) INTO exists_check;
    EXIT WHEN NOT exists_check;
  END LOOP;

  RETURN candidate;
END;
$$ LANGUAGE plpgsql;

-- Backfill existing users with referral codes
UPDATE public.users
SET referral_code = public.generate_referral_code(email)
WHERE referral_code IS NULL;

-- Update trigger to auto-generate referral code for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
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
    (NEW.raw_user_meta_data->>'referred_by')::UUID
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
