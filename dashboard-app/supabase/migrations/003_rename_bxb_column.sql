-- Rename bxb_amount to bitxbit_amount to align with token branding
ALTER TABLE public.user_rewards RENAME COLUMN bxb_amount TO bitxbit_amount;
