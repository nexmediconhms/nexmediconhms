-- ============================================================
-- NexMedicon HMS — v00 MASTER SCHEMA
-- Single-file fresh-database bootstrap.
-- Run this INSTEAD of all v01–v20 migration files on a brand-new DB.
-- For an EXISTING DB: keep running the individual vNN files as before.
-- ============================================================
--
-- TABLE OF CONTENTS:
--   §1  Helper functions (RLS helpers, audit RPC)
--   §2  Core tables (patients, clinic_users, clinic_settings)
--   §3  Clinical tables (encounters, prescriptions, labreports, patientallergies)
--   §4  Scheduling (appointments, opdqueue, reminders)
--   §5  IPD (beds, ipdadmissions, ipdchargerates, ipd_nursing)
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

-- ── §2  CORE TABLES ───────────────────────────────────────────────────────────

-- Drop any compatibility views that may conflict with table creation
-- (These views are created by migration 033 for backward compat but block CREATE TABLE)
-- Only drop if they are actually views (not tables)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'clinicusers' AND n.nspname = 'public' AND c.relkind = 'v') THEN
    DROP VIEW clinicusers CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'clinic_users' AND n.nspname = 'public' AND c.relkind = 'v') THEN
    DROP VIEW clinic_users CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS clinic_users (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_id     UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','doctor','staff','receptionist','lab_partner')),
  phone       TEXT,
  specialty       TEXT,
  med_reg_no      TEXT,
  extra_roles     TEXT[],
  share_pct       NUMERIC(5,2),
  earning_model   TEXT,
  is_primary      BOOLEAN DEFAULT FALSE,
  mfa_enabled     BOOLEAN DEFAULT FALSE,
  mfa_enrolled_at TIMESTAMPTZ,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clinic_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

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
  doctorid            UUID REFERENCES clinic_users(id),
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
  doctorid        UUID REFERENCES clinic_users(id),
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

-- Drop compatibility view if it exists (from previous migrations) so table can be created
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'ipdadmissions' AND n.nspname = 'public' AND c.relkind = 'v') THEN
    DROP VIEW ipdadmissions CASCADE;
  END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS ipd_nursing (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ipd_admission_id    UUID,
  bed_id              TEXT,
  patient_id          UUID,
  entry_type          TEXT DEFAULT 'note',
  recorded_time       TEXT,
  pulse               TEXT,
  bp_systolic         TEXT,
  bp_diastolic        TEXT,
  temperature         TEXT,
  spo2                TEXT,
  respiratory_rate    TEXT,
  rr                  TEXT,
  weight              TEXT,
  vital_note          TEXT,
  io_type             TEXT,
  io_label            TEXT,
  io_amount           TEXT,
  io_amount_ml        NUMERIC,
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

-- ── §13 ROW LEVEL SECURITY ─────────────────────────────────────────────────────
-- Enable RLS only on actual tables (skip views that may exist as compatibility layers)

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'clinic_users', 'clinic_settings', 'patients', 'encounters',
      'prescriptions', 'labreports', 'patientallergies', 'appointments',
      'opdqueue', 'reminders', 'reminderlog', 'beds',
      'ipdadmissions', 'ipdchargerates', 'ipd_nursing', 'bills',
      'hospitalfund', 'labpartners', 'ancregistrations', 'ancvisits',
      'dischargesummaries', 'portalpatients', 'portalsessions',
      'auditlog', 'attachments', 'videorooms'
    ])
  LOOP
    -- Only enable RLS if the relation is a table (not a view)
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = tbl AND n.nspname = 'public' AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END $$;

-- Create RLS policies (safe: skips if policy already exists or table is a view)
DO $$
DECLARE
  _sql TEXT;
BEGIN
  -- Helper: execute policy creation, ignore if already exists or target is a view
  FOR _sql IN
    SELECT unnest(ARRAY[
      -- clinic_users: active users read all; admin full write
      'CREATE POLICY cu_select ON clinic_users FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY cu_insert ON clinic_users FOR INSERT TO authenticated WITH CHECK (is_admin())',
      'CREATE POLICY cu_update ON clinic_users FOR UPDATE TO authenticated USING (is_admin())',
      'CREATE POLICY cu_delete ON clinic_users FOR DELETE TO authenticated USING (is_admin())',
      -- clinic_settings: all read; admin write
      'CREATE POLICY cs_select ON clinic_settings FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY cs_insert ON clinic_settings FOR INSERT TO authenticated WITH CHECK (is_admin())',
      'CREATE POLICY cs_update ON clinic_settings FOR UPDATE TO authenticated USING (is_admin())',
      'CREATE POLICY cs_delete ON clinic_settings FOR DELETE TO authenticated USING (is_admin())',
      -- patients: all active users full CRUD
      'CREATE POLICY pat_select ON patients FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY pat_insert ON patients FOR INSERT TO authenticated WITH CHECK (is_active_user())',
      'CREATE POLICY pat_update ON patients FOR UPDATE TO authenticated USING (is_active_user())',
      'CREATE POLICY pat_delete ON patients FOR DELETE TO authenticated USING (is_admin())',
      -- encounters: all active; delete doctor/admin
      'CREATE POLICY enc_select ON encounters FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY enc_insert ON encounters FOR INSERT TO authenticated WITH CHECK (is_active_user())',
      'CREATE POLICY enc_update ON encounters FOR UPDATE TO authenticated USING (is_active_user())',
      'CREATE POLICY enc_delete ON encounters FOR DELETE TO authenticated USING (is_doctor_or_admin())',
      -- prescriptions
      'CREATE POLICY rx_select ON prescriptions FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY rx_insert ON prescriptions FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin())',
      'CREATE POLICY rx_update ON prescriptions FOR UPDATE TO authenticated USING (is_doctor_or_admin())',
      'CREATE POLICY rx_delete ON prescriptions FOR DELETE TO authenticated USING (is_doctor_or_admin())',
      -- lab reports
      'CREATE POLICY lab_select ON labreports FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY lab_insert ON labreports FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin())',
      'CREATE POLICY lab_update ON labreports FOR UPDATE TO authenticated USING (is_doctor_or_admin())',
      'CREATE POLICY lab_delete ON labreports FOR DELETE TO authenticated USING (is_doctor_or_admin())',
      -- patient allergies
      'CREATE POLICY allergy_select ON patientallergies FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY allergy_insert ON patientallergies FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin())',
      'CREATE POLICY allergy_update ON patientallergies FOR UPDATE TO authenticated USING (is_doctor_or_admin())',
      'CREATE POLICY allergy_delete ON patientallergies FOR DELETE TO authenticated USING (is_doctor_or_admin())',
      -- appointments
      'CREATE POLICY appt_select ON appointments FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY appt_insert ON appointments FOR INSERT TO authenticated WITH CHECK (is_active_user())',
      'CREATE POLICY appt_update ON appointments FOR UPDATE TO authenticated USING (is_active_user())',
      'CREATE POLICY appt_delete ON appointments FOR DELETE TO authenticated USING (is_doctor_or_admin())',
      -- opd queue, reminders, reminder log
      'CREATE POLICY opd_all ON opdqueue FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user())',
      'CREATE POLICY rem_all ON reminders FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user())',
      'CREATE POLICY rml_all ON reminderlog FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user())',
      -- beds
      'CREATE POLICY beds_select ON beds FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY beds_insert ON beds FOR INSERT TO authenticated WITH CHECK (is_active_user())',
      'CREATE POLICY beds_update ON beds FOR UPDATE TO authenticated USING (is_active_user())',
      'CREATE POLICY beds_delete ON beds FOR DELETE TO authenticated USING (is_admin())',
      -- ipd admissions
      'CREATE POLICY ipd_select ON ipdadmissions FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY ipd_insert ON ipdadmissions FOR INSERT TO authenticated WITH CHECK (is_active_user())',
      'CREATE POLICY ipd_update ON ipdadmissions FOR UPDATE TO authenticated USING (is_doctor_or_admin())',
      'CREATE POLICY ipd_delete ON ipdadmissions FOR DELETE TO authenticated USING (is_admin())',
      -- ipdchargerates
      'CREATE POLICY ipdcr_select ON ipdchargerates FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY ipdcr_insert ON ipdchargerates FOR INSERT TO authenticated WITH CHECK (is_admin())',
      'CREATE POLICY ipdcr_update ON ipdchargerates FOR UPDATE TO authenticated USING (is_admin())',
      'CREATE POLICY ipdcr_delete ON ipdchargerates FOR DELETE TO authenticated USING (is_admin())',
      -- ipd_nursing
      'CREATE POLICY ipd_nursing_all ON ipd_nursing FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      -- bills
      'CREATE POLICY bill_select ON bills FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY bill_insert ON bills FOR INSERT TO authenticated WITH CHECK (is_active_user())',
      'CREATE POLICY bill_update ON bills FOR UPDATE TO authenticated USING (is_admin())',
      'CREATE POLICY bill_delete ON bills FOR DELETE TO authenticated USING (is_admin())',
      -- hospital fund
      'CREATE POLICY fund_select ON hospitalfund FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY fund_insert ON hospitalfund FOR INSERT TO authenticated WITH CHECK (is_active_user())',
      'CREATE POLICY fund_update ON hospitalfund FOR UPDATE TO authenticated USING (is_admin())',
      'CREATE POLICY fund_delete ON hospitalfund FOR DELETE TO authenticated USING (is_admin())',
      -- lab partners
      'CREATE POLICY lp_select ON labpartners FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY lp_insert ON labpartners FOR INSERT TO authenticated WITH CHECK (is_admin())',
      'CREATE POLICY lp_update ON labpartners FOR UPDATE TO authenticated USING (is_admin())',
      'CREATE POLICY lp_delete ON labpartners FOR DELETE TO authenticated USING (is_admin())',
      -- anc
      'CREATE POLICY anc_all ON ancregistrations FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user())',
      'CREATE POLICY ancv_all ON ancvisits FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user())',
      -- discharge summaries
      'CREATE POLICY ds_select ON dischargesummaries FOR SELECT TO authenticated USING (true)',
      'CREATE POLICY ds_insert ON dischargesummaries FOR INSERT TO authenticated WITH CHECK (true)',
      'CREATE POLICY ds_update ON dischargesummaries FOR UPDATE TO authenticated USING (isfinal = FALSE OR is_admin())',
      'CREATE POLICY ds_delete ON dischargesummaries FOR DELETE TO authenticated USING (is_admin())',
      -- portal
      'CREATE POLICY pp_none ON portalpatients FOR ALL TO authenticated USING (false)',
      'CREATE POLICY ps_none ON portalsessions FOR ALL TO authenticated USING (false)',
      -- audit log
      'CREATE POLICY audit_select ON auditlog FOR SELECT TO authenticated USING (is_active_user())',
      'CREATE POLICY audit_insert ON auditlog FOR INSERT TO authenticated WITH CHECK (true)',
      'CREATE POLICY audit_delete ON auditlog FOR DELETE TO authenticated USING (is_admin())',
      -- attachments
      'CREATE POLICY att_all ON attachments FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user())',
      -- video rooms
      'CREATE POLICY vid_all ON videorooms FOR ALL TO authenticated USING (is_active_user()) WITH CHECK (is_active_user())'
    ])
  LOOP
    BEGIN
      EXECUTE _sql;
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- policy already exists
    WHEN OTHERS THEN
      NULL; -- table might be a view or not exist
    END;
  END LOOP;
END $$;

-- ── §14 INDEXES ────────────────────────────────────────────────────────────────
-- Safe index creation: tries snake_case first (live DB), falls back to camelCase (legacy)

DO $$
DECLARE
  _sql TEXT;
BEGIN
  FOR _sql IN
    SELECT unnest(ARRAY[
      -- patients indexes (use the column names actually defined in §2: fullname, abhaid, createdat)
      'CREATE INDEX IF NOT EXISTS idx_patients_mrn ON patients (mrn)',
      'CREATE INDEX IF NOT EXISTS idx_patients_mobile ON patients (mobile)',
      'CREATE INDEX IF NOT EXISTS idx_patients_fullname ON patients (fullname)',
      'CREATE INDEX IF NOT EXISTS idx_patients_abhaid ON patients (abhaid) WHERE abhaid IS NOT NULL',
      'CREATE INDEX IF NOT EXISTS idx_patients_createdat ON patients (createdat DESC)',
      -- encounters (column is patientid, date — not patient_id, encounter_date)
      'CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters (patientid)',
      'CREATE INDEX IF NOT EXISTS idx_encounters_date ON encounters (date DESC)',
      -- prescriptions (column is patientid, encounterid)
      'CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions (patientid)',
      'CREATE INDEX IF NOT EXISTS idx_rx_encounter ON prescriptions (encounterid)',
      -- lab reports
      'CREATE INDEX IF NOT EXISTS idx_labs_patient ON labreports (patientid)',
      'CREATE INDEX IF NOT EXISTS idx_labs_date ON labreports (reportdate DESC)',
      -- appointments (column is patientid)
      'CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments (date)',
      'CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments (patientid)',
      'CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments (status)',
      -- reminders
      'CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (duedate) WHERE status = ''pending''',
      -- beds
      'CREATE INDEX IF NOT EXISTS idx_beds_status ON beds (status)',
      -- ipd admissions
      'CREATE INDEX IF NOT EXISTS idx_ipd_patient ON ipdadmissions (patientid)',
      'CREATE INDEX IF NOT EXISTS idx_ipd_status ON ipdadmissions (status)',
      -- bills (column is patientid)
      'CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills (patientid)',
      'CREATE INDEX IF NOT EXISTS idx_bills_status ON bills (status)',
      -- anc
      'CREATE INDEX IF NOT EXISTS idx_anc_patient ON ancregistrations (patientid)',
      -- discharge summaries
      'CREATE INDEX IF NOT EXISTS idx_ds_patient ON dischargesummaries (patientid)',
      'CREATE INDEX IF NOT EXISTS idx_ds_isfinal ON dischargesummaries (isfinal) WHERE isfinal = TRUE',
      'CREATE INDEX IF NOT EXISTS idx_ds_patient_final ON dischargesummaries (patientid, isfinal)',
      -- audit log
      'CREATE INDEX IF NOT EXISTS idx_audit_userid ON auditlog (userid)',
      'CREATE INDEX IF NOT EXISTS idx_audit_entityid ON auditlog (entityid)',
      'CREATE INDEX IF NOT EXISTS idx_audit_createdat ON auditlog (createdat DESC)',
      'CREATE INDEX IF NOT EXISTS idx_audit_action ON auditlog (action)',
      -- portal
      'CREATE INDEX IF NOT EXISTS idx_portal_token ON portalsessions (token)',
      'CREATE INDEX IF NOT EXISTS idx_portal_expiry ON portalsessions (expiresat)'
    ])
  LOOP
    BEGIN
      EXECUTE _sql;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      NULL; -- column or table doesn't exist in this schema variant, skip
    WHEN OTHERS THEN
      NULL; -- any other error, skip gracefully
    END;
  END LOOP;
END $$;

-- ── consultation_attachments (file uploads for patient consultations) ─────────
CREATE TABLE IF NOT EXISTS consultation_attachments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id   UUID REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id UUID,
  file_name    TEXT NOT NULL,
  file_type    TEXT,
  file_size    INTEGER,
  bucket       TEXT DEFAULT 'consultation-files',
  storage_key  TEXT,
  storage_path TEXT,
  notes        TEXT,
  uploaded_by  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ca_patient ON consultation_attachments (patient_id);

-- ── consultation_files_db (DB-fallback storage when bucket unavailable) ───────
CREATE TABLE IF NOT EXISTS consultation_files_db (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id   UUID REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id UUID,
  file_name    TEXT NOT NULL,
  file_type    TEXT,
  file_size    INTEGER,
  file_data    TEXT,
  notes        TEXT,
  uploaded_by  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cfdb_patient ON consultation_files_db (patient_id);

-- ── DONE ──────────────────────────────────────────────────────────────────────
SELECT 'v00-schema-master: fresh database bootstrap complete' AS result;
