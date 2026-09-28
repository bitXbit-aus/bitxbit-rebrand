-- Update New Earth Healing Clinic funding goal and reset allocated amount
-- to match the current home page and marketing site values.
UPDATE public.projects
SET
  funding_goal = 250000,
  amount_allocated = 0
WHERE name = 'New Earth Healing Clinic';
