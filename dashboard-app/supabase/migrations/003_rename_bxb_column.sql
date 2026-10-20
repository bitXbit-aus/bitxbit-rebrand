-- Rename bxb_amount to bitxbit_amount to align with token branding.
-- Only run the rename on databases that still have the old column name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_rewards' AND column_name = 'bxb_amount'
  ) THEN
    ALTER TABLE public.user_rewards RENAME COLUMN bxb_amount TO bitxbit_amount;
  END IF;
END $$;
