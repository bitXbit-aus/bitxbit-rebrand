-- ============================================
-- CLEANUP ALLOCATION MODELS
-- Remove duplicate allocation models and rename
-- the remaining active model to the 2026 initial model.
-- ============================================

-- Keep only the newest active allocation model; deactivate any others first
-- to satisfy FK constraints if reward periods reference them.
UPDATE public.allocation_models
SET is_active = false
WHERE is_active = true
  AND id NOT IN (
    SELECT id
    FROM public.allocation_models
    WHERE is_active = true
    ORDER BY effective_date DESC, created_at DESC
    LIMIT 1
  );

-- Delete inactive duplicate allocation models that are not referenced by reward periods.
DELETE FROM public.allocation_models
WHERE is_active = false
  AND id NOT IN (
    SELECT DISTINCT allocation_model_id
    FROM public.reward_periods
    WHERE allocation_model_id IS NOT NULL
  );

-- Rename the remaining active model to the 2026 initial model.
UPDATE public.allocation_models
SET
  name = 'Initial Model 2026 effective from 29th of September 2026',
  effective_date = '2026-09-29'
WHERE is_active = true;
