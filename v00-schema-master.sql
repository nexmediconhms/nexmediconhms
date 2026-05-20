-- ============================================================
-- NexMedicon HMS — v00 MASTER SCHEMA
-- Single-file fresh-database bootstrap.
-- Run this INSTEAD of all v01–v20 migration files on a brand-new DB.
-- For an EXISTING DB: keep running the individual vNN files as before.
-- ============================================================
--
-- TABLE OF CONTENTS:
--   §1  Helper functions (RLS helpers, audit RPC)
--   §2  Core tables (patients, clinicusers, clinicsettings)
--   §3  Clinical tables (encounters, prescriptions, labreports, patientallergies)
--   §4  Scheduling (appointments, opdqueue, reminders)
--   §5  IPD (beds, ipdadmissions, ipdchargerates)
--   §6  Billing (bills, hospitalfund, labpartners)
--   §7  ANC (ancregistrations, ancvisits)
--   §8  Discharge (dischargesummaries)
--   §9  Portal (portalpatients, portalsessions)
--   §10 Audit (auditlog)
--   §11 Attachments (attachments)
--   §12 Video (videorooms — optional)
--   §13 Row Level Security (all tables)
--   §14 Indexes
-- ============================================================

-- ── §1  HELPER FUNCTIONS ──────────────────────────────────────────────────────
-- NOTE: Helper functions reference `clinicusers` table.
-- We create the table first (forward declaration), then define the functions.

-- ── §2  CORE TABLES (created before helper functions that reference them) ─────

CREATE TABLE IF NOT EXISTS clinicusers (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  authid      UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  fullname    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','doctor','staff','receptionist')),
  phone       TEXT,
  isactive    BOOLEAN DEFAULT TRUE,
  createdat   TIMESTAMPTZ DEFAULT NOW(),
  updatedat   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clinicsettings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updatedat   TIMESTAMPTZ DEFAULT NOW()
);

-- Now that clinicusers exists, create helper functions that reference it:

CREATE OR REPLACE FUNCTION is_active_user() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM clinicusers
      WHERE authid = auth.uid() AND isactive = TRUE
    )
  $$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM clinicusers
      WHERE authid = auth.uid() AND role = 'admin' AND isactive = TRUE
    )
  $$;

CREATE OR REPLACE FUNCTION is_doctor_or_admin() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM clinicusers
      WHERE authid = auth.uid() AND role IN ('admin','doctor') AND isactive = TRUE
    )
  $$;

-- Atomic audit-log insert with hash chain (advisory lock prevents race conditions)
CREATE OR REPLACE FUNCTION insert_audit_entry(
  p_user_id      TEXT,
  p_user_email   TEXT,
  p_user_role    TEXT,
  p_action       TEXT,
  p_entity_type  TEXT,
  p_entity_id    TEXT,
  p_entity_label TEXT,
  p_changes      TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prev_hash TEXT;
  v_entry_hash TEXT;
  v_payload TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(7482910234);
  SELECT entryhash INTO v_prev_hash
    FROM auditlog ORDER BY createdat DESC LIMIT 1;
  v_payload := p_user_id || p_action || p_entity_type || COALESCE(p_entity_id,'') || COALESCE(v_prev_hash,'GENESIS');
  v_entry_hash := encode(digest(v_payload, 'sha256'), 'hex');
  INSERT INTO auditlog (userid, useremail, userrole, action, entitytype, entityid, entitylabel, changes, entryhash, prevhash)
  VALUES (p_user_id, p_user_email, p_user_role, p_action, p_entity_type, p_entity_id, p_entity_label, p_changes::jsonb, v_entry_hash, v_prev_hash);
END;
$$;

-- ── §2 CORE TABLES (patients) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patients (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mrn             TEXT UNIQUE,
  fullname        TEXT NOT NULL,
  dob             DATE,
  age             TEXT,
  gender          TEXT DEFAULT 'Female',
  mobile          TEXT,
  alternatmobile  TEXT,
  email           TEXT,
  address         TEXT,
  city            TEXT,
  state           TEXT,
  pincode         TEXT,
  bloodgroup      TEXT,
  aadhaar         TEXT,
  abhaid          TEXT,
  abhanumber      TEXT,
  abhaaddress     TEXT,
  abhaverified    BOOLEAN DEFAULT FALSE,
  abhaverifiedat  TIMESTAMPTZ,
  abhaverifiedby  TEXT,
  insurancename   TEXT,
  insuranceid     TEXT,
  mediclaim       TEXT DEFAULT 'No',
  cashless        TEXT DEFAULT 'No',
  referredby      TEXT,
  notes           TEXT,
  isactive        BOOLEAN DEFAULT TRUE,
  createdat       TIMESTAMPTZ DEFAULT NOW(),
  updatedat       TIMESTAMPTZ DEFAULT NOW()
);

-- ── §3  CLINICAL TABLES ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS encounters (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid           UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date                DATE DEFAULT CURRENT_DATE,
  type                TEXT DEFAULT 'OPD',
  doctorid            UUID REFERENCES clinicusers(id),
  doctorname          TEXT,
  chiefcomplaint      TEXT,
  hpi                 TEXT,
  vitals              JSONB,
  clinicalnotes       TEXT,
  diagnosis           TEXT,
  icd10codes          JSONB,
  plan                TEXT,
  followupdate        DATE,
  followupnote        TEXT,
  obgyndata           JSONB,
  status              TEXT DEFAULT 'active',
  createdat           TIMESTAMPTZ DEFAULT NOW(),
  updatedat           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  encounterid     UUID REFERENCES encounters(id) ON DELETE CASCADE,
  patientid       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medicines       JSONB NOT NULL DEFAULT '[]',
  advice          TEXT,
  followupdate    DATE,
  followupnote    TEXT,
  issuedat        TIMESTAMPTZ DEFAULT NOW(),
  doctorid        UUID REFERENCES clinicusers(id),
  doctorname      TEXT,
  createdat       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS labreports (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounterid     UUID REFERENCES encounters(id),
  reportname      TEXT NOT NULL,
  reportdate      DATE DEFAULT CURRENT_DATE,
  result          TEXT,
  normalrange     TEXT,
  unit            TEXT,
  status          TEXT DEFAULT 'pending',
  notes           TEXT,
  attachmenturl   TEXT,
  labpartnerid    UUID,
  createdat       TIMESTAMPTZ DEFAULT NOW(),
  updatedat       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patientallergies (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid   UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  allergen    TEXT NOT NULL,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  reaction    TEXT,
  notes       TEXT,
  createdat   TIMESTAMPTZ DEFAULT NOW()
);

-- ── §4  SCHEDULING ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appointments (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patientname     TEXT,
  mrn             TEXT,
  mobile          TEXT,
  date            DATE NOT NULL,
  time            TEXT NOT NULL,
  type            TEXT,
  notes           TEXT,
  status          TEXT DEFAULT 'scheduled',
  remindersent    BOOLEAN DEFAULT FALSE,
  videolink       TEXT,
  createdat       TIMESTAMPTZ DEFAULT NOW(),
  updatedat       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opdqueue (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patientname     TEXT,
  mrn             TEXT,
  mobile          TEXT,
  queuenumber     INTEGER,
  date            DATE DEFAULT CURRENT_DATE,
  status          TEXT DEFAULT 'waiting',
  notes           TEXT,
  createdat       TIMESTAMPTZ DEFAULT NOW(),
  updatedat       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminders (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patientname     TEXT,
  mobile          TEXT,
  type            TEXT,
  duedate         DATE,
  message         TEXT,
  status          TEXT DEFAULT 'pending',
  sentby          TEXT,
  sentat          TIMESTAMPTZ,
  createdat       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminderlog (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reminderid  UUID REFERENCES reminders(id) ON DELETE CASCADE,
  sentat      TIMESTAMPTZ DEFAULT NOW(),
  status      TEXT,
  response    TEXT
);

-- ── §5  IPD ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS beds (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bednumber   TEXT NOT NULL UNIQUE,
  ward        TEXT,
  type        TEXT DEFAULT 'General',
  status      TEXT DEFAULT 'available',
  notes       TEXT,
  createdat   TIMESTAMPTZ DEFAULT NOW(),
  updatedat   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ipdadmissions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid           UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  bedid               UUID REFERENCES beds(id),
  admissiondate       DATE DEFAULT CURRENT_DATE,
  dischargedate       DATE,
  admittingdoctor     TEXT,
  diagnosis           TEXT,
  notes               TEXT,
  status              TEXT DEFAULT 'admitted',
  createdat           TIMESTAMPTZ DEFAULT NOW(),
  updatedat           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ipdchargerates (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT,
  amount      NUMERIC(10,2) NOT NULL,
  unit        TEXT DEFAULT 'per day',
  isactive    BOOLEAN DEFAULT TRUE,
  createdat   TIMESTAMPTZ DEFAULT NOW()
);

-- ── §6  BILLING ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bills (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  invoicenumber   TEXT UNIQUE,
  items           JSONB NOT NULL DEFAULT '[]',
  subtotal        NUMERIC(10,2) DEFAULT 0,
  discount        NUMERIC(10,2) DEFAULT 0,
  tax             NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(10,2) DEFAULT 0,
  paid            NUMERIC(10,2) DEFAULT 0,
  due             NUMERIC(10,2) DEFAULT 0,
  paymentmode     TEXT,
  status          TEXT DEFAULT 'unpaid',
  notes           TEXT,
  createdat       TIMESTAMPTZ DEFAULT NOW(),
  updatedat       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hospitalfund (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type        TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  description TEXT,
  category    TEXT,
  approvedby  TEXT,
  status      TEXT DEFAULT 'pending',
  createdat   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS labpartners (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  contactperson   TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  hospitalshare   NUMERIC(5,2) DEFAULT 30,
  labshare        NUMERIC(5,2) DEFAULT 70,
  isactive        BOOLEAN DEFAULT TRUE,
  createdat       TIMESTAMPTZ DEFAULT NOW()
);

-- ── §7  ANC ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ancregistrations (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  lmp             DATE,
  edd             DATE,
  gravida         INTEGER DEFAULT 1,
  para            INTEGER DEFAULT 0,
  abortion        INTEGER DEFAULT 0,
  living          INTEGER DEFAULT 0,
  bloodgroup      TEXT,
  rhfactor        TEXT,
  husbandname     TEXT,
  husbandblood    TEXT,
  riskfactors     JSONB,
  notes           TEXT,
  createdat       TIMESTAMPTZ DEFAULT NOW(),
  updatedat       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ancvisits (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ancid           UUID NOT NULL REFERENCES ancregistrations(id) ON DELETE CASCADE,
  patientid       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visitdate       DATE DEFAULT CURRENT_DATE,
  gaweeks         INTEGER,
  weight          NUMERIC(5,2),
  bp              TEXT,
  fhs             TEXT,
  presentation    TEXT,
  engagement      TEXT,
  investigations  JSONB,
  advice          TEXT,
  nextvisitdate   DATE,
  notes           TEXT,
  createdat       TIMESTAMPTZ DEFAULT NOW()
);

-- ── §8  DISCHARGE ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dischargesummaries (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid             UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  admissiondate         DATE,
  dischargedate         DATE DEFAULT CURRENT_DATE,
  finaldiagnosis        TEXT,
  secondarydiagnosis    TEXT,
  clinicalsummary       TEXT,
  investigations        TEXT,
  treatmentgiven        TEXT,
  conditionatdischarge  TEXT,
  dischargeadvice       TEXT,
  dietadvice            TEXT,
  medicationsatdischarge TEXT,
  followupdate          DATE,
  followupnote          TEXT,
  deliverytype          TEXT,
  babysex               TEXT,
  babyweight            TEXT,
  apgarscore            TEXT,
  deliverydate          DATE,
  complications         TEXT,
  lactationadvice       TEXT,
  babybirthtime         TEXT,
  version               INTEGER DEFAULT 1,
  isfinal               BOOLEAN DEFAULT FALSE,
  signedby              TEXT,
  signedat              TIMESTAMPTZ,
  finalizedat           TIMESTAMPTZ,
  unfinalizedreason     TEXT,
  unfinalizedby         TEXT,
  unfinializedat        TIMESTAMPTZ,
  pdfgeneratedat        TIMESTAMPTZ,
  remindersentat        TIMESTAMPTZ,
  createdat             TIMESTAMPTZ DEFAULT NOW(),
  updatedat             TIMESTAMPTZ DEFAULT NOW()
);

-- ── §9  PORTAL ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portalpatients (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid   UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  mobile      TEXT NOT NULL UNIQUE,
  isactive    BOOLEAN DEFAULT TRUE,
  createdat   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portalsessions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid   UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expiresat   TIMESTAMPTZ NOT NULL,
  createdat   TIMESTAMPTZ DEFAULT NOW()
);

-- ── §10 AUDIT ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auditlog (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  userid      TEXT,
  useremail   TEXT,
  userrole    TEXT,
  action      TEXT NOT NULL,
  entitytype  TEXT,
  entityid    TEXT,
  entitylabel TEXT,
  changes     JSONB,
  entryhash   TEXT,
  prevhash    TEXT,
  createdat   TIMESTAMPTZ DEFAULT NOW()
);

-- ── §11 ATTACHMENTS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attachments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid   UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounterid UUID REFERENCES encounters(id),
  filename    TEXT NOT NULL,
  fileurl     TEXT NOT NULL,
  filetype    TEXT,
  filesize    INTEGER,
  uploadedby  TEXT,
  createdat   TIMESTAMPTZ DEFAULT NOW()
);

-- ── §12 VIDEO (optional) ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS videorooms (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appointmentid   UUID REFERENCES appointments(id),
  roomid          TEXT NOT NULL UNIQUE,
  roomname        TEXT NOT NULL,
  doctorlink      TEXT,
  patientlink     TEXT,
  createdat       TIMESTAMPTZ DEFAULT NOW()
);

-- ── §12b NOTIFICATIONS (in-app notification center) ───────────────────────────

CREATE TABLE IF NOT EXISTS clinic_notifications (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'info',  -- 'lab_report' | 'discharge' | 'appointment' | 'billing' | 'insurance' | 'system' | 'info'
  severity        TEXT DEFAULT 'normal',         -- 'normal' | 'warning' | 'critical'
  source          TEXT,                          -- 'lab_portal' | 'cron' | 'ipd' | 'billing' | 'system'
  entity_type     TEXT,                          -- 'patient' | 'lab_report' | 'bill' | 'admission' | 'claim'
  entity_id       TEXT,                          -- UUID of related entity
  patient_id      UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name    TEXT,
  mrn             TEXT,
  target_roles    TEXT[] DEFAULT '{admin,doctor,staff}', -- which roles can see this notification
  is_read         BOOLEAN DEFAULT FALSE,
  read_by         TEXT,
  read_at         TIMESTAMPTZ,
  metadata        JSONB,
  createdat       TIMESTAMPTZ DEFAULT NOW()
);

-- ── §12c LAB PORTAL USERS (persistent tokens for lab partners) ────────────────

CREATE TABLE IF NOT EXISTS lab_portal_users (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  lab_partner_id  UUID REFERENCES labpartners(id) ON DELETE CASCADE,
  auth_token      TEXT NOT NULL UNIQUE,
  is_active       BOOLEAN DEFAULT TRUE,
  last_used_at    TIMESTAMPTZ,
  token_expires_at TIMESTAMPTZ,  -- NULL = never expires
  createdat       TIMESTAMPTZ DEFAULT NOW(),
  updatedat       TIMESTAMPTZ DEFAULT NOW()
);

-- ── §12d INSURANCE CLAIMS ─────────────────────────────────────────────────────

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
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  createdat         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insurance_claim_history (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id    UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
  old_status  TEXT,
  new_status  TEXT NOT NULL,
  notes       TEXT,
  done_by     TEXT,
  createdat   TIMESTAMPTZ DEFAULT NOW()
);

-- ── §12e WHATSAPP NOTIFICATIONS LOG ───────────────────────────────────────────

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
  createdat         TIMESTAMPTZ DEFAULT NOW()
);

-- ── §12f DOCTOR ALERTS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS doctor_alerts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name    TEXT,
  mrn             TEXT,
  alert_type      TEXT NOT NULL,
  severity        TEXT DEFAULT 'warning',
  alert_data      JSONB,
  is_read         BOOLEAN DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  createdat       TIMESTAMPTZ DEFAULT NOW()
);

-- ── §12g CRON JOB LOG ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cron_job_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name    TEXT NOT NULL,
  status      TEXT DEFAULT 'running',
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  result      JSONB,
  error       TEXT,
  createdat   TIMESTAMPTZ DEFAULT NOW()
);

-- ── §13 ROW LEVEL SECURITY ─────────────────────────────────────────────────────

ALTER TABLE clinicusers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinicsettings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE encounters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE labreports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE patientallergies  ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE opdqueue          ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminderlog       ENABLE ROW LEVEL SECURITY;
ALTER TABLE beds              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipdadmissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipdchargerates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills             ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitalfund      ENABLE ROW LEVEL SECURITY;
ALTER TABLE labpartners       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ancregistrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ancvisits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE dischargesummaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE portalpatients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE portalsessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditlog          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE videorooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_portal_users  ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claims  ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claim_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_alerts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_job_log      ENABLE ROW LEVEL SECURITY;

-- clinicusers: active users read all; admin full write
CREATE POLICY cu_select ON clinicusers FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY cu_insert ON clinicusers FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY cu_update ON clinicusers FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY cu_delete ON clinicusers FOR DELETE TO authenticated USING (is_admin());

-- clinicsettings: all read; admin write
CREATE POLICY cs_select ON clinicsettings FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY cs_insert ON clinicsettings FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY cs_update ON clinicsettings FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY cs_delete ON clinicsettings FOR DELETE TO authenticated USING (is_admin());

-- patients: all active users full CRUD (reception workflow)
CREATE POLICY pat_select ON patients FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY pat_insert ON patients FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY pat_update ON patients FOR UPDATE TO authenticated USING (is_active_user());
CREATE POLICY pat_delete ON patients FOR DELETE TO authenticated USING (is_admin());

-- encounters: all active; delete doctor/admin
CREATE POLICY enc_select ON encounters FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY enc_insert ON encounters FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY enc_update ON encounters FOR UPDATE TO authenticated USING (is_active_user());
CREATE POLICY enc_delete ON encounters FOR DELETE TO authenticated USING (is_doctor_or_admin());

-- prescriptions: all active; delete doctor/admin
CREATE POLICY rx_select ON prescriptions FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY rx_insert ON prescriptions FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin());
CREATE POLICY rx_update ON prescriptions FOR UPDATE TO authenticated USING (is_doctor_or_admin());
CREATE POLICY rx_delete ON prescriptions FOR DELETE TO authenticated USING (is_doctor_or_admin());

-- lab reports: all active; write doctor/admin
CREATE POLICY lab_select ON labreports FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY lab_insert ON labreports FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin());
CREATE POLICY lab_update ON labreports FOR UPDATE TO authenticated USING (is_doctor_or_admin());
CREATE POLICY lab_delete ON labreports FOR DELETE TO authenticated USING (is_doctor_or_admin());

-- patient allergies: all active; write doctor/admin
CREATE POLICY allergy_select ON patientallergies FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY allergy_insert ON patientallergies FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin());
CREATE POLICY allergy_update ON patientallergies FOR UPDATE TO authenticated USING (is_doctor_or_admin());
CREATE POLICY allergy_delete ON patientallergies FOR DELETE TO authenticated USING (is_doctor_or_admin());

-- appointments: all active users full CRUD
CREATE POLICY appt_select ON appointments FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY appt_insert ON appointments FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY appt_update ON appointments FOR UPDATE TO authenticated USING (is_active_user());
CREATE POLICY appt_delete ON appointments FOR DELETE TO authenticated USING (is_doctor_or_admin());

-- opd queue, reminders, reminder log: all active
CREATE POLICY opd_all ON opdqueue    FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY rem_all ON reminders   FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY rml_all ON reminderlog FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());

-- beds: all active
CREATE POLICY beds_select ON beds FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY beds_insert ON beds FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY beds_update ON beds FOR UPDATE TO authenticated USING (is_active_user());
CREATE POLICY beds_delete ON beds FOR DELETE TO authenticated USING (is_admin());

-- ipd admissions: all active; delete admin
CREATE POLICY ipd_select ON ipdadmissions FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY ipd_insert ON ipdadmissions FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY ipd_update ON ipdadmissions FOR UPDATE TO authenticated USING (is_doctor_or_admin());
CREATE POLICY ipd_delete ON ipdadmissions FOR DELETE TO authenticated USING (is_admin());

-- ipdchargerates: all read; admin write
CREATE POLICY ipdcr_select ON ipdchargerates FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY ipdcr_insert ON ipdchargerates FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY ipdcr_update ON ipdchargerates FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY ipdcr_delete ON ipdchargerates FOR DELETE TO authenticated USING (is_admin());

-- bills: all active read; staff/admin insert; admin update/delete
CREATE POLICY bill_select ON bills FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY bill_insert ON bills FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY bill_update ON bills FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY bill_delete ON bills FOR DELETE TO authenticated USING (is_admin());

-- hospital fund: all active read/insert; admin update/delete
CREATE POLICY fund_select ON hospitalfund FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY fund_insert ON hospitalfund FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY fund_update ON hospitalfund FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY fund_delete ON hospitalfund FOR DELETE TO authenticated USING (is_admin());

-- lab partners: all active read; admin write
CREATE POLICY lp_select ON labpartners FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY lp_insert ON labpartners FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY lp_update ON labpartners FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY lp_delete ON labpartners FOR DELETE TO authenticated USING (is_admin());

-- anc: all active
CREATE POLICY anc_all ON ancregistrations FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY ancv_all ON ancvisits FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());

-- dischargesummaries: all read; all insert; update only if not final (admin bypass); delete admin
CREATE POLICY ds_select ON dischargesummaries FOR SELECT TO authenticated USING (true);
CREATE POLICY ds_insert ON dischargesummaries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ds_update ON dischargesummaries FOR UPDATE TO authenticated
  USING (isfinal = FALSE OR is_admin());
CREATE POLICY ds_delete ON dischargesummaries FOR DELETE TO authenticated USING (is_admin());

-- portal: service role only (no direct authenticated access)
CREATE POLICY pp_none ON portalpatients  FOR ALL TO authenticated USING (false);
CREATE POLICY ps_none ON portalsessions  FOR ALL TO authenticated USING (false);

-- audit log: all active read; insert from any (service role handles inserts)
CREATE POLICY audit_select ON auditlog FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY audit_insert ON auditlog FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY audit_delete ON auditlog FOR DELETE TO authenticated USING (is_admin());

-- attachments: all active
CREATE POLICY att_all ON attachments FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());

-- video rooms: all active
CREATE POLICY vid_all ON videorooms FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());

-- clinic_notifications: all active read; insert from any; delete admin
CREATE POLICY notif_select ON clinic_notifications FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY notif_insert ON clinic_notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY notif_update ON clinic_notifications FOR UPDATE TO authenticated USING (is_active_user());
CREATE POLICY notif_delete ON clinic_notifications FOR DELETE TO authenticated USING (is_admin());

-- lab_portal_users: admin only for management; service role for token verify
CREATE POLICY lpu_select ON lab_portal_users FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY lpu_insert ON lab_portal_users FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY lpu_update ON lab_portal_users FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY lpu_delete ON lab_portal_users FOR DELETE TO authenticated USING (is_admin());

-- insurance_claims: all active read; staff/admin insert; update active users
CREATE POLICY ic_select ON insurance_claims FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY ic_insert ON insurance_claims FOR INSERT TO authenticated WITH CHECK (is_active_user());
CREATE POLICY ic_update ON insurance_claims FOR UPDATE TO authenticated USING (is_active_user());
CREATE POLICY ic_delete ON insurance_claims FOR DELETE TO authenticated USING (is_admin());

-- insurance_claim_history: all active read; insert from any
CREATE POLICY ich_select ON insurance_claim_history FOR SELECT TO authenticated USING (is_active_user());
CREATE POLICY ich_insert ON insurance_claim_history FOR INSERT TO authenticated WITH CHECK (true);

-- whatsapp_notifications: all active
CREATE POLICY wn_all ON whatsapp_notifications FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());

-- doctor_alerts: all active
CREATE POLICY da_all ON doctor_alerts FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user());

-- cron_job_log: admin only
CREATE POLICY cjl_select ON cron_job_log FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY cjl_insert ON cron_job_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY cjl_update ON cron_job_log FOR UPDATE TO authenticated USING (is_admin());

-- ── §14 INDEXES ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_patients_mrn         ON patients (mrn);
CREATE INDEX IF NOT EXISTS idx_patients_mobile      ON patients (mobile);
CREATE INDEX IF NOT EXISTS idx_patients_fullname    ON patients (fullname);
CREATE INDEX IF NOT EXISTS idx_patients_abhaid      ON patients (abhaid) WHERE abhaid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patients_createdat   ON patients (createdat DESC);

CREATE INDEX IF NOT EXISTS idx_encounters_patient   ON encounters (patientid);
CREATE INDEX IF NOT EXISTS idx_encounters_date      ON encounters (date DESC);

CREATE INDEX IF NOT EXISTS idx_rx_patient           ON prescriptions (patientid);
CREATE INDEX IF NOT EXISTS idx_rx_encounter         ON prescriptions (encounterid);

CREATE INDEX IF NOT EXISTS idx_labs_patient         ON labreports (patientid);
CREATE INDEX IF NOT EXISTS idx_labs_date            ON labreports (reportdate DESC);

CREATE INDEX IF NOT EXISTS idx_appt_date            ON appointments (date);
CREATE INDEX IF NOT EXISTS idx_appt_patient         ON appointments (patientid);
CREATE INDEX IF NOT EXISTS idx_appt_status          ON appointments (status);

CREATE INDEX IF NOT EXISTS idx_reminders_due        ON reminders (duedate) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_beds_status          ON beds (status);

CREATE INDEX IF NOT EXISTS idx_ipd_patient          ON ipdadmissions (patientid);
CREATE INDEX IF NOT EXISTS idx_ipd_status           ON ipdadmissions (status);

CREATE INDEX IF NOT EXISTS idx_bills_patient        ON bills (patientid);
CREATE INDEX IF NOT EXISTS idx_bills_status         ON bills (status);

CREATE INDEX IF NOT EXISTS idx_anc_patient          ON ancregistrations (patientid);

CREATE INDEX IF NOT EXISTS idx_ds_patient           ON dischargesummaries (patientid);
CREATE INDEX IF NOT EXISTS idx_ds_isfinal           ON dischargesummaries (isfinal) WHERE isfinal = TRUE;
CREATE INDEX IF NOT EXISTS idx_ds_patient_final     ON dischargesummaries (patientid, isfinal);

CREATE INDEX IF NOT EXISTS idx_audit_userid         ON auditlog (userid);
CREATE INDEX IF NOT EXISTS idx_audit_entityid       ON auditlog (entityid);
CREATE INDEX IF NOT EXISTS idx_audit_createdat      ON auditlog (createdat DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action         ON auditlog (action);

CREATE INDEX IF NOT EXISTS idx_portal_token         ON portalsessions (token);
CREATE INDEX IF NOT EXISTS idx_portal_expiry        ON portalsessions (expiresat);

-- New table indexes
CREATE INDEX IF NOT EXISTS idx_notif_createdat      ON clinic_notifications (createdat DESC);
CREATE INDEX IF NOT EXISTS idx_notif_type           ON clinic_notifications (type);
CREATE INDEX IF NOT EXISTS idx_notif_unread         ON clinic_notifications (is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notif_patient        ON clinic_notifications (patient_id) WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lpu_token            ON lab_portal_users (auth_token);
CREATE INDEX IF NOT EXISTS idx_lpu_partner          ON lab_portal_users (lab_partner_id);

CREATE INDEX IF NOT EXISTS idx_ic_patient           ON insurance_claims (patient_id);
CREATE INDEX IF NOT EXISTS idx_ic_status            ON insurance_claims (status);
CREATE INDEX IF NOT EXISTS idx_ic_createdat         ON insurance_claims (createdat DESC);

CREATE INDEX IF NOT EXISTS idx_wn_patient           ON whatsapp_notifications (patient_id);
CREATE INDEX IF NOT EXISTS idx_wn_status            ON whatsapp_notifications (status);
CREATE INDEX IF NOT EXISTS idx_wn_type              ON whatsapp_notifications (notification_type);

CREATE INDEX IF NOT EXISTS idx_da_unread            ON doctor_alerts (is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_da_patient           ON doctor_alerts (patient_id);

-- ── DONE ──────────────────────────────────────────────────────────────────────
SELECT 'v00-schema-master: fresh database bootstrap complete' AS result;
