-- ═══════════════════════════════════════════════════════════════
-- HMS Fixes Migration — v31
-- All fixes for the 5 issues reported:
-- 1. Module connectivity & extra-click audit
-- 2. Admin paid-bill modification
-- 3. Attractive PDF reports
-- 4. Lab Portal → patient profile + doctor/patient reminders
-- 5. Bug fixes
--
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE
-- ═══════════════════════════════════════════════════════════════

-- ── FIX 1: Bills — add gst fields if missing (needed by AdminBillModify) ──
ALTER TABLE bills ADD COLUMN IF NOT EXISTS gst_percent  NUMERIC(5,2)  DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS gst_amount   NUMERIC(10,2) DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ   DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_bills_patient    ON bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_status     ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_created_at ON bills(created_at DESC);

-- ── FIX 2: Reminders — CREATE table if it doesn't exist, then add columns ──
--
-- Use a single DO block so we never ALTER a table that doesn't exist yet.
-- Every branch is safe to run even if the table/column already exists.
DO $$
BEGIN

  -- ── 2a: Create reminders table if completely missing ──────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'reminders'
  ) THEN
    CREATE TABLE reminders (
      id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      patient_id    UUID        REFERENCES patients(id) ON DELETE CASCADE,
      message       TEXT,
      reminder_type TEXT        DEFAULT 'general',
      status        TEXT        DEFAULT 'pending',
      metadata      JSONB,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS allow_auth_reminders ON reminders;
    CREATE POLICY allow_auth_reminders ON reminders
      FOR ALL TO authenticated USING (true) WITH CHECK (true);

  ELSE
    -- ── 2b: Table exists — add missing columns one by one ────────────────

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'reminders' AND column_name = 'patient_id'
    ) THEN
      ALTER TABLE reminders ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'reminders' AND column_name = 'message'
    ) THEN
      ALTER TABLE reminders ADD COLUMN message TEXT;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'reminders' AND column_name = 'reminder_type'
    ) THEN
      ALTER TABLE reminders ADD COLUMN reminder_type TEXT DEFAULT 'general';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'reminders' AND column_name = 'status'
    ) THEN
      ALTER TABLE reminders ADD COLUMN status TEXT DEFAULT 'pending';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'reminders' AND column_name = 'metadata'
    ) THEN
      ALTER TABLE reminders ADD COLUMN metadata JSONB;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'reminders' AND column_name = 'updated_at'
    ) THEN
      ALTER TABLE reminders ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    -- Ensure RLS is on and policy exists
    ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS allow_auth_reminders ON reminders;
    CREATE POLICY allow_auth_reminders ON reminders
      FOR ALL TO authenticated USING (true) WITH CHECK (true);

  END IF;

END $$;

-- Indexes (safe — IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_reminders_patient    ON reminders(patient_id);
CREATE INDEX IF NOT EXISTS idx_reminders_type       ON reminders(reminder_type);
CREATE INDEX IF NOT EXISTS idx_reminders_status     ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_created_at ON reminders(created_at DESC);

-- ── FIX 3: Patients — index doctor_id for notification routing ──
-- Only if doctor_id column actually exists on this deployment
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'doctor_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_patients_doctor ON patients(doctor_id) WHERE doctor_id IS NOT NULL';
  END IF;
END $$;

-- ── FIX 4: Lab Reports — add portal & notification fields ──
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS portal_upload       BOOLEAN     DEFAULT FALSE;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS portal_patient_mrn  TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS notified_at         TIMESTAMPTZ;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS notification_sent   BOOLEAN     DEFAULT FALSE;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS lab_partner_name    TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS values              JSONB;

-- lab_partner_id FK — only add if lab_partners table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lab_partners'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'lab_reports' AND column_name = 'lab_partner_id'
    ) THEN
      ALTER TABLE lab_reports
        ADD COLUMN lab_partner_id UUID REFERENCES lab_partners(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lab_reports_portal   ON lab_reports(portal_upload)     WHERE portal_upload = TRUE;
CREATE INDEX IF NOT EXISTS idx_lab_reports_notified ON lab_reports(notification_sent);

-- ── FIX 5: Lab Portal Users table ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lab_portal_users'
  ) THEN
    -- lab_partners table may or may not exist; create without FK if missing
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'lab_partners'
    ) THEN
      EXECUTE '
        CREATE TABLE lab_portal_users (
          id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
          name           TEXT        NOT NULL,
          email          TEXT,
          lab_partner_id UUID        REFERENCES lab_partners(id) ON DELETE SET NULL,
          auth_token     TEXT        NOT NULL UNIQUE,
          is_active      BOOLEAN     DEFAULT TRUE,
          last_used_at   TIMESTAMPTZ,
          created_at     TIMESTAMPTZ DEFAULT NOW()
        )
      ';
    ELSE
      EXECUTE '
        CREATE TABLE lab_portal_users (
          id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
          name           TEXT        NOT NULL,
          email          TEXT,
          lab_partner_id UUID,
          auth_token     TEXT        NOT NULL UNIQUE,
          is_active      BOOLEAN     DEFAULT TRUE,
          last_used_at   TIMESTAMPTZ,
          created_at     TIMESTAMPTZ DEFAULT NOW()
        )
      ';
    END IF;

    ALTER TABLE lab_portal_users ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS allow_auth_lab_portal_users ON lab_portal_users;
    CREATE POLICY allow_auth_lab_portal_users ON lab_portal_users
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lab_portal_users_token  ON lab_portal_users(auth_token);
CREATE INDEX IF NOT EXISTS idx_lab_portal_users_active ON lab_portal_users(is_active);

-- ── FIX 6: auto-update bills.updated_at via trigger ──
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_bills_updated_at ON bills;
CREATE TRIGGER set_bills_updated_at
  BEFORE UPDATE ON bills
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ── FIX 7: Case-insensitive MRN index ──
CREATE INDEX IF NOT EXISTS idx_patients_mrn_upper ON patients(UPPER(mrn));

-- ── DONE ──
SELECT 'v31 HMS fixes migration complete — all safe' AS result;
