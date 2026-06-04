-- ════════════════════════════════════════════════════════════════════
-- 01_core_schema.sql
--
-- FRESH-INSTALL STEP 2 of 7 — Canonical snake_case schema.
--
-- Replaces migrations/applied/v00-schema-master.sql (which used flat
-- naming: clinicusers / opdqueue / auditlog / labreports etc.) with
-- the snake_case names that 100 % of application code uses.
--
-- This file is INTENTIONALLY conservative: it creates the canonical
-- table names only, with the columns the app reads. After this,
-- run 02-06 to layer on indexes, RLS, audit chain, etc.
--
-- Re-runnable safely (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
-- Adding a column to an existing table is harmless; Postgres skips it.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1. CLINIC USERS  (the central RBAC anchor)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clinic_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id     UUID UNIQUE,                       -- maps to auth.users(id)
  email       TEXT UNIQUE NOT NULL,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','doctor','staff','receptionist','lab_partner')),
  phone       TEXT,
  specialty   TEXT,                              -- doctor only
  med_reg_no  TEXT,                              -- doctor only
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinic_users_auth_id ON clinic_users(auth_id);
CREATE INDEX IF NOT EXISTS idx_clinic_users_active   ON clinic_users(is_active) WHERE is_active = TRUE;

-- ────────────────────────────────────────────────────────────────────
-- 2. CLINIC SETTINGS (key-value config)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clinic_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  TEXT
);

-- ────────────────────────────────────────────────────────────────────
-- 3. PATIENTS  (PHI fields included; encryption layered on later)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn          TEXT UNIQUE,                      -- assigned by next_mrn() RPC
  full_name    TEXT NOT NULL,
  age          INTEGER CHECK (age IS NULL OR (age >= 0 AND age <= 150)),
  date_of_birth DATE CHECK (date_of_birth IS NULL OR date_of_birth <= CURRENT_DATE),
  gender       TEXT CHECK (gender IS NULL OR gender IN ('Male','Female','Other')),
  mobile       TEXT,                             -- plaintext for OTP/WhatsApp routing (DPDP-allowed)
  mobile_encrypted TEXT,                         -- AES-256-GCM defence-in-depth copy
  blood_group  TEXT,
  address      TEXT,

  -- Aadhaar (encrypted at rest)
  aadhaar_no       TEXT,                         -- transient field; cleared after encryption
  aadhaar_encrypted TEXT,                        -- AES-256-GCM ciphertext
  aadhaar_last4    TEXT,                         -- displayable suffix
  aadhaar_hmac     TEXT,                         -- deterministic HMAC for dedup (added by 04)

  abha_id      TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,

  mediclaim    TEXT DEFAULT 'No',
  cashless     TEXT DEFAULT 'No',
  insurance_name      TEXT,
  insurance_id        TEXT,
  policy_tpa_name     TEXT,
  policy_number       TEXT,

  reference_source    TEXT,
  reference_detail    TEXT,
  doctor_id           UUID REFERENCES clinic_users(id),

  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_mrn       ON patients(mrn);
CREATE INDEX IF NOT EXISTS idx_patients_mobile    ON patients(mobile);
CREATE INDEX IF NOT EXISTS idx_patients_full_name ON patients(lower(full_name));
CREATE INDEX IF NOT EXISTS idx_patients_active    ON patients(is_active) WHERE is_active = TRUE;

-- ────────────────────────────────────────────────────────────────────
-- 4. ENCOUNTERS (one row per OPD/IPD visit)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS encounters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id       UUID REFERENCES clinic_users(id),
  encounter_date  DATE DEFAULT CURRENT_DATE,
  type            TEXT DEFAULT 'opd',
  chief_complaint TEXT,
  vitals          JSONB,
  diagnosis       TEXT,
  notes           TEXT,
  bill_id         UUID,
  revenue_status  TEXT DEFAULT 'pending',        -- pending | billed | paid | not_billed | lost_revenue | waived
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters(patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_date    ON encounters(encounter_date);

-- ────────────────────────────────────────────────────────────────────
-- 5. PRESCRIPTIONS
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prescriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id  UUID REFERENCES encounters(id) ON DELETE SET NULL,
  doctor_id     UUID REFERENCES clinic_users(id),
  prescription_date DATE DEFAULT CURRENT_DATE,
  medications   JSONB DEFAULT '[]',
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);

-- ────────────────────────────────────────────────────────────────────
-- 6. APPOINTMENTS
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appointments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
  patient_name  TEXT,
  mrn           TEXT,
  mobile        TEXT,
  doctor_id     UUID REFERENCES clinic_users(id),
  doctor_name   TEXT,
  date          DATE NOT NULL,
  time          TEXT NOT NULL,                   -- HH:MM
  duration_min  INTEGER DEFAULT 15,
  type          TEXT DEFAULT 'OPD',
  status        TEXT DEFAULT 'scheduled',        -- scheduled | arrived | in_progress | completed | no_show | cancelled
  visit_status  TEXT DEFAULT 'scheduled',
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_date     ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_patient  ON appointments(patient_id);

-- ────────────────────────────────────────────────────────────────────
-- 7. OPD QUEUE
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS opd_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name  TEXT,
  mrn           TEXT,
  encounter_id  UUID REFERENCES encounters(id) ON DELETE SET NULL,
  queue_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  token_number  INTEGER NOT NULL,
  status        TEXT DEFAULT 'waiting' CHECK (status IN ('waiting','vitals_done','in_progress','done','completed','cancelled','skipped')),
  priority      TEXT DEFAULT 'normal',
  notes         TEXT,
  called_at     TIMESTAMPTZ,
  done_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opd_queue_date_token ON opd_queue(queue_date, token_number);

-- ────────────────────────────────────────────────────────────────────
-- 8. BEDS
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS beds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bed_number    TEXT UNIQUE NOT NULL,
  ward          TEXT,
  status        TEXT DEFAULT 'available' CHECK (status IN ('available','occupied','cleaning','maintenance')),
  patient_id    UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name  TEXT,
  admission_date DATE,
  expected_discharge DATE,
  daily_rate    NUMERIC(10,2) DEFAULT 1000,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────────
-- 9. IPD ADMISSIONS
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ipd_admissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name      TEXT,
  mrn               TEXT,
  mobile            TEXT,
  bed_id            UUID REFERENCES beds(id) ON DELETE SET NULL,
  bed_number        TEXT,
  ward              TEXT,
  admission_date    DATE DEFAULT CURRENT_DATE,
  discharge_date    DATE,
  status            TEXT DEFAULT 'active' CHECK (status IN ('active','admitted','discharged','transferred','cancelled')),
  admitting_doctor  TEXT,
  chief_complaint   TEXT,
  diagnosis_on_admission TEXT,
  insurance_details TEXT,
  total_charges     NUMERIC(12,2) DEFAULT 0,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ipd_admissions_patient ON ipd_admissions(patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_admissions_status  ON ipd_admissions(status);

-- ────────────────────────────────────────────────────────────────────
-- 10. IPD NURSING (vitals, I/O, notes)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ipd_nursing (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ipd_admission_id    UUID REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  bed_id              UUID,
  patient_id          UUID,
  entry_type          TEXT DEFAULT 'note',
  recorded_time       TEXT,
  pulse               TEXT,
  bp_systolic         TEXT,
  bp_diastolic        TEXT,
  temperature         TEXT,
  spo2                TEXT,
  respiratory_rate    TEXT,
  io_type             TEXT,
  io_amount           TEXT,
  io_description      TEXT,
  nurse_name          TEXT,
  note_text           TEXT,
  note_type           TEXT,
  medication_name     TEXT,
  medication_dose     TEXT,
  medication_route    TEXT,
  medication_given_by TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────────
-- 11. BILLS  (snake_case canonical)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT,                            -- e.g. OPD-202606-0001
  bill_module   TEXT DEFAULT 'OPD',               -- OPD | IPD
  patient_id    UUID NOT NULL REFERENCES patients(id),
  patient_name  TEXT,
  mrn           TEXT,
  encounter_id  UUID,
  admission_id  UUID,
  items         JSONB DEFAULT '[]',
  subtotal      NUMERIC(12,2) DEFAULT 0,
  discount      NUMERIC(12,2) DEFAULT 0,
  gst_percent   NUMERIC(5,2) DEFAULT 0,
  gst_amount    NUMERIC(12,2) DEFAULT 0,
  net_amount    NUMERIC(12,2) DEFAULT 0,
  total         NUMERIC(12,2) DEFAULT 0,          -- legacy alias for net_amount
  paid          NUMERIC(12,2) DEFAULT 0,
  due           NUMERIC(12,2) DEFAULT 0,
  payment_mode  TEXT,
  status        TEXT DEFAULT 'unpaid',            -- pending | sent | paid | partial | partially_paid | unpaid | failed | cancelled | refunded | expired
  notes         TEXT,
  razorpay_payment_id TEXT,
  idempotency_key TEXT,
  created_by    TEXT,
  paid_at       TIMESTAMPTZ,

  -- Bill modification audit (from migration 006)
  modified_by   UUID REFERENCES clinic_users(id),
  modified_at   TIMESTAMPTZ,
  modification_reason TEXT,

  -- Soft-delete (from migration 010)
  is_deleted    BOOLEAN DEFAULT FALSE,
  deleted_at    TIMESTAMPTZ,
  deleted_by    TEXT,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Unique partial index on invoice_number (only for non-deleted bills).
-- Lets a deleted bill's number be reused if needed (rare but legitimate).
DROP INDEX IF EXISTS idx_bills_invoice_number_unique;
CREATE UNIQUE INDEX idx_bills_invoice_number_unique
  ON bills (invoice_number)
  WHERE is_deleted = FALSE AND invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bills_patient   ON bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_status    ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_idempotency_key
  ON bills(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- 12. BILL PAYMENTS  (per-payment ledger for partial/multi-payment bills)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bill_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id       UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  patient_id    UUID REFERENCES patients(id),
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_mode  TEXT DEFAULT 'cash',
  reference     TEXT,
  received_by   TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id    ON bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_patient_id ON bill_payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_created_at ON bill_payments(created_at);

-- ────────────────────────────────────────────────────────────────────
-- 13. CREDIT NOTES (refund audit trail)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cn_number       TEXT NOT NULL UNIQUE,
  bill_id         UUID NOT NULL REFERENCES bills(id),
  patient_id      UUID NOT NULL REFERENCES patients(id),
  patient_name    TEXT NOT NULL,
  mrn             TEXT,
  original_invoice_number TEXT,
  original_amount NUMERIC(12,2) NOT NULL,
  credit_amount   NUMERIC(12,2) NOT NULL CHECK (credit_amount > 0),
  credit_items    JSONB DEFAULT '[]',
  reason          TEXT NOT NULL,
  refund_mode     TEXT,
  gst_percent     NUMERIC(5,2) DEFAULT 0,
  gst_reversal    NUMERIC(12,2) DEFAULT 0,
  cgst_reversal   NUMERIC(12,2) DEFAULT 0,
  sgst_reversal   NUMERIC(12,2) DEFAULT 0,
  taxable_reversal NUMERIC(12,2) DEFAULT 0,
  issued_by       TEXT NOT NULL,
  issued_at       TIMESTAMPTZ DEFAULT NOW(),
  status          TEXT DEFAULT 'issued' CHECK (status IN ('issued','applied','cancelled')),
  notes           TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_bill    ON credit_notes(bill_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_patient ON credit_notes(patient_id);

-- ────────────────────────────────────────────────────────────────────
-- 14. HOSPITAL FUND (income/expense ledger)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hospital_fund (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT NOT NULL,                   -- income | expense | reversal
  category      TEXT,
  amount        NUMERIC(12,2) NOT NULL,
  description   TEXT,
  date          DATE DEFAULT CURRENT_DATE,
  bill_id       UUID,
  submitted_by  TEXT,
  approved_by   TEXT,
  status        TEXT DEFAULT 'pending',
  receipt_url   TEXT,
  receipt_note  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- One income row per (bill_id, type) — prevents the double-revenue bug
-- (where both the API route AND the trigger inserted income rows).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hospital_fund_bill_type_income
  ON hospital_fund (bill_id, type)
  WHERE bill_id IS NOT NULL AND type = 'income';

CREATE INDEX IF NOT EXISTS idx_hospital_fund_bill_id ON hospital_fund(bill_id) WHERE bill_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- 15. LAB PARTNERS
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  contact_person  TEXT,
  hospital_pct    NUMERIC(5,2) DEFAULT 30,
  lab_pct         NUMERIC(5,2) DEFAULT 70,
  default_hospital_pct NUMERIC(5,2) DEFAULT 30,
  default_lab_pct      NUMERIC(5,2) DEFAULT 70,
  test_commissions JSONB DEFAULT '[]',
  portal_token    TEXT,
  portal_enabled  BOOLEAN DEFAULT FALSE,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────────
-- 16. LAB PORTAL USERS (per-user tokens for the lab partner upload portal)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_portal_users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,
  lab_partner_id    UUID REFERENCES lab_partners(id) ON DELETE CASCADE,
  auth_token        TEXT NOT NULL UNIQUE,
  is_active         BOOLEAN DEFAULT TRUE,
  token_expires_at  TIMESTAMPTZ,
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_portal_users_token
    ON lab_portal_users(auth_token) WHERE is_active = TRUE;

-- ────────────────────────────────────────────────────────────────────
-- 17. LAB REPORTS
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lab_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id    UUID REFERENCES encounters(id) ON DELETE SET NULL,
  report_name     TEXT NOT NULL,
  test_name       TEXT,
  test_category   TEXT,
  report_date     DATE DEFAULT CURRENT_DATE,
  lab_name        TEXT,
  lab_partner_id  UUID REFERENCES lab_partners(id) ON DELETE SET NULL,
  lab_partner_name TEXT,
  entries         JSONB DEFAULT '[]',
  result_data     JSONB,
  result_text     TEXT,
  normal_range    TEXT,
  notes           TEXT,
  status          TEXT DEFAULT 'pending',         -- pending | collected | processing | completed
  attachment_url  TEXT,
  file_url        TEXT,
  storage_bucket  TEXT,                           -- which bucket the file is in (default 'attachments-private')
  storage_path    TEXT,                           -- path within the bucket (so we can resign URLs later)
  total_amount    NUMERIC(10,2),
  hospital_amount NUMERIC(10,2),
  lab_amount      NUMERIC(10,2),
  payment_mode    TEXT,
  source          TEXT,                           -- 'staff' | 'portal' | 'extract'
  portal_upload   BOOLEAN DEFAULT FALSE,
  portal_patient_mrn TEXT,
  ai_extracted_data JSONB,
  results_data    JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_reports_patient ON lab_reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_partner ON lab_reports(lab_partner_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_status  ON lab_reports(status);

-- ────────────────────────────────────────────────────────────────────
-- 18. ATTACHMENTS (general patient document store)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id  UUID,
  type          TEXT,
  name          TEXT,
  url           TEXT,                              -- public URL (only if bucket is public)
  storage_bucket TEXT,                             -- ALWAYS prefer signed URLs over public
  storage_path  TEXT,
  uploaded_by   TEXT,
  metadata      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────────
-- 19. DISCHARGE SUMMARIES
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS discharge_summaries (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id               UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  ipd_admission_id         UUID REFERENCES ipd_admissions(id) ON DELETE SET NULL,
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
  baby_birth_time          TEXT,
  apgar_score              TEXT,
  delivery_date            DATE,
  complications            TEXT,
  lactation_advice         TEXT,
  is_final                 BOOLEAN DEFAULT FALSE,
  version                  INTEGER DEFAULT 1,
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

CREATE INDEX IF NOT EXISTS idx_ds_patient  ON discharge_summaries(patient_id);
CREATE INDEX IF NOT EXISTS idx_ds_isfinal  ON discharge_summaries(is_final) WHERE is_final = TRUE;

-- ────────────────────────────────────────────────────────────────────
-- 20. AUDIT LOG (chain hash columns added by 02_audit_chain.sql)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID,                              -- clinic_users.id
  user_email    TEXT,
  user_role     TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  entity_label  TEXT,
  changes       JSONB,
  entry_hash    TEXT,                              -- set by insert_audit_entry()
  prev_hash     TEXT,                              -- set by insert_audit_entry()
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_action      ON audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity      ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user        ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_chain       ON audit_log(created_at DESC) INCLUDE (entry_hash);

-- ────────────────────────────────────────────────────────────────────
-- 21. PORTAL TABLES (patient-facing portal)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal_otp (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile      TEXT NOT NULL,
  otp_code    TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  patient_id  UUID,
  mrn         TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  verified    BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_otp_mobile_unverified
  ON portal_otp(mobile, verified, created_at DESC) WHERE verified = FALSE;

CREATE TABLE IF NOT EXISTS portal_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID,
  mrn           TEXT,
  mobile        TEXT,
  session_token TEXT UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  last_used     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID,
  mrn         TEXT,
  token       TEXT UNIQUE,
  expires_at  TIMESTAMPTZ,
  is_used     BOOLEAN DEFAULT FALSE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────────
-- 22. MISC OPERATIONAL TABLES (all snake_case, with sensible defaults)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reminders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID REFERENCES patients(id) ON DELETE CASCADE,
  patient_name  TEXT,
  type          TEXT,
  reminder_type TEXT,
  message       TEXT,
  status        TEXT DEFAULT 'pending',
  scheduled_for TIMESTAMPTZ,
  metadata      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctor_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID,
  patient_name  TEXT,
  mrn           TEXT,
  alert_type    TEXT,
  message       TEXT,
  severity      TEXT DEFAULT 'normal',
  alert_data    JSONB,
  source        TEXT,
  is_read       BOOLEAN DEFAULT FALSE,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clinic_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  message       TEXT,
  type          TEXT,
  severity      TEXT DEFAULT 'normal',
  source        TEXT,
  entity_type   TEXT,
  entity_id     UUID,
  patient_id    UUID,
  patient_name  TEXT,
  mrn           TEXT,
  target_roles  TEXT[],
  is_read       BOOLEAN DEFAULT FALSE,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_notifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         UUID,
  patient_name       TEXT,
  mobile             TEXT,
  notification_type  TEXT,
  message_preview    TEXT,
  recipient_type     TEXT,
  status             TEXT DEFAULT 'queued',
  scheduled_for      TIMESTAMPTZ,
  metadata           JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Insurance claims (used by IPD discharge auto-advance)
CREATE TABLE IF NOT EXISTS insurance_claims (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         UUID,
  patient_name       TEXT,
  mrn                TEXT,
  policy_number      TEXT,
  tpa_name           TEXT,
  insurance_company  TEXT,
  claim_amount       NUMERIC(12,2) DEFAULT 0,
  approved_amount    NUMERIC(12,2),
  status             TEXT DEFAULT 'pre_auth_pending',
  diagnosis          TEXT,
  surgery_name       TEXT,
  admission_date     DATE,
  discharge_date     DATE,
  settlement_date    DATE,
  notes              TEXT,
  created_by         TEXT,
  cashless           BOOLEAN DEFAULT FALSE,
  documents_sent     BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insurance_claim_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id     UUID REFERENCES insurance_claims(id) ON DELETE CASCADE,
  old_status   TEXT,
  new_status   TEXT,
  notes        TEXT,
  done_by      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- OT scheduling
CREATE TABLE IF NOT EXISTS ot_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  patient_name    TEXT,
  mrn             TEXT,
  surgery_name    TEXT,
  surgery_date    DATE,
  start_time      TEXT,
  end_time        TEXT,
  surgeon         TEXT,
  assistant       TEXT,
  anesthesia_type TEXT,
  anesthetist     TEXT,
  ot_room         TEXT DEFAULT 'OT-1',
  priority        TEXT DEFAULT 'elective',
  status          TEXT DEFAULT 'scheduled',
  pre_op_notes    TEXT,
  post_op_notes   TEXT,
  complications   TEXT,
  instruments     JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Cron job log
CREATE TABLE IF NOT EXISTS cron_job_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name     TEXT NOT NULL,
  status       TEXT DEFAULT 'running',
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  result       JSONB,
  error        TEXT
);

-- Pharmacy
CREATE TABLE IF NOT EXISTS pharmacy_medicines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  generic_name  TEXT,
  brand_name    TEXT,
  sku_code      TEXT,
  form          TEXT DEFAULT 'tablet',
  strength      TEXT,
  category      TEXT,
  manufacturer  TEXT,
  mrp           NUMERIC(10,2),
  selling_price NUMERIC(10,2),
  current_stock INTEGER DEFAULT 0,
  min_stock     INTEGER DEFAULT 10,
  unit          TEXT DEFAULT 'strip',
  batch_number  TEXT,
  expiry_date   DATE,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pharmacy_stock_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id   UUID REFERENCES pharmacy_medicines(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  quantity      INTEGER NOT NULL,
  reference_id  UUID,
  notes         TEXT,
  done_by       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pharmacy_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id   UUID REFERENCES pharmacy_medicines(id) ON DELETE CASCADE,
  batch_number  TEXT,
  expiry_date   DATE,
  quantity      INTEGER DEFAULT 0,
  mrp           NUMERIC(10,2),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Bill versions (immutable bill history)
CREATE TABLE IF NOT EXISTS bill_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id         UUID NOT NULL,
  version_number  INTEGER NOT NULL DEFAULT 1,
  snapshot        JSONB NOT NULL,
  modified_by     TEXT NOT NULL,
  modification_type TEXT NOT NULL,
  reason          TEXT NOT NULL,
  previous_amount NUMERIC(12,2),
  new_amount      NUMERIC(12,2),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_bill_version UNIQUE(bill_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_bill_versions_bill_id ON bill_versions(bill_id);

-- Bill counters (sequential per module-month)
-- Used by next_bill_counter() RPC defined in 03_billing_finance.sql
CREATE TABLE IF NOT EXISTS bill_counters (
  module       TEXT NOT NULL,                    -- OPD | IPD
  year_month   TEXT NOT NULL,                    -- YYYYMM
  next_seq     INTEGER NOT NULL DEFAULT 1,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (module, year_month)
);

-- Patient MRN counter (single global sequence)
CREATE TABLE IF NOT EXISTS mrn_counter (
  id           INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  next_seq     INTEGER NOT NULL DEFAULT 1,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO mrn_counter (id, next_seq)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────
-- DONE
-- ────────────────────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, name, applied_at, notes)
VALUES ('FI-01', 'fresh_install_core_schema', NOW(),
        'Canonical snake_case schema for fresh clinic install')
ON CONFLICT (version) DO NOTHING;

COMMIT;

SELECT 'Fresh-install 01/07: Core schema — DONE' AS result;
