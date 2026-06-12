-- ═══════════════════════════════════════════════════════════════════════
-- migrations/019_align_ipd_admissions_bill_columns.sql
--
-- Aligns the `ipd_admissions` table with the columns the IPD billing UI
-- writes when "Save Bill" is clicked.
--
-- BACKGROUND
--   The early ipd_admissions schema (see migrations/archive/fix-all-permissions.sql)
--   carried only the clinical columns (admission_date, discharge_date,
--   diagnosis, etc).  When the structured IPD billing UI was added later
--   it began updating these additional columns on saveBill():
--       total_charges, discount, net_bill, bill_status, payment_mode
--
--   Supabase projects that haven't yet picked up those columns return:
--       "Could not find the 'bill_status' column of 'ipd_admissions'
--        in the schema cache"
--   …and the entire saveBill() call fails — even though the IPD charge
--   line items (in ipd_charges) saved fine.  This migration brings the
--   table forward so saveBill() succeeds, and PostgREST sees the new
--   columns immediately via NOTIFY pgrst.
--
-- IDEMPOTENCY
--   Every operation uses ADD COLUMN IF NOT EXISTS / IF EXISTS guards.
--   Safe to run multiple times.
--
-- ROLLBACK
--   Adding nullable columns is non-destructive.  If you need to roll
--   back you can DROP the new columns; existing data on legacy column
--   names is preserved.
--
-- AFTER RUNNING THIS
--   - "Save Bill" on the IPD bill page succeeds.
--   - Existing rows that don't have bill_status simply get NULL — the
--     UI treats NULL as 'pending' (legacy default).
--   - Future saves write to the new columns.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='ipd_admissions') THEN
    RAISE NOTICE 'ipd_admissions table missing — skipping migration 019';
    RETURN;
  END IF;

  -- ipd_admissions — billing columns
  ALTER TABLE public.ipd_admissions ADD COLUMN IF NOT EXISTS total_charges NUMERIC(12,2) DEFAULT 0;
  ALTER TABLE public.ipd_admissions ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) DEFAULT 0;
  ALTER TABLE public.ipd_admissions ADD COLUMN IF NOT EXISTS net_bill NUMERIC(12,2) DEFAULT 0;

  -- bill_status with check constraint — add column first, constraint guarded
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='ipd_admissions'
                   AND column_name='bill_status') THEN
    ALTER TABLE public.ipd_admissions ADD COLUMN bill_status TEXT
      CHECK (bill_status IS NULL OR bill_status IN
             ('pending','partial','paid','cancelled','waived'));
  END IF;

  ALTER TABLE public.ipd_admissions ADD COLUMN IF NOT EXISTS payment_mode TEXT;
  ALTER TABLE public.ipd_admissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

  -- Comments (only meaningful if columns now exist)
  EXECUTE 'COMMENT ON COLUMN public.ipd_admissions.total_charges IS ''Sum of all ipd_charges.amount for this admission. Written by IPD bill saveBill().''';
  EXECUTE 'COMMENT ON COLUMN public.ipd_admissions.discount IS ''Lump-sum discount applied to total_charges. Always non-negative; UI clamps to <= total_charges.''';
  EXECUTE 'COMMENT ON COLUMN public.ipd_admissions.net_bill IS ''total_charges - discount. This is the amount the patient owes for the IPD stay.''';
  EXECUTE 'COMMENT ON COLUMN public.ipd_admissions.bill_status IS ''pending = not yet collected, partial = partially paid, paid = fully paid, cancelled = bill voided, waived = forgiven. NULL is treated as pending.''';
  EXECUTE 'COMMENT ON COLUMN public.ipd_admissions.payment_mode IS ''cash | upi | card | mixed. Free-form for forward compatibility.''';

  -- Helpful index for "all unpaid IPD bills" / dashboard queries.
  CREATE INDEX IF NOT EXISTS idx_ipd_admissions_bill_status
    ON public.ipd_admissions (bill_status)
    WHERE bill_status IS NOT NULL;
END $$;

-- ─── Schema-cache invalidation ───────────────────────────────────────
-- Nudge PostgREST to refresh its schema cache so the newly added columns
-- are visible to the REST API immediately.  Without this the application
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
--   4. Reload the IPD bill page; click "Save Bill" — the previous
--      "Could not find the 'bill_status' column" error should be gone.
-- ═══════════════════════════════════════════════════════════════════════