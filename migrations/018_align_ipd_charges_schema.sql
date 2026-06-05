-- ═══════════════════════════════════════════════════════════════════════
-- migrations/018_align_ipd_charges_schema.sql
--
-- Aligns the `ipd_charges` and `ipd_charge_rates` tables with the columns
-- that the application code (src/app/ipd/[bedId]/billing/page.tsx) actually
-- writes / reads.
--
-- BACKGROUND
--   The original schema (see migrations/archive/fix-all-permissions.sql)
--   created these tables long before the structured IPD billing UI existed.
--   That early schema used:
--     ipd_charges       (item_name, category, amount, quantity, notes, created_at)
--     ipd_charge_rates  (name,      category, amount, unit,     is_active)
--
--   The current IPD billing page expects:
--     ipd_charges       (charge_date, description, category, quantity,
--                        rate, amount, notes, created_by, created_at)
--     ipd_charge_rates  (description, default_rate, per_unit, sort_order,
--                        is_active, category)
--
--   When you click "Auto-Add Bed + Nursing" on a Supabase project that
--   still has the early schema, PostgREST replies with:
--     "Could not find the 'charge_date' column of 'ipd_charges' in the
--      schema cache"
--   …and the insert fails. This migration brings the tables forward so
--   the application's modern path works.
--
-- IDEMPOTENCY
--   Every operation uses IF NOT EXISTS / IF EXISTS guards. You can run this
--   file as many times as you like — it converges on the desired state
--   without modifying rows that are already correct.
--
-- ROLLBACK
--   Adding nullable columns and backfilling them is non-destructive. If
--   you need to roll back you can DROP the new columns; existing data on
--   the legacy column names (item_name, name, amount on rates, etc.) is
--   preserved untouched.
--
-- AFTER RUNNING THIS
--   - Click "Auto-Add Bed + Nursing" in the IPD bill page → succeeds.
--   - Existing rows that were written through the legacy column names
--     keep displaying correctly (the app reads either name).
--   - Future writes go to the modern column names.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── ipd_charges ─────────────────────────────────────────────────────

-- Add the columns the app expects, all nullable / with safe defaults so
-- existing rows are not invalidated.
ALTER TABLE IF EXISTS public.ipd_charges
  ADD COLUMN IF NOT EXISTS charge_date DATE NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE IF EXISTS public.ipd_charges
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE IF EXISTS public.ipd_charges
  ADD COLUMN IF NOT EXISTS rate NUMERIC(10,2) DEFAULT 0;

ALTER TABLE IF EXISTS public.ipd_charges
  ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Back-fill: legacy rows had item_name (NOT NULL); the new code uses
-- description. Copy item_name into description so the UI shows the same
-- text for historical records.
UPDATE public.ipd_charges
   SET description = item_name
 WHERE description IS NULL
   AND item_name   IS NOT NULL;

-- Back-fill: rate can be derived from (amount / quantity) for legacy rows
-- where it wasn't recorded. Only fills NULL/zero rate; non-zero existing
-- values are kept intact.
UPDATE public.ipd_charges
   SET rate = CASE
                WHEN COALESCE(quantity, 0) > 0
                THEN ROUND(amount / quantity, 2)
                ELSE 0
              END
 WHERE COALESCE(rate, 0) = 0
   AND amount IS NOT NULL;

-- Back-fill: charge_date for legacy rows that didn't have one — use the
-- date portion of created_at as the best available proxy.
UPDATE public.ipd_charges
   SET charge_date = (created_at AT TIME ZONE 'Asia/Kolkata')::date
 WHERE charge_date IS NULL
   AND created_at IS NOT NULL;

-- Relax the legacy NOT NULL on item_name so future inserts that only
-- populate description don't fail. We keep the column for backward
-- compatibility (audit trail / historical reports may still reference it).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ipd_charges'
       AND column_name  = 'item_name'
       AND is_nullable  = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE public.ipd_charges ALTER COLUMN item_name DROP NOT NULL';
  END IF;
END $$;

-- Sync trigger: keep item_name and description aligned for new inserts /
-- updates. The trigger copies whichever is present into the other column,
-- so legacy reports that read item_name and modern UIs that read
-- description both see consistent data.
CREATE OR REPLACE FUNCTION public.ipd_charges_sync_legacy_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.description IS NULL AND NEW.item_name IS NOT NULL THEN
    NEW.description := NEW.item_name;
  END IF;
  IF NEW.item_name IS NULL AND NEW.description IS NOT NULL THEN
    NEW.item_name := NEW.description;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ipd_charges_sync_legacy_columns ON public.ipd_charges;
CREATE TRIGGER trg_ipd_charges_sync_legacy_columns
BEFORE INSERT OR UPDATE ON public.ipd_charges
FOR EACH ROW EXECUTE FUNCTION public.ipd_charges_sync_legacy_columns();

-- Helpful index for the per-admission, per-day "is this charge already
-- posted?" lookup that the auto-add routine uses.
CREATE INDEX IF NOT EXISTS idx_ipd_charges_admission_date
  ON public.ipd_charges (admission_id, charge_date);

-- ─── ipd_charge_rates ────────────────────────────────────────────────

-- Add the columns the app expects.
ALTER TABLE IF EXISTS public.ipd_charge_rates
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE IF EXISTS public.ipd_charge_rates
  ADD COLUMN IF NOT EXISTS default_rate NUMERIC(10,2);

ALTER TABLE IF EXISTS public.ipd_charge_rates
  ADD COLUMN IF NOT EXISTS per_unit TEXT DEFAULT 'per day';

ALTER TABLE IF EXISTS public.ipd_charge_rates
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Back-fill: legacy column `name` -> new `description`
UPDATE public.ipd_charge_rates
   SET description = name
 WHERE description IS NULL
   AND name        IS NOT NULL;

-- Back-fill: legacy column `amount` -> new `default_rate`
UPDATE public.ipd_charge_rates
   SET default_rate = amount
 WHERE default_rate IS NULL
   AND amount       IS NOT NULL;

-- Back-fill: legacy column `unit` -> new `per_unit`
UPDATE public.ipd_charge_rates
   SET per_unit = unit
 WHERE (per_unit IS NULL OR per_unit = 'per day')
   AND unit IS NOT NULL
   AND unit <> '';

-- Relax legacy NOT NULL on `name` so future inserts can use `description`
-- alone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ipd_charge_rates'
       AND column_name  = 'name'
       AND is_nullable  = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE public.ipd_charge_rates ALTER COLUMN name DROP NOT NULL';
  END IF;
END $$;

-- Sync trigger for the rates table — same pattern as ipd_charges.
CREATE OR REPLACE FUNCTION public.ipd_charge_rates_sync_legacy_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.description IS NULL AND NEW.name IS NOT NULL THEN
    NEW.description := NEW.name;
  END IF;
  IF NEW.name IS NULL AND NEW.description IS NOT NULL THEN
    NEW.name := NEW.description;
  END IF;

  IF NEW.default_rate IS NULL AND NEW.amount IS NOT NULL THEN
    NEW.default_rate := NEW.amount;
  END IF;
  IF NEW.amount IS NULL AND NEW.default_rate IS NOT NULL THEN
    NEW.amount := NEW.default_rate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ipd_charge_rates_sync_legacy_columns ON public.ipd_charge_rates;
CREATE TRIGGER trg_ipd_charge_rates_sync_legacy_columns
BEFORE INSERT OR UPDATE ON public.ipd_charge_rates
FOR EACH ROW EXECUTE FUNCTION public.ipd_charge_rates_sync_legacy_columns();

-- ─── Schema-cache invalidation ───────────────────────────────────────
-- Nudge PostgREST to refresh its schema cache so the newly added columns
-- are visible to the REST API immediately. Without this the application
-- can still report "column not found" for up to ~10 minutes after the
-- migration runs (PostgREST polls periodically).
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- HOW TO APPLY
--   1. Open Supabase Studio → SQL Editor.
--   2. Paste the contents of this file.
--   3. Click "Run".  All operations are wrapped in BEGIN/COMMIT, so a
--      partial failure rolls back cleanly without leaving the schema
--      half-migrated.
--   4. Reload the application; click "Auto-Add Bed + Nursing" in any
--      IPD bill — the previous "Could not find the 'charge_date' column"
--      error should be gone.
-- ═══════════════════════════════════════════════════════════════════════
