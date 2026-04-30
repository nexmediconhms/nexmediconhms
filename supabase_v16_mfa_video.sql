-- ============================================================
-- supabase_v16_mfa_video.sql   (FIXED)
-- NexMedicon HMS — MFA tracking + Video consultation improvements
-- Run AFTER all previous migrations (v1 through v15)
--
-- FIX vs previous version:
--   The old version tried to DROP and RECREATE the appointments
--   status CHECK constraint with new values, which violated
--   existing rows that already had statuses like 'scheduled',
--   'confirmed', 'no-show'. The new approach:
--   1. Drops the old constraint (no data loss)
--   2. Re-adds it with ALL valid values (old + new combined)
--   This is safe — existing data is never touched.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. MFA tracking columns on clinic_users
-- ────────────────────────────────────────────────────────────

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS mfa_enabled     BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN clinic_users.mfa_enabled
  IS 'True when the user has a verified TOTP factor enrolled in Supabase Auth';
COMMENT ON COLUMN clinic_users.mfa_enrolled_at
  IS 'Timestamp when MFA was first verified (not just enrolled)';

-- ────────────────────────────────────────────────────────────
-- 2. Video / call columns on appointments
-- ────────────────────────────────────────────────────────────

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS video_link        TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS video_room_id     TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS call_started_at   TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS call_ended_at     TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS call_duration_min INTEGER     DEFAULT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. FIX: Replace the status CHECK constraint safely
--
--    The original appointments table (v9) used:
--      CHECK (status IN ('scheduled','confirmed','completed','cancelled','no-show'))
--
--    The video page uses: 'open', 'video'
--    The new video features need: 'missed'
--
--    We drop the OLD constraint and recreate it with the full
--    union of all values.  Existing rows are NEVER changed.
-- ────────────────────────────────────────────────────────────

-- Drop whichever constraint name was used (v9 or earlier)
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_status_check;

-- Also try the Postgres auto-generated name (format: <table>_<col>_check)
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_status_check1;

-- Recreate with ALL values: original + video-page values
ALTER TABLE appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN (
    -- Original v9 values
    'scheduled',
    'confirmed',
    'completed',
    'cancelled',
    'no-show',
    -- Video-page values
    'open',
    'video',
    -- New values added by this migration
    'missed'
  ));

-- ────────────────────────────────────────────────────────────
-- 4. Performance indexes for video appointment queries
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_appointments_video_type_date
  ON appointments (date, time)
  WHERE type = 'video';

CREATE INDEX IF NOT EXISTS idx_appointments_status_type
  ON appointments (status, type);

-- ────────────────────────────────────────────────────────────
-- 5. Trigger: auto-calculate call_duration_min when call ends
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_calculate_call_duration()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.call_ended_at IS NOT NULL AND NEW.call_started_at IS NOT NULL THEN
    NEW.call_duration_min :=
      ROUND(EXTRACT(EPOCH FROM (NEW.call_ended_at - NEW.call_started_at)) / 60)::INTEGER;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_call_duration ON appointments;
CREATE TRIGGER trg_call_duration
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  WHEN (NEW.call_ended_at IS NOT NULL)
  EXECUTE FUNCTION fn_calculate_call_duration();

-- ────────────────────────────────────────────────────────────
-- 6. View: upcoming video consultations (dashboard widget)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_upcoming_video_consults AS
SELECT
  a.id,
  a.date,
  a.time,
  a.status,
  a.patient_name,
  a.mrn,
  a.mobile,
  a.doctor_name,
  a.video_link,
  a.notes,
  a.call_duration_min
FROM appointments a
WHERE
  a.type  = 'video'
  AND a.date >= CURRENT_DATE
  AND a.status NOT IN ('completed', 'missed', 'cancelled')
ORDER BY a.date, a.time;

-- ────────────────────────────────────────────────────────────
-- 7. RLS policies for appointments (idempotent)
-- ────────────────────────────────────────────────────────────

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user
DROP POLICY IF EXISTS appts_read   ON appointments;
CREATE POLICY appts_read ON appointments
  FOR SELECT TO authenticated USING (true);

-- INSERT: any authenticated user
DROP POLICY IF EXISTS appts_insert ON appointments;
CREATE POLICY appts_insert ON appointments
  FOR INSERT TO authenticated WITH CHECK (true);

-- UPDATE: any authenticated user
DROP POLICY IF EXISTS appts_update ON appointments;
CREATE POLICY appts_update ON appointments
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- DELETE: admin + doctor only
DROP POLICY IF EXISTS appts_delete ON appointments;
CREATE POLICY appts_delete ON appointments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.auth_id = auth.uid()
        AND cu.role IN ('admin', 'doctor')
    )
  );

-- ────────────────────────────────────────────────────────────
-- 8. Realtime note
--    Enable in Supabase Dashboard → Database → Replication
--    OR uncomment the line below (requires superuser):
-- ALTER PUBLICATION supabase_realtime ADD TABLE appointments;
-- ────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────
-- DONE ✓
-- After running this migration:
--   1. Enable Realtime for 'appointments' in Supabase Dashboard
--   2. Deploy src/app/login/page.tsx  (MFA UI)
--   3. Deploy src/lib/mfa.ts          (AAL2 fix)
--   4. Deploy src/app/video/page.tsx  (in-app iframe + realtime)
--   5. Protect API routes (see src/lib/api-auth.ts)
-- ────────────────────────────────────────────────────────────

SELECT 'v16 MFA + Video migration complete ✓' AS result;
