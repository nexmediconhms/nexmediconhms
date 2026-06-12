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
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='appointments') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'appointments' AND column_name = 'visit_status'
    ) THEN
      ALTER TABLE appointments ADD COLUMN visit_status TEXT DEFAULT 'scheduled';
    END IF;
    EXECUTE 'COMMENT ON COLUMN appointments.visit_status IS ''Revenue lifecycle: scheduled | arrived | in_progress | completed | no_show | cancelled''';
  END IF;
END $$;

-- ── 2. Add revenue_status to encounters ─────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='encounters') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'encounters' AND column_name = 'revenue_status'
    ) THEN
      ALTER TABLE encounters ADD COLUMN revenue_status TEXT DEFAULT 'pending';
    END IF;
    EXECUTE 'COMMENT ON COLUMN encounters.revenue_status IS ''Revenue lifecycle: pending | billed | paid | not_billed | lost_revenue | waived''';

    -- bill_id linking column
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'encounters' AND column_name = 'bill_id'
    ) THEN
      ALTER TABLE encounters ADD COLUMN bill_id UUID DEFAULT NULL;
    END IF;
  END IF;
END $$;

-- ── 4. Create indexes for revenue reporting (column-aware) ──────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='appointments'
               AND column_name='visit_status')
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='appointments'
                AND column_name='date') THEN
    CREATE INDEX IF NOT EXISTS idx_appointments_visit_status
      ON appointments(date, visit_status);
  END IF;

  -- Encounter date column may be `encounter_date` (snake_case) or `date` (v00)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='encounters'
               AND column_name='revenue_status') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='encounters'
                 AND column_name='encounter_date') THEN
      CREATE INDEX IF NOT EXISTS idx_encounters_revenue_status
        ON encounters(encounter_date, revenue_status);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='encounters'
                    AND column_name='date') THEN
      CREATE INDEX IF NOT EXISTS idx_encounters_revenue_status
        ON encounters(date, revenue_status);
    END IF;
  END IF;
END $$;

-- ── 5. Backfill existing data (column-aware) ────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='appointments'
               AND column_name='visit_status') THEN
    UPDATE appointments SET visit_status = 'completed' WHERE status = 'completed' AND visit_status IS NULL;
    UPDATE appointments SET visit_status = 'no_show'   WHERE status = 'no-show'   AND visit_status IS NULL;
    UPDATE appointments SET visit_status = 'cancelled' WHERE status = 'cancelled' AND visit_status IS NULL;
  END IF;

  -- Mark encounters with matching bills as billed.
  -- patient_id may be column patient_id (snake_case) OR patientid (v00).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='bills')
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='encounters' AND column_name='revenue_status') THEN

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='encounters' AND column_name='patient_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='encounters' AND column_name='encounter_date')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='bills' AND column_name='patient_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='bills' AND column_name='created_at') THEN
      EXECUTE $sql$
        UPDATE encounters e
           SET revenue_status = 'billed'
         WHERE EXISTS (
           SELECT 1 FROM bills b
            WHERE b.patient_id = e.patient_id
              AND b.created_at::date = e.encounter_date::date
         )
         AND e.revenue_status = 'pending'
      $sql$;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='encounters' AND column_name='patientid')
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='encounters' AND column_name='date')
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='bills' AND column_name='patientid')
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='bills' AND column_name='createdat') THEN
      EXECUTE $sql$
        UPDATE encounters e
           SET revenue_status = 'billed'
         WHERE EXISTS (
           SELECT 1 FROM bills b
            WHERE b.patientid = e.patientid
              AND b.createdat::date = e.date::date
         )
         AND e.revenue_status = 'pending'
      $sql$;
    END IF;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- DONE. Revenue lifecycle columns are now available.
-- The application code in src/lib/revenue-lifecycle.ts uses these columns.
-- ═══════════════════════════════════════════════════════════════════════
