-- ============================================================
-- NexMedicon HMS — v11 Improvements Migration
-- Run in Supabase SQL Editor AFTER all previous migrations
-- Covers:
--   A. Lab Results → Supabase (migrate from localStorage)
--   B. OPD Queue → Supabase Realtime
--   D. Billing → GST + Package Billing
--   E. Audit Log wiring
--   F. API Route Auth Middleware support table
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- A. LAB RESULTS TABLE (replaces localStorage)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_reports (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id  UUID REFERENCES encounters(id) ON DELETE SET NULL,
  report_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  lab_name      TEXT NOT NULL DEFAULT '',
  entries       JSONB NOT NULL DEFAULT '[]',  -- array of LabEntry objects
  notes         TEXT NOT NULL DEFAULT '',
  created_by    UUID REFERENCES clinic_users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast patient lookups
CREATE INDEX IF NOT EXISTS idx_lab_reports_patient ON lab_reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_date    ON lab_reports(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_lab_reports_encounter ON lab_reports(encounter_id)
  WHERE encounter_id IS NOT NULL;

-- RLS for lab_reports
ALTER TABLE lab_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_auth_select_lab_reports ON lab_reports;
DROP POLICY IF EXISTS allow_auth_insert_lab_reports ON lab_reports;
DROP POLICY IF EXISTS allow_auth_update_lab_reports ON lab_reports;
DROP POLICY IF EXISTS allow_auth_delete_lab_reports ON lab_reports;

CREATE POLICY allow_auth_select_lab_reports ON lab_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY allow_auth_insert_lab_reports ON lab_reports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY allow_auth_update_lab_reports ON lab_reports FOR UPDATE TO authenticated USING (true);
CREATE POLICY allow_auth_delete_lab_reports ON lab_reports FOR DELETE TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────
-- B. OPD QUEUE — Supabase Realtime support
--    (queue table likely exists; ensure realtime is enabled)
-- ─────────────────────────────────────────────────────────────

-- Make sure the queue table exists with the right shape
CREATE TABLE IF NOT EXISTS opd_queue (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id  UUID REFERENCES encounters(id) ON DELETE SET NULL,
  queue_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  token_number  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting','in_progress','done','cancelled')),
  priority      TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('normal','urgent','emergency')),
  notes         TEXT DEFAULT '',
  called_at     TIMESTAMPTZ,
  done_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opd_queue_date    ON opd_queue(queue_date);
CREATE INDEX IF NOT EXISTS idx_opd_queue_status  ON opd_queue(status);
CREATE INDEX IF NOT EXISTS idx_opd_queue_patient ON opd_queue(patient_id);

-- Enable RLS
ALTER TABLE opd_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_auth_select_opd_queue ON opd_queue;
DROP POLICY IF EXISTS allow_auth_insert_opd_queue ON opd_queue;
DROP POLICY IF EXISTS allow_auth_update_opd_queue ON opd_queue;
DROP POLICY IF EXISTS allow_auth_delete_opd_queue ON opd_queue;

CREATE POLICY allow_auth_select_opd_queue ON opd_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY allow_auth_insert_opd_queue ON opd_queue FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY allow_auth_update_opd_queue ON opd_queue FOR UPDATE TO authenticated USING (true);
CREATE POLICY allow_auth_delete_opd_queue ON opd_queue FOR DELETE TO authenticated USING (true);

-- IMPORTANT: Enable Realtime for opd_queue in Supabase Dashboard:
-- Database → Replication → Tables → toggle opd_queue ON

-- ─────────────────────────────────────────────────────────────
-- D. BILLING — GST + Package Billing additions
-- ─────────────────────────────────────────────────────────────

-- Add GST and package fields to existing bills table
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS gst_percent     NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_amount      NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS package_id      UUID,  -- FK added below after packages table
  ADD COLUMN IF NOT EXISTS package_name    TEXT,
  ADD COLUMN IF NOT EXISTS is_package_bill BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoice_number  TEXT UNIQUE;

-- Auto-generate invoice number trigger
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1001;

CREATE OR REPLACE FUNCTION set_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'INV-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD(nextval('invoice_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_number ON bills;
CREATE TRIGGER trg_invoice_number
  BEFORE INSERT ON bills
  FOR EACH ROW EXECUTE FUNCTION set_invoice_number();

-- Billing packages master table
CREATE TABLE IF NOT EXISTS billing_packages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  items       JSONB NOT NULL DEFAULT '[]',  -- [{label, amount}]
  total       NUMERIC(10,2) NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  category    TEXT DEFAULT 'general',       -- 'maternity'|'surgery'|'anc'|'general'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK now that table exists
ALTER TABLE bills
  ADD CONSTRAINT fk_bills_package
  FOREIGN KEY (package_id) REFERENCES billing_packages(id) ON DELETE SET NULL;

ALTER TABLE billing_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_auth_select_billing_packages ON billing_packages;
DROP POLICY IF EXISTS allow_auth_insert_billing_packages ON billing_packages;
DROP POLICY IF EXISTS allow_auth_update_billing_packages ON billing_packages;
DROP POLICY IF EXISTS allow_auth_delete_billing_packages ON billing_packages;

CREATE POLICY allow_auth_select_billing_packages ON billing_packages FOR SELECT TO authenticated USING (true);
CREATE POLICY allow_auth_insert_billing_packages ON billing_packages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY allow_auth_update_billing_packages ON billing_packages FOR UPDATE TO authenticated USING (true);
CREATE POLICY allow_auth_delete_billing_packages ON billing_packages FOR DELETE TO authenticated USING (true);

-- Seed common gynecology packages
INSERT INTO billing_packages (name, description, category, items, total) VALUES
('Normal Delivery Package', 'Includes admission, delivery, 2 days stay, basic medicines', 'maternity',
  '[{"label":"Delivery Charges","amount":8000},{"label":"Room (2 days)","amount":3000},{"label":"Nursing Care","amount":2000},{"label":"Basic Medicines","amount":1500}]'::jsonb, 14500),
('LSCS Package', 'C-Section: OT, anaesthesia, 4 days stay, dressings', 'maternity',
  '[{"label":"OT Charges","amount":15000},{"label":"Anaesthesia","amount":5000},{"label":"Room (4 days)","amount":6000},{"label":"Nursing & Dressings","amount":3000}]'::jsonb, 29000),
('ANC Full Package', '4 ANC visits + Iron + Folate + 2 scans', 'anc',
  '[{"label":"4 ANC Consultations","amount":1600},{"label":"2 Obstetric USGs","amount":2400},{"label":"Iron & Folate tablets","amount":500}]'::jsonb, 4500),
('Minor OT Package', 'Minor surgical procedure under local anaesthesia', 'surgery',
  '[{"label":"OT Charges","amount":4000},{"label":"Consumables","amount":800},{"label":"Follow-up Visit","amount":300}]'::jsonb, 5100)
ON CONFLICT DO NOTHING;

-- GST rates reference (for UI dropdowns)
-- Standard rates for healthcare: most services are GST-exempt (0%)
-- Cosmetic / non-essential may attract 18%
COMMENT ON COLUMN bills.gst_percent IS 'GST % applied. 0 for most medical services (exempt). 5/12/18 for taxable items.';

-- ─────────────────────────────────────────────────────────────
-- E. AUDIT LOG
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES clinic_users(id) ON DELETE SET NULL,
  user_email   TEXT,
  user_role    TEXT,
  action       TEXT NOT NULL,   -- 'create'|'update'|'delete'|'view'|'print'|'login'|'logout'
  entity_type  TEXT NOT NULL,   -- 'patient'|'encounter'|'bill'|'lab_report'|'prescription'|'user'
  entity_id    TEXT,            -- UUID of the affected record
  entity_label TEXT,            -- human-readable: patient name, bill number, etc.
  changes      JSONB,           -- {before: {...}, after: {...}} for updates
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user      ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity    ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created   ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action    ON audit_log(action);

-- RLS: only admins can read audit log; anyone authenticated can INSERT (write)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_auth_insert_audit_log ON audit_log;
DROP POLICY IF EXISTS allow_admin_select_audit_log ON audit_log;

-- Anyone authenticated can write audit entries
CREATE POLICY allow_auth_insert_audit_log ON audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- Only admins can read audit log (checked via clinic_users role)
CREATE POLICY allow_admin_select_audit_log ON audit_log FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.auth_id = auth.uid()
        AND cu.role = 'admin'
        AND cu.is_active = TRUE
    )
  );

-- Auto-trigger: log patient deletions automatically at DB level
CREATE OR REPLACE FUNCTION log_patient_delete()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (action, entity_type, entity_id, entity_label, changes)
  VALUES (
    'delete', 'patient',
    OLD.id::TEXT,
    OLD.full_name || ' (MRN: ' || OLD.mrn::TEXT || ')',
    jsonb_build_object('before', row_to_json(OLD))
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_patient_delete ON patients;
CREATE TRIGGER trg_audit_patient_delete
  BEFORE DELETE ON patients
  FOR EACH ROW EXECUTE FUNCTION log_patient_delete();

-- ─────────────────────────────────────────────────────────────
-- F. API ROUTE AUTH — Session validation helper
-- ─────────────────────────────────────────────────────────────

-- This view helps middleware quickly validate roles without extra round-trips
CREATE OR REPLACE VIEW v_active_users AS
  SELECT
    cu.auth_id,
    cu.id          AS clinic_user_id,
    cu.email,
    cu.full_name,
    cu.role,
    cu.is_active
  FROM clinic_users cu
  WHERE cu.is_active = TRUE;

-- Grant access to authenticated users
GRANT SELECT ON v_active_users TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- UPDATED_AT auto-touch triggers
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lab_reports_updated_at ON lab_reports;
CREATE TRIGGER trg_lab_reports_updated_at
  BEFORE UPDATE ON lab_reports
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_opd_queue_updated_at ON opd_queue;
CREATE TRIGGER trg_opd_queue_updated_at
  BEFORE UPDATE ON opd_queue
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_billing_packages_updated_at ON billing_packages;
CREATE TRIGGER trg_billing_packages_updated_at
  BEFORE UPDATE ON billing_packages
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
