-- Remove duplicate project rows, keeping the most recently created instance of each name.
-- The marketing ecosystem page renders the first project returned by /api/public/projects,
-- which orders by display_order then created_at DESC, so the newest row per name is the live one.
DELETE FROM public.projects
WHERE id IN (
  SELECT id
  FROM (
    SELECT id, name, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at DESC) AS rn
    FROM public.projects
  ) ranked
  WHERE rn > 1
);
