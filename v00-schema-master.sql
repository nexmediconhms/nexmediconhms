-- ============================================================
-- NexMedicon HMS — v00 MASTER SCHEMA (SNAKE_CASE)
-- Single-file fresh-database bootstrap.
-- All table/column names match the application code exactly.
-- Run this on a brand-new Supabase project.
-- ============================================================

-- ── §1 EXTENSIONS ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── §2 CORE TABLES ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clinic_users (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_id       UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','doctor','staff','receptionist')),
  phone         TEXT,
  specialty     TEXT,
  med_reg_no    TEXT,
  share_pct     NUMERIC(5,2),
  earning_model TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  is_primary    BOOLEAN DEFAULT FALSE,
  mfa_enabled   BOOLEAN DEFAULT FALSE,
  mfa_enrolled_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clinic_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ── §2b HELPER FUNCTIONS (after clinic_users exists) ──────────

CREATE OR REPLACE FUNCTION is_active_user() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND is_active = TRUE
    )
  $$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND role = 'admin' AND is_active = TRUE
    )
  $$;

CREATE OR REPLACE FUNCTION is_doctor_or_admin() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND role IN ('admin','doctor') AND is_active = TRUE
    )
  $$;

CREATE OR REPLACE FUNCTION get_my_role() RETURNS TEXT
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT role FROM clinic_users
    WHERE auth_id = auth.uid() AND is_active = TRUE LIMIT 1
  $$;


-- ── §3 PATIENTS ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patients (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mrn                     TEXT UNIQUE,
  full_name               TEXT NOT NULL,
  date_of_birth           DATE,
  age                     INTEGER,
  gender                  TEXT DEFAULT 'Female',
  mobile                  TEXT,
  blood_group             TEXT,
  address                 TEXT,
  city                    TEXT,
  state                   TEXT,
  pincode                 TEXT,
  abha_id                 TEXT,
  aadhaar_no              TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  mediclaim               BOOLEAN DEFAULT FALSE,
  cashless                BOOLEAN DEFAULT FALSE,
  policy_tpa_name         TEXT,
  policy_number           TEXT,
  reference_source        TEXT,
  notes                   TEXT,
  is_active               BOOLEAN DEFAULT TRUE,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-generate MRN: P-001, P-002, ...
CREATE SEQUENCE IF NOT EXISTS patient_mrn_seq START 1;
CREATE OR REPLACE FUNCTION generate_mrn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mrn IS NULL THEN
    NEW.mrn := 'P-' || LPAD(nextval('patient_mrn_seq')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_patient_mrn ON patients;
CREATE TRIGGER trg_patient_mrn
  BEFORE INSERT ON patients
  FOR EACH ROW EXECUTE FUNCTION generate_mrn();


-- ── §4 ENCOUNTERS ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS encounters (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_date   DATE DEFAULT CURRENT_DATE,
  encounter_type   TEXT DEFAULT 'OPD',
  chief_complaint  TEXT,
  pulse            INTEGER,
  bp_systolic      INTEGER,
  bp_diastolic     INTEGER,
  temperature      NUMERIC(4,1),
  spo2             INTEGER,
  weight           NUMERIC(5,1),
  height           NUMERIC(5,1),
  diagnosis        TEXT,
  icd_code         TEXT,
  notes            TEXT,
  ob_data          JSONB DEFAULT '{}'::JSONB,
  procedures       JSONB,
  doctor_name      TEXT,
  doctor_id        UUID REFERENCES clinic_users(id),
  status           TEXT DEFAULT 'active',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── §5 PRESCRIPTIONS ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prescriptions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  encounter_id    UUID REFERENCES encounters(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name    TEXT,
  mrn             TEXT,
  mobile          TEXT,
  medications     JSONB NOT NULL DEFAULT '[]'::JSONB,
  advice          TEXT,
  dietary_advice  TEXT,
  reports_needed  TEXT,
  lab_tests       TEXT,
  diagnosis       TEXT,
  follow_up_date  DATE,
  follow_up_note  TEXT,
  doctor_name     TEXT,
  doctor_id       UUID REFERENCES clinic_users(id),
  reminder_sent_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);


-- ── §6 LAB REPORTS ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_reports (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id     UUID REFERENCES encounters(id),
  report_name      TEXT,
  report_date      DATE DEFAULT CURRENT_DATE,
  lab_name         TEXT,
  entries          JSONB DEFAULT '[]'::JSONB,
  results_data     JSONB,
  ai_extracted_data JSONB,
  status           TEXT DEFAULT 'pending',
  notes            TEXT,
  attachment_url   TEXT,
  source           TEXT,
  portal_upload    BOOLEAN DEFAULT FALSE,
  portal_patient_mrn TEXT,
  lab_partner_id   UUID,
  lab_partner_name TEXT,
  total_amount     NUMERIC(10,2) DEFAULT 0,
  hospital_amount  NUMERIC(10,2) DEFAULT 0,
  lab_amount       NUMERIC(10,2) DEFAULT 0,
  payment_mode     TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── §7 PATIENT ALLERGIES ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS patient_allergies (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  allergen    TEXT NOT NULL,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  reaction    TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ── §8 SCHEDULING ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appointments (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name  TEXT,
  mrn           TEXT,
  mobile        TEXT,
  date          DATE NOT NULL,
  time          TEXT NOT NULL,
  type          TEXT,
  notes         TEXT,
  status        TEXT DEFAULT 'scheduled',
  reminder_sent BOOLEAN DEFAULT FALSE,
  source        TEXT,
  follow_up_id  UUID,
  video_link    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opd_queue (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id  UUID REFERENCES encounters(id),
  queue_date    DATE DEFAULT CURRENT_DATE,
  token_number  INTEGER,
  status        TEXT DEFAULT 'waiting',
  priority      TEXT DEFAULT 'normal',
  notes         TEXT,
  called_at     TIMESTAMPTZ,
  done_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminders (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
  patient_name  TEXT,
  mobile        TEXT,
  reminder_type TEXT DEFAULT 'general',
  due_date      DATE,
  message       TEXT,
  status        TEXT DEFAULT 'pending',
  sent_by       TEXT,
  sent_at       TIMESTAMPTZ,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminder_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name  TEXT,
  mobile        TEXT,
  reminder_type TEXT,
  message_preview TEXT,
  channel       TEXT DEFAULT 'whatsapp',
  status        TEXT DEFAULT 'queued',
  sent_by       TEXT,
  batch_id      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);


-- ── §9 BEDS & IPD ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS beds (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bed_number         TEXT NOT NULL UNIQUE,
  ward               TEXT NOT NULL DEFAULT 'General',
  type               TEXT NOT NULL DEFAULT 'General',
  status             TEXT NOT NULL DEFAULT 'available'
                       CHECK (status IN ('available','occupied','cleaning','reserved','maintenance')),
  patient_id         UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name       TEXT,
  admission_date     DATE,
  expected_discharge DATE,
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ipd_admissions (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id              UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name            TEXT,
  mrn                     TEXT,
  mobile                  TEXT,
  age                     INTEGER,
  gender                  TEXT,
  bed_id                  UUID REFERENCES beds(id),
  bed_number              TEXT,
  ward                    TEXT,
  admission_date          DATE DEFAULT CURRENT_DATE,
  admission_time          TEXT,
  admitting_doctor        TEXT,
  consulting_doctors      JSONB DEFAULT '[]'::JSONB,
  diagnosis_on_admission  TEXT,
  chief_complaint         TEXT,
  diet_type               TEXT,
  allergies               TEXT,
  comorbidities           TEXT,
  insurance_details       TEXT,
  relative_name           TEXT,
  relative_contact        TEXT,
  relative_relation       TEXT,
  status                  TEXT DEFAULT 'active',
  total_charges           NUMERIC(12,2) DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ipd_nursing (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ipd_admission_id  UUID NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  entry_type        TEXT DEFAULT 'vital',
  recorded_time     TIMESTAMPTZ DEFAULT NOW(),
  pulse             TEXT,
  bp_systolic       TEXT,
  bp_diastolic      TEXT,
  temperature       TEXT,
  spo2              TEXT,
  weight            TEXT,
  rr                TEXT,
  vital_note        TEXT,
  io_type           TEXT,
  io_label          TEXT,
  io_amount_ml      NUMERIC(8,2),
  medication_name   TEXT,
  medication_dose   TEXT,
  medication_route  TEXT,
  medication_given_by TEXT,
  nurse_name        TEXT,
  note_text         TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ipd_charge_rates (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT,
  amount      NUMERIC(10,2) NOT NULL,
  unit        TEXT DEFAULT 'per day',
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ── §10 BILLING ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bills (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name        TEXT,
  mrn                 TEXT,
  invoice_number      TEXT UNIQUE,
  items               JSONB NOT NULL DEFAULT '[]',
  subtotal            NUMERIC(10,2) DEFAULT 0,
  discount            NUMERIC(10,2) DEFAULT 0,
  gst_percent         NUMERIC(5,2) DEFAULT 0,
  gst_amount          NUMERIC(10,2) DEFAULT 0,
  net_amount          NUMERIC(10,2) DEFAULT 0,
  total               NUMERIC(10,2) DEFAULT 0,
  paid                NUMERIC(10,2) DEFAULT 0,
  due                 NUMERIC(10,2) DEFAULT 0,
  payment_mode        TEXT,
  razorpay_payment_id TEXT,
  status              TEXT DEFAULT 'pending',
  notes               TEXT,
  created_by          TEXT,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bill_payments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_id     UUID REFERENCES bills(id) ON DELETE CASCADE,
  patient_id  UUID REFERENCES patients(id) ON DELETE CASCADE,
  amount      NUMERIC(10,2) NOT NULL,
  mode        TEXT,
  reference   TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hospital_fund (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type        TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  description TEXT,
  category    TEXT,
  approved_by TEXT,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lab_partners (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  contact         TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  hospital_pct    NUMERIC(5,2) DEFAULT 60,
  lab_pct         NUMERIC(5,2) DEFAULT 40,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_packages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT,
  items       JSONB DEFAULT '[]',
  total       NUMERIC(10,2) DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ── §11 DISCHARGE SUMMARIES ───────────────────────────────────

CREATE TABLE IF NOT EXISTS discharge_summaries (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id               UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  admission_date           DATE,
  discharge_date           DATE DEFAULT CURRENT_DATE,
  final_diagnosis          TEXT,
  secondary_diagnosis      TEXT,
  clinical_summary         TEXT,
  investigations           TEXT,
  treatment_given          TEXT,
  condition_at_discharge   TEXT,
  discharge_advice         TEXT,
  diet_advice              TEXT,
  medications_at_discharge TEXT,
  follow_up_date           DATE,
  follow_up_note           TEXT,
  delivery_type            TEXT,
  baby_sex                 TEXT,
  baby_weight              TEXT,
  apgar_score              TEXT,
  baby_birth_time          TEXT,
  delivery_date            DATE,
  complications            TEXT,
  lactation_advice         TEXT,
  version                  INTEGER DEFAULT 1,
  is_final                 BOOLEAN DEFAULT FALSE,
  signed_by                TEXT,
  signed_at                TIMESTAMPTZ,
  finalized_at             TIMESTAMPTZ,
  unfinalized_reason       TEXT,
  unfinalized_by           TEXT,
  unfinalized_at           TIMESTAMPTZ,
  reminder_sent_at         TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- ── §12 ANC ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS anc_registrations (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  lmp           DATE,
  edd           DATE,
  gravida       INTEGER DEFAULT 1,
  para          INTEGER DEFAULT 0,
  abortion      INTEGER DEFAULT 0,
  living        INTEGER DEFAULT 0,
  blood_group   TEXT,
  rh_factor     TEXT,
  husband_name  TEXT,
  husband_blood TEXT,
  risk_factors  JSONB,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anc_visits (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  anc_id          UUID NOT NULL REFERENCES anc_registrations(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_date      DATE DEFAULT CURRENT_DATE,
  ga_weeks        INTEGER,
  weight          NUMERIC(5,2),
  bp              TEXT,
  fhs             TEXT,
  presentation    TEXT,
  engagement      TEXT,
  investigations  JSONB,
  advice          TEXT,
  next_visit_date DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);


-- ── §13 OT SCHEDULE ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ot_schedules (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name    TEXT,
  mrn             TEXT,
  surgery_name    TEXT NOT NULL,
  surgery_date    DATE NOT NULL,
  start_time      TEXT,
  end_time        TEXT,
  surgeon         TEXT,
  anesthetist     TEXT,
  status          TEXT DEFAULT 'scheduled',
  notes           TEXT,
  reminder_sent_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── §14 PORTAL ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal_patients (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  mobile      TEXT NOT NULL UNIQUE,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── §15 AUDIT LOG ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       TEXT,
  user_email    TEXT,
  user_role     TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  entity_label  TEXT,
  changes       JSONB,
  entry_hash    TEXT,
  prev_hash     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── §16 ATTACHMENTS ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS consultation_attachments (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id  UUID REFERENCES encounters(id),
  file_name     TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  file_type     TEXT,
  file_size     INTEGER,
  uploaded_by   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultation_files_db (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id  UUID REFERENCES encounters(id),
  file_name     TEXT NOT NULL,
  file_data     TEXT,
  file_type     TEXT,
  file_size     INTEGER,
  uploaded_by   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);


-- ── §17 VIDEO ROOMS ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS video_rooms (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id  UUID REFERENCES appointments(id),
  room_id         TEXT NOT NULL UNIQUE,
  room_name       TEXT NOT NULL,
  doctor_link     TEXT,
  patient_link    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── §18 NOTIFICATIONS ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clinic_notifications (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'info',
  severity      TEXT DEFAULT 'normal',
  source        TEXT,
  entity_type   TEXT,
  entity_id     TEXT,
  patient_id    UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name  TEXT,
  mrn           TEXT,
  target_roles  TEXT[] DEFAULT '{admin,doctor,staff}',
  is_read       BOOLEAN DEFAULT FALSE,
  read_by       TEXT,
  read_at       TIMESTAMPTZ,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_notifications (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id        UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name      TEXT,
  mobile            TEXT,
  notification_type TEXT,
  message_preview   TEXT,
  recipient_type    TEXT DEFAULT 'patient',
  status            TEXT DEFAULT 'queued',
  scheduled_for     TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  metadata          TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctor_alerts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name  TEXT,
  mrn           TEXT,
  alert_type    TEXT NOT NULL,
  severity      TEXT DEFAULT 'warning',
  alert_data    JSONB,
  is_read       BOOLEAN DEFAULT FALSE,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);


-- ── §19 LAB PORTAL USERS ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_portal_users (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name              TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,
  lab_partner_id    UUID REFERENCES lab_partners(id) ON DELETE CASCADE,
  auth_token        TEXT NOT NULL UNIQUE,
  is_active         BOOLEAN DEFAULT TRUE,
  last_used_at      TIMESTAMPTZ,
  token_expires_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── §20 INSURANCE CLAIMS ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS insurance_claims (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id        UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name      TEXT,
  mrn               TEXT,
  policy_number     TEXT,
  tpa_name          TEXT,
  insurance_company TEXT,
  claim_amount      NUMERIC(12,2) DEFAULT 0,
  approved_amount   NUMERIC(12,2),
  status            TEXT DEFAULT 'pre_auth_pending',
  admission_date    DATE,
  discharge_date    DATE,
  surgery_name      TEXT,
  diagnosis         TEXT,
  pre_auth_number   TEXT,
  claim_number      TEXT,
  settlement_utr    TEXT,
  settlement_date   DATE,
  documents_sent    BOOLEAN DEFAULT FALSE,
  deduction_reason  TEXT,
  notes             TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insurance_claim_history (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id    UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
  old_status  TEXT,
  new_status  TEXT NOT NULL,
  notes       TEXT,
  done_by     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── §21 CRON JOB LOG ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cron_job_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name    TEXT NOT NULL,
  status      TEXT DEFAULT 'running',
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  result      JSONB,
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── §22 DRUG INTERACTION OVERRIDES ────────────────────────────

CREATE TABLE IF NOT EXISTS drug_interaction_overrides (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
  drug_a        TEXT NOT NULL,
  drug_b        TEXT NOT NULL,
  reason        TEXT,
  overridden_by TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════════════
-- §23 ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════

ALTER TABLE clinic_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_allergies ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE opd_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipd_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipd_nursing ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipd_charge_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospital_fund ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE discharge_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE anc_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE anc_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE ot_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultation_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultation_files_db ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claim_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_job_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_interaction_overrides ENABLE ROW LEVEL SECURITY;


-- ── RLS POLICIES ──────────────────────────────────────────────
-- clinic_users: everyone can read (needed for role checks), admin manages
CREATE POLICY cu_select ON clinic_users FOR SELECT TO authenticated USING (true);
CREATE POLICY cu_insert ON clinic_users FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR NOT EXISTS (SELECT 1 FROM clinic_users));
CREATE POLICY cu_update ON clinic_users FOR UPDATE TO authenticated
  USING (auth_id = auth.uid() OR is_admin());
CREATE POLICY cu_delete ON clinic_users FOR DELETE TO authenticated USING (is_admin());

-- clinic_settings
CREATE POLICY cs_select ON clinic_settings FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY cs_insert ON clinic_settings FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY cs_update ON clinic_settings FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY cs_delete ON clinic_settings FOR DELETE TO authenticated USING (is_admin());

-- patients: all active users CRUD
CREATE POLICY pat_select ON patients FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY pat_insert ON patients FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY pat_update ON patients FOR UPDATE TO authenticated USING (is_active_user());
CREATE POLICY pat_delete ON patients FOR DELETE TO authenticated USING (is_admin());

-- encounters
CREATE POLICY enc_select ON encounters FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY enc_insert ON encounters FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY enc_update ON encounters FOR UPDATE TO authenticated USING (is_active_user());
CREATE POLICY enc_delete ON encounters FOR DELETE TO authenticated USING (is_doctor_or_admin());

-- prescriptions
CREATE POLICY rx_select ON prescriptions FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY rx_insert ON prescriptions FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin());
CREATE POLICY rx_update ON prescriptions FOR UPDATE TO authenticated USING (is_doctor_or_admin());
CREATE POLICY rx_delete ON prescriptions FOR DELETE TO authenticated USING (is_doctor_or_admin());

-- lab_reports
CREATE POLICY lr_select ON lab_reports FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY lr_insert ON lab_reports FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY lr_update ON lab_reports FOR UPDATE TO authenticated USING (is_doctor_or_admin());
CREATE POLICY lr_delete ON lab_reports FOR DELETE TO authenticated USING (is_doctor_or_admin());

-- patient_allergies
CREATE POLICY pa_select ON patient_allergies FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY pa_insert ON patient_allergies FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin());
CREATE POLICY pa_update ON patient_allergies FOR UPDATE TO authenticated USING (is_doctor_or_admin());
CREATE POLICY pa_delete ON patient_allergies FOR DELETE TO authenticated USING (is_doctor_or_admin());

-- appointments, opd_queue, reminders, reminder_log: all active
CREATE POLICY appt_all ON appointments FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY opd_all ON opd_queue FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY rem_all ON reminders FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY rml_all ON reminder_log FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());


-- beds, ipd
CREATE POLICY beds_all ON beds FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY ipd_select ON ipd_admissions FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY ipd_insert ON ipd_admissions FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY ipd_update ON ipd_admissions FOR UPDATE TO authenticated USING (is_doctor_or_admin());
CREATE POLICY ipd_delete ON ipd_admissions FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY ipdn_all ON ipd_nursing FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY ipdcr_all ON ipd_charge_rates FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());

-- billing
CREATE POLICY bill_select ON bills FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY bill_insert ON bills FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY bill_update ON bills FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY bill_delete ON bills FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY bp_all ON bill_payments FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY hf_all ON hospital_fund FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY lp_all ON lab_partners FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY bpkg_all ON billing_packages FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());

-- discharge
CREATE POLICY ds_select ON discharge_summaries FOR SELECT TO authenticated USING (true);
CREATE POLICY ds_insert ON discharge_summaries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ds_update ON discharge_summaries FOR UPDATE TO authenticated USING (is_final = FALSE OR is_admin());
CREATE POLICY ds_delete ON discharge_summaries FOR DELETE TO authenticated USING (is_admin());

-- anc, ot
CREATE POLICY anc_all ON anc_registrations FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY ancv_all ON anc_visits FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY ot_all ON ot_schedules FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());

-- portal (service role only)
CREATE POLICY pp_none ON portal_patients FOR ALL TO authenticated USING (false);
CREATE POLICY ps_none ON portal_sessions FOR ALL TO authenticated USING (false);

-- audit log: admin reads, all insert, nobody deletes
CREATE POLICY al_select ON audit_log FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY al_insert ON audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- attachments
CREATE POLICY att_all ON consultation_attachments FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY fdb_all ON consultation_files_db FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());

-- video, notifications, alerts
CREATE POLICY vid_all ON video_rooms FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY notif_select ON clinic_notifications FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY notif_insert ON clinic_notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY notif_update ON clinic_notifications FOR UPDATE TO authenticated USING (is_active_user());
CREATE POLICY wn_all ON whatsapp_notifications FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY da_all ON doctor_alerts FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());

-- lab portal, insurance, cron, drug overrides
CREATE POLICY lpu_all ON lab_portal_users FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY ic_all ON insurance_claims FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY ich_all ON insurance_claim_history FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY cjl_select ON cron_job_log FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY cjl_insert ON cron_job_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY cjl_update ON cron_job_log FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY dio_all ON drug_interaction_overrides FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());


-- ══════════════════════════════════════════════════════════════
-- §24 INDEXES
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_patients_mrn ON patients(mrn);
CREATE INDEX IF NOT EXISTS idx_patients_mobile ON patients(mobile);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients USING gin(to_tsvector('simple', full_name));
CREATE INDEX IF NOT EXISTS idx_patients_created ON patients(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters(patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_date ON encounters(encounter_date DESC);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_encounter ON prescriptions(encounter_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_followup ON prescriptions(follow_up_date);

CREATE INDEX IF NOT EXISTS idx_lab_reports_patient ON lab_reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_date ON lab_reports(report_date DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

CREATE INDEX IF NOT EXISTS idx_opd_queue_date ON opd_queue(queue_date);
CREATE INDEX IF NOT EXISTS idx_opd_queue_status ON opd_queue(status);

CREATE INDEX IF NOT EXISTS idx_beds_status ON beds(status);

CREATE INDEX IF NOT EXISTS idx_ipd_patient ON ipd_admissions(patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_status ON ipd_admissions(status);

CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_created ON bills(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ds_patient ON discharge_summaries(patient_id);
CREATE INDEX IF NOT EXISTS idx_ds_final ON discharge_summaries(is_final) WHERE is_final = TRUE;

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_id);

CREATE INDEX IF NOT EXISTS idx_notif_created ON clinic_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON clinic_notifications(is_read) WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_ic_patient ON insurance_claims(patient_id);
CREATE INDEX IF NOT EXISTS idx_ic_status ON insurance_claims(status);

CREATE INDEX IF NOT EXISTS idx_da_unread ON doctor_alerts(is_read) WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_lpu_token ON lab_portal_users(auth_token);

-- ── §25 SEED BEDS ─────────────────────────────────────────────

INSERT INTO beds (bed_number, ward, type) VALUES
  ('GW-01','General Ward','General'),
  ('GW-02','General Ward','General'),
  ('GW-03','General Ward','General'),
  ('GW-04','General Ward','General'),
  ('GW-05','General Ward','General'),
  ('MW-01','Maternity Ward','Maternity'),
  ('MW-02','Maternity Ward','Maternity'),
  ('MW-03','Maternity Ward','Maternity'),
  ('MW-04','Maternity Ward','Maternity'),
  ('LW-01','Labour Ward','Labour'),
  ('LW-02','Labour Ward','Labour'),
  ('PR-01','Private Room','Private'),
  ('PR-02','Private Room','Private'),
  ('PR-03','Private Room','Private'),
  ('ICU-01','ICU','ICU'),
  ('ICU-02','ICU','ICU')
ON CONFLICT (bed_number) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
SELECT 'v00-schema-master: fresh database bootstrap complete' AS result;
