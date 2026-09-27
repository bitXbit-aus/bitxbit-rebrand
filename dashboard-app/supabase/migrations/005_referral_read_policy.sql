-- Allow members to see the users they referred on their Referrals dashboard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'Users read referred'
  ) THEN
    CREATE POLICY "Users read referred" ON public.users
      FOR SELECT USING (referred_by = auth.uid());
  END IF;
END
$$;
