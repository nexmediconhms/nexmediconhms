-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: Revenue Lifecycle Tracking Columns
-- 
-- Adds visit_status and revenue_status columns to enable the revenue
-- pipeline tracking: Follow-up → Appointment → Visit → Bill → Payment → Revenue
--
-- SAFE TO RE-RUN: Uses IF NOT EXISTS / column existence checks.
-- RUN IN: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Add visit_status to appointments ─────────────────────────────
-- Tracks: scheduled → arrived → in_progress → completed → no_show → cancelled
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'appointments' AND column_name = 'visit_status'
  ) THEN
    ALTER TABLE appointments ADD COLUMN visit_status TEXT DEFAULT 'scheduled';
  END IF;
END $$;

COMMENT ON COLUMN appointments.visit_status IS 'Revenue lifecycle: scheduled | arrived | in_progress | completed | no_show | cancelled';

-- ── 2. Add revenue_status to encounters ─────────────────────────────
-- Tracks: pending → billed → paid → not_billed → lost_revenue → waived
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'encounters' AND column_name = 'revenue_status'
  ) THEN
    ALTER TABLE encounters ADD COLUMN revenue_status TEXT DEFAULT 'pending';
  END IF;
END $$;

COMMENT ON COLUMN encounters.revenue_status IS 'Revenue lifecycle: pending | billed | paid | not_billed | lost_revenue | waived';

-- ── 3. Add bill_id to encounters (links encounter → bill) ──────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'encounters' AND column_name = 'bill_id'
  ) THEN
    ALTER TABLE encounters ADD COLUMN bill_id UUID DEFAULT NULL;
  END IF;
END $$;

-- ── 4. Create index for revenue reporting queries ───────────────────
CREATE INDEX IF NOT EXISTS idx_appointments_visit_status
  ON appointments(date, visit_status);

CREATE INDEX IF NOT EXISTS idx_encounters_revenue_status
  ON encounters(encounter_date, revenue_status);

-- ── 5. Backfill existing data ───────────────────────────────────────
-- Mark all completed appointments as visit_status = 'completed'
UPDATE appointments
SET visit_status = 'completed'
WHERE status = 'completed' AND visit_status IS NULL;

-- Mark all no-show appointments
UPDATE appointments
SET visit_status = 'no_show'
WHERE status = 'no-show' AND visit_status IS NULL;

-- Mark all cancelled appointments
UPDATE appointments
SET visit_status = 'cancelled'
WHERE status = 'cancelled' AND visit_status IS NULL;

-- Mark encounters that have corresponding bills as 'billed'
UPDATE encounters e
SET revenue_status = 'billed'
WHERE EXISTS (
  SELECT 1 FROM bills b
  WHERE b.patient_id = e.patient_id
  AND b.created_at::date = e.encounter_date::date
)
AND e.revenue_status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════
-- DONE. Revenue lifecycle columns are now available.
-- The application code in src/lib/revenue-lifecycle.ts uses these columns.
-- ═══════════════════════════════════════════════════════════════════════
