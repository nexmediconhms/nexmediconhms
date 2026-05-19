-- ============================================================
-- v21 — Feature Updates: IPD Files, Doctor Alerts, Lab Portal, OT Suggestions
-- ============================================================

-- ── IPD Files & Photos table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ipd_files (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  bed_id          TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  file_type       TEXT,
  file_size       INTEGER,
  file_url        TEXT NOT NULL,
  storage_path    TEXT,
  uploaded_by     TEXT NOT NULL DEFAULT 'Staff',
  uploaded_by_role TEXT DEFAULT 'staff',
  category        TEXT DEFAULT 'other' CHECK (category IN ('photo', 'document', 'other')),
  notes           TEXT,
  ocr_extracted   BOOLEAN DEFAULT FALSE,
  ocr_data        JSONB,
  ocr_confidence  FLOAT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ipd_files_patient ON ipd_files(patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_files_bed ON ipd_files(bed_id);

-- ── Doctor Alerts table (for abnormal lab values) ─────────────
CREATE TABLE IF NOT EXISTS doctor_alerts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  patient_name    TEXT,
  mrn             TEXT,
  alert_type      TEXT NOT NULL DEFAULT 'lab_abnormal',
  alert_data      JSONB,
  is_read         BOOLEAN DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  read_by         TEXT,
  severity        TEXT DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  source          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctor_alerts_unread ON doctor_alerts(is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_doctor_alerts_patient ON doctor_alerts(patient_id);

-- ── Lab Portal Users table (for lab partner dashboard) ────────
CREATE TABLE IF NOT EXISTS lab_portal_users (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT,
  lab_partner_id  UUID REFERENCES lab_partners(id) ON DELETE CASCADE,
  auth_token      TEXT UNIQUE NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_portal_users_token ON lab_portal_users(auth_token);

-- ── Insurance CA sharing log ──────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_ca_shares (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id        UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
  shared_to       TEXT NOT NULL,
  shared_by       TEXT,
  share_method    TEXT DEFAULT 'whatsapp',
  documents       JSONB,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insurance_ca_shares_claim ON insurance_ca_shares(claim_id);

-- ── WhatsApp notification log ─────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_notifications (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name    TEXT,
  mobile          TEXT,
  notification_type TEXT NOT NULL,
  message_preview TEXT,
  recipient_type  TEXT DEFAULT 'patient',
  status          TEXT DEFAULT 'sent',
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_notif_patient ON whatsapp_notifications(patient_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_notif_type ON whatsapp_notifications(notification_type);

-- ── RLS Policies ──────────────────────────────────────────────
ALTER TABLE ipd_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "ipd_files_access" ON ipd_files FOR ALL USING (is_active_user());

ALTER TABLE doctor_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "doctor_alerts_access" ON doctor_alerts FOR ALL USING (is_active_user());

ALTER TABLE lab_portal_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "lab_portal_users_admin" ON lab_portal_users FOR ALL USING (is_admin());

ALTER TABLE insurance_ca_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "insurance_ca_shares_access" ON insurance_ca_shares FOR ALL USING (is_active_user());

ALTER TABLE whatsapp_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "whatsapp_notifications_access" ON whatsapp_notifications FOR ALL USING (is_active_user());
