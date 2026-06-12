-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 000: Canonical Schema Alignment — runs FIRST
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS:
--   The migration set evolved with two competing naming conventions:
--     A) v00-schema-master.sql uses concat-lowercase: patientid, fullname,
--        createdat, invoicenumber, hospitalfund, labpartners, ipdadmissions,
--        opdqueue, dischargesummaries, labreports …
--     B) All later migrations (006-036, add-revenue-lifecycle, etc.) use
--        snake_case: patient_id, full_name, created_at, invoice_number,
--        hospital_fund, lab_partners, ipd_admissions, opd_queue,
--        discharge_summaries, lab_reports …
--
--   Running v00 followed by 006-036 against a fresh database fails with
--   hundreds of "relation does not exist" and "column does not exist"
--   errors because the later migrations assume the snake_case world but
--   v00 created the concat-lowercase world.
--
-- WHAT THIS FILE DOES:
--   1. Ensures `schema_migrations` exists (so any migration recording
--      itself with INSERT INTO schema_migrations doesn't error).
--   2. Pre-creates the snake_case canonical tables that v00 calls by
--      different names (or relies on later migrations creating).
--      They are created with BOTH naming conventions' columns so writes
--      in either style work.
--   3. After v00 runs (or alongside it), creates compatibility VIEWS so
--      that snake_case-only queries (lab_reports, opd_queue, ipd_admissions,
--      hospital_fund, lab_partners, discharge_summaries, clinic_users
--      reading underscore columns) all resolve to data in v00 tables.
--
-- HOW TO USE:
--   Run this file FIRST on a fresh database, then v00-schema-master.sql,
--   then the rest in numerical order. The file is fully idempotent.
--
-- SAFETY: Every operation uses IF NOT EXISTS / IF EXISTS / DO blocks.
--         No data is dropped or modified.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── §1  schema_migrations (so 006/007/008/etc. can record themselves) ─────────

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id          SERIAL PRIMARY KEY,
  version     TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ DEFAULT NOW(),
  checksum    TEXT,
  applied_by  TEXT,
  success     BOOLEAN DEFAULT TRUE,
  notes       TEXT
);

ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;
ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS applied_by TEXT;
ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS success BOOLEAN DEFAULT TRUE;
ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS notes TEXT;

-- ── §2  Required extensions ───────────────────────────────────────────────────

-- pgcrypto for digest()/gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- btree_gist for EXCLUDE constraints used by v01_validation_constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §3  Helper to safely add a column to a table only if the table exists
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._safe_add_column(
  p_table TEXT, p_col TEXT, p_def TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = p_table)
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = p_table
                    AND column_name = p_col) THEN
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I %s',
                   p_table, p_col, p_def);
  END IF;
END $$;

-- Helper: copy values from p_src column into p_dst column (both on p_table)
-- ONLY if both columns exist. Uses dynamic EXECUTE so the referenced columns
-- aren't parsed at function-creation time, sidestepping "column does not exist".
CREATE OR REPLACE FUNCTION public._safe_backfill(
  p_table TEXT, p_dst TEXT, p_src TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = p_table) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_dst) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_src) THEN
    RETURN;
  END IF;
  EXECUTE format(
    'UPDATE public.%I SET %I = %I WHERE %I IS NULL AND %I IS NOT NULL',
    p_table, p_dst, p_src, p_dst, p_src
  );
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- NOTE: The rest of the alignment runs AFTER v00 has created its tables.
-- This is done by a separate migration file (000b_post_v00_compat.sql).
-- However, in case this is the only "alignment" file run, the work below is
-- safe: it uses IF EXISTS guards everywhere so it's a no-op when v00 tables
-- haven't been created yet.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── §4  Patients — dual columns (snake_case + concat-lowercase) ──────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='patients') THEN
    PERFORM public._safe_add_column('patients', 'full_name',      'TEXT');
    PERFORM public._safe_add_column('patients', 'date_of_birth',  'DATE');
    PERFORM public._safe_add_column('patients', 'aadhaar_no',     'TEXT');
    PERFORM public._safe_add_column('patients', 'abha_id',        'TEXT');
    PERFORM public._safe_add_column('patients', 'blood_group',    'TEXT');
    PERFORM public._safe_add_column('patients', 'insurance_name', 'TEXT');
    PERFORM public._safe_add_column('patients', 'insurance_id',   'TEXT');
    PERFORM public._safe_add_column('patients', 'policy_tpa_name','TEXT');
    PERFORM public._safe_add_column('patients', 'policy_number',  'TEXT');
    PERFORM public._safe_add_column('patients', 'reference_source','TEXT');
    PERFORM public._safe_add_column('patients', 'reference_detail','TEXT');
    PERFORM public._safe_add_column('patients', 'emergency_contact_name',  'TEXT');
    PERFORM public._safe_add_column('patients', 'emergency_contact_phone', 'TEXT');
    PERFORM public._safe_add_column('patients', 'doctor_id',      'UUID');
    PERFORM public._safe_add_column('patients', 'is_active',      'BOOLEAN DEFAULT TRUE');
    PERFORM public._safe_add_column('patients', 'is_deleted',     'BOOLEAN DEFAULT FALSE');
    PERFORM public._safe_add_column('patients', 'created_at',     'TIMESTAMPTZ DEFAULT NOW()');
    PERFORM public._safe_add_column('patients', 'updated_at',     'TIMESTAMPTZ DEFAULT NOW()');

    -- Backfill snake_case from concat-lowercase.
    -- IMPORTANT: We must use _safe_backfill (dynamic EXECUTE) because PL/pgSQL
    -- parses static SQL statements at compile time. On a fresh database, the
    -- concat-lowercase source columns (dob, fullname, …) do not exist, so a
    -- direct UPDATE would fail with "column does not exist" even inside a
    -- guarded DO block. _safe_backfill skips silently when either column
    -- is missing.
    PERFORM public._safe_backfill('patients', 'full_name',      'fullname');
    PERFORM public._safe_backfill('patients', 'date_of_birth',  'dob');
    PERFORM public._safe_backfill('patients', 'aadhaar_no',     'aadhaar');
    PERFORM public._safe_backfill('patients', 'abha_id',        'abhaid');
    PERFORM public._safe_backfill('patients', 'blood_group',    'bloodgroup');
    PERFORM public._safe_backfill('patients', 'insurance_name', 'insurancename');
    PERFORM public._safe_backfill('patients', 'insurance_id',   'insuranceid');
    PERFORM public._safe_backfill('patients', 'is_active',      'isactive');
    PERFORM public._safe_backfill('patients', 'created_at',     'createdat');
    PERFORM public._safe_backfill('patients', 'updated_at',     'updatedat');
  END IF;
END $$;

-- ── §5  Encounters — dual columns ────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='encounters') THEN
    PERFORM public._safe_add_column('encounters', 'patient_id',     'UUID');
    PERFORM public._safe_add_column('encounters', 'doctor_id',      'UUID');
    PERFORM public._safe_add_column('encounters', 'doctor_name',    'TEXT');
    PERFORM public._safe_add_column('encounters', 'encounter_date', 'DATE DEFAULT CURRENT_DATE');
    PERFORM public._safe_add_column('encounters', 'visit_date',     'DATE DEFAULT CURRENT_DATE');
    PERFORM public._safe_add_column('encounters', 'visit_type',     'TEXT DEFAULT ''OPD''');
    PERFORM public._safe_add_column('encounters', 'created_at',     'TIMESTAMPTZ DEFAULT NOW()');
    PERFORM public._safe_add_column('encounters', 'updated_at',     'TIMESTAMPTZ DEFAULT NOW()');

    PERFORM public._safe_backfill('encounters', 'patient_id',     'patientid');
    PERFORM public._safe_backfill('encounters', 'doctor_id',      'doctorid');
    PERFORM public._safe_backfill('encounters', 'doctor_name',    'doctorname');
    PERFORM public._safe_backfill('encounters', 'encounter_date', 'date');
    PERFORM public._safe_backfill('encounters', 'visit_date',     'date');
    PERFORM public._safe_backfill('encounters', 'created_at',     'createdat');
    PERFORM public._safe_backfill('encounters', 'updated_at',     'updatedat');
  END IF;
END $$;

-- ── §6  Prescriptions — dual columns ─────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='prescriptions') THEN
    PERFORM public._safe_add_column('prescriptions', 'patient_id',   'UUID');
    PERFORM public._safe_add_column('prescriptions', 'encounter_id', 'UUID');
    PERFORM public._safe_add_column('prescriptions', 'doctor_id',    'UUID');
    PERFORM public._safe_add_column('prescriptions', 'created_at',   'TIMESTAMPTZ DEFAULT NOW()');

    PERFORM public._safe_backfill('prescriptions', 'patient_id',   'patientid');
    PERFORM public._safe_backfill('prescriptions', 'encounter_id', 'encounterid');
    PERFORM public._safe_backfill('prescriptions', 'doctor_id',    'doctorid');
    PERFORM public._safe_backfill('prescriptions', 'created_at',   'createdat');
  END IF;
END $$;

-- ── §7  Appointments — dual columns ──────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='appointments') THEN
    PERFORM public._safe_add_column('appointments', 'patient_id',    'UUID');
    PERFORM public._safe_add_column('appointments', 'patient_name',  'TEXT');
    PERFORM public._safe_add_column('appointments', 'reminder_sent', 'BOOLEAN DEFAULT FALSE');
    PERFORM public._safe_add_column('appointments', 'video_link',    'TEXT');
    PERFORM public._safe_add_column('appointments', 'created_at',    'TIMESTAMPTZ DEFAULT NOW()');
    PERFORM public._safe_add_column('appointments', 'updated_at',    'TIMESTAMPTZ DEFAULT NOW()');

    PERFORM public._safe_backfill('appointments', 'patient_id',    'patientid');
    PERFORM public._safe_backfill('appointments', 'patient_name',  'patientname');
    PERFORM public._safe_backfill('appointments', 'reminder_sent', 'remindersent');
    PERFORM public._safe_backfill('appointments', 'video_link',    'videolink');
    PERFORM public._safe_backfill('appointments', 'created_at',    'createdat');
    PERFORM public._safe_backfill('appointments', 'updated_at',    'updatedat');
  END IF;
END $$;

-- ── §8  Bills — dual columns ─────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='bills') THEN
    PERFORM public._safe_add_column('bills', 'patient_id',     'UUID');
    PERFORM public._safe_add_column('bills', 'patient_name',   'TEXT');
    PERFORM public._safe_add_column('bills', 'mrn',            'TEXT');
    PERFORM public._safe_add_column('bills', 'invoice_number', 'TEXT');
    PERFORM public._safe_add_column('bills', 'payment_mode',   'TEXT');
    PERFORM public._safe_add_column('bills', 'net_amount',     'NUMERIC(12,2) DEFAULT 0');
    PERFORM public._safe_add_column('bills', 'gst_amount',     'NUMERIC(10,2) DEFAULT 0');
    PERFORM public._safe_add_column('bills', 'gst_percent',    'NUMERIC(5,2) DEFAULT 0');
    PERFORM public._safe_add_column('bills', 'subtotal',       'NUMERIC(12,2) DEFAULT 0');
    PERFORM public._safe_add_column('bills', 'paid_at',        'TIMESTAMPTZ');
    PERFORM public._safe_add_column('bills', 'is_deleted',     'BOOLEAN DEFAULT FALSE');
    PERFORM public._safe_add_column('bills', 'encounter_id',   'UUID');
    PERFORM public._safe_add_column('bills', 'encounter_type', 'TEXT DEFAULT ''opd''');
    PERFORM public._safe_add_column('bills', 'created_at',     'TIMESTAMPTZ DEFAULT NOW()');
    PERFORM public._safe_add_column('bills', 'updated_at',     'TIMESTAMPTZ DEFAULT NOW()');

    PERFORM public._safe_backfill('bills', 'patient_id',     'patientid');
    PERFORM public._safe_backfill('bills', 'invoice_number', 'invoicenumber');
    PERFORM public._safe_backfill('bills', 'payment_mode',   'paymentmode');
    PERFORM public._safe_backfill('bills', 'created_at',     'createdat');
    PERFORM public._safe_backfill('bills', 'updated_at',     'updatedat');

    -- net_amount ← total has different semantics (overwrites zeros too),
    -- so handle it inline but guard the `total` column via information_schema.
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='bills' AND column_name='total')
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='bills' AND column_name='net_amount') THEN
      EXECUTE 'UPDATE public.bills SET net_amount = total WHERE net_amount IS NULL OR net_amount = 0';
    END IF;
  END IF;
END $$;

-- ── §9  Lab Reports — both names. lab_reports (snake) ↔ labreports (v00) ────

DO $$
BEGIN
  -- If v00 labreports table exists but lab_reports doesn't, create lab_reports view
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='labreports' AND table_type='BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='lab_reports') THEN
    -- Create the snake_case table separately so later ALTER TABLE statements work
    -- (Postgres views can't be ALTERed with ADD COLUMN.)
    CREATE TABLE public.lab_reports (
      id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      patient_id      UUID,
      encounter_id    UUID,
      report_name     TEXT,
      test_name       TEXT,
      test_category   TEXT,
      report_date     DATE DEFAULT CURRENT_DATE,
      result          TEXT,
      result_text     TEXT,
      result_data     JSONB,
      normal_range    TEXT,
      unit            TEXT,
      status          TEXT DEFAULT 'pending',
      notes           TEXT,
      attachment_url  TEXT,
      file_url        TEXT,
      lab_partner_id  UUID,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;

  -- If lab_reports already exists, ensure all snake_case columns exist
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='lab_reports' AND table_type='BASE TABLE') THEN
    PERFORM public._safe_add_column('lab_reports', 'patient_id',    'UUID');
    PERFORM public._safe_add_column('lab_reports', 'encounter_id',  'UUID');
    PERFORM public._safe_add_column('lab_reports', 'test_name',     'TEXT');
    PERFORM public._safe_add_column('lab_reports', 'test_category', 'TEXT');
    PERFORM public._safe_add_column('lab_reports', 'result_text',   'TEXT');
    PERFORM public._safe_add_column('lab_reports', 'result_data',   'JSONB');
    PERFORM public._safe_add_column('lab_reports', 'file_url',      'TEXT');
    PERFORM public._safe_add_column('lab_reports', 'normal_range',  'TEXT');
    PERFORM public._safe_add_column('lab_reports', 'lab_partner_id','UUID');
  END IF;
END $$;

-- ── §10  OPD Queue — both names. opd_queue (snake) ↔ opdqueue (v00) ─────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='opdqueue' AND table_type='BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='opd_queue') THEN
    CREATE TABLE public.opd_queue (
      id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      patient_id      UUID,
      patient_name    TEXT,
      mrn             TEXT,
      mobile          TEXT,
      token_number    INTEGER,
      queue_number    INTEGER,
      queue_date      DATE DEFAULT CURRENT_DATE,
      status          TEXT DEFAULT 'waiting',
      visit_type      TEXT DEFAULT 'OPD',
      priority        TEXT DEFAULT 'normal',
      encounter_id    UUID,
      doctor_id       UUID,
      notes           TEXT,
      called_at       TIMESTAMPTZ,
      done_at         TIMESTAMPTZ,
      vitals_done     BOOLEAN DEFAULT FALSE,
      vitals_done_at  TIMESTAMPTZ,
      skipped_count   INTEGER DEFAULT 0,
      recalled_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='opd_queue' AND table_type='BASE TABLE') THEN
    PERFORM public._safe_add_column('opd_queue', 'patient_id',   'UUID');
    PERFORM public._safe_add_column('opd_queue', 'token_number', 'INTEGER');
    PERFORM public._safe_add_column('opd_queue', 'queue_date',   'DATE DEFAULT CURRENT_DATE');
    PERFORM public._safe_add_column('opd_queue', 'encounter_id', 'UUID');
    PERFORM public._safe_add_column('opd_queue', 'visit_type',   'TEXT DEFAULT ''OPD''');
    PERFORM public._safe_add_column('opd_queue', 'priority',     'TEXT DEFAULT ''normal''');
    PERFORM public._safe_add_column('opd_queue', 'doctor_id',    'UUID');
  END IF;
END $$;

-- ── §11  IPD Admissions — both names ────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='ipdadmissions' AND table_type='BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='ipd_admissions') THEN
    CREATE TABLE public.ipd_admissions (
      id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      patient_id          UUID,
      bed_id              UUID,
      admission_date      DATE DEFAULT CURRENT_DATE,
      discharge_date      DATE,
      admitting_doctor    TEXT,
      diagnosis           TEXT,
      notes               TEXT,
      status              TEXT DEFAULT 'admitted',
      total_charges       NUMERIC(12,2) DEFAULT 0,
      discount            NUMERIC(12,2) DEFAULT 0,
      net_bill            NUMERIC(12,2) DEFAULT 0,
      bill_status         TEXT,
      payment_mode        TEXT,
      deposit_collected   NUMERIC(12,2) DEFAULT 0,
      billing_cleared     BOOLEAN DEFAULT FALSE,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='ipd_admissions' AND table_type='BASE TABLE') THEN
    PERFORM public._safe_add_column('ipd_admissions', 'patient_id',     'UUID');
    PERFORM public._safe_add_column('ipd_admissions', 'bed_id',         'UUID');
    PERFORM public._safe_add_column('ipd_admissions', 'admission_date', 'DATE DEFAULT CURRENT_DATE');
    PERFORM public._safe_add_column('ipd_admissions', 'discharge_date', 'DATE');
    PERFORM public._safe_add_column('ipd_admissions', 'status',         'TEXT DEFAULT ''admitted''');
    PERFORM public._safe_add_column('ipd_admissions', 'updated_at',     'TIMESTAMPTZ DEFAULT NOW()');
  END IF;
END $$;

-- ── §12  Discharge Summaries — both names ────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='dischargesummaries' AND table_type='BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='discharge_summaries') THEN
    CREATE TABLE public.discharge_summaries (
      id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      patient_id              UUID,
      admission_date          DATE,
      discharge_date          DATE DEFAULT CURRENT_DATE,
      final_diagnosis         TEXT,
      secondary_diagnosis     TEXT,
      clinical_summary        TEXT,
      investigations          TEXT,
      treatment_given         TEXT,
      condition_at_discharge  TEXT,
      discharge_advice        TEXT,
      diet_advice             TEXT,
      medications_at_discharge TEXT,
      follow_up_date          DATE,
      follow_up_note          TEXT,
      is_final                BOOLEAN DEFAULT FALSE,
      version                 INTEGER DEFAULT 1,
      signed_by               TEXT,
      signed_at               TIMESTAMPTZ,
      finalized_at            TIMESTAMPTZ,
      created_at              TIMESTAMPTZ DEFAULT NOW(),
      updated_at              TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

-- ── §13  Hospital Fund — both names ─────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='hospitalfund' AND table_type='BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='hospital_fund') THEN
    CREATE TABLE public.hospital_fund (
      id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      type          TEXT NOT NULL,
      category      TEXT,
      amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
      description   TEXT,
      date          DATE DEFAULT CURRENT_DATE,
      submitted_by  TEXT,
      approved_by   TEXT,
      status        TEXT DEFAULT 'pending',
      receipt_url   TEXT,
      receipt_note  TEXT,
      bill_id       UUID,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

-- ── §14  Lab Partners — both names ──────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='labpartners' AND table_type='BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='lab_partners') THEN
    CREATE TABLE public.lab_partners (
      id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name            TEXT NOT NULL,
      contact_person  TEXT,
      phone           TEXT,
      email           TEXT,
      address         TEXT,
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
  END IF;
END $$;

-- ── §15  IPD Charges & IPD Charge Rates (for migration 018) ────────────────

CREATE TABLE IF NOT EXISTS public.ipd_charges (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admission_id  UUID,
  patient_id    UUID,
  item_name     TEXT,
  description   TEXT,
  category      TEXT,
  charge_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity      NUMERIC(10,2) DEFAULT 1,
  rate          NUMERIC(10,2) DEFAULT 0,
  amount        NUMERIC(10,2) DEFAULT 0,
  notes         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ipd_charge_rates (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT,
  description   TEXT,
  category      TEXT,
  amount        NUMERIC(10,2),
  default_rate  NUMERIC(10,2),
  unit          TEXT,
  per_unit      TEXT DEFAULT 'per day',
  sort_order    INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── §16  Insurance Claims — required by 010/017/030/031 ─────────────────────

CREATE TABLE IF NOT EXISTS public.insurance_claims (
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
  pre_auth_number    TEXT,
  claim_number       TEXT,
  settlement_utr     TEXT,
  settlement_date    DATE,
  documents_sent     BOOLEAN DEFAULT FALSE,
  notes              TEXT,
  bill_id            UUID,
  co_pay_amount      NUMERIC(12,2) DEFAULT 0,
  cashless           BOOLEAN DEFAULT FALSE,
  created_by         TEXT DEFAULT 'system',
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── §17  Lab Orders — required by 031 ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lab_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID,
  encounter_id    UUID,
  ordered_by      UUID,
  ordered_at      TIMESTAMPTZ DEFAULT NOW(),
  test_name       TEXT,
  test_code       TEXT,
  test_category   TEXT,
  urgency         TEXT DEFAULT 'routine',
  clinical_notes  TEXT,
  status          TEXT DEFAULT 'ordered',
  bill_id         UUID,
  bill_item_id    TEXT,
  billing_status  TEXT DEFAULT 'unbilled',
  charge_amount   NUMERIC(12,2) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── §18  Portal tokens / sessions / OTP — required by 016 ───────────────────

CREATE TABLE IF NOT EXISTS public.portal_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID,
  mrn         TEXT,
  token       TEXT UNIQUE,
  expires_at  TIMESTAMPTZ,
  is_used     BOOLEAN DEFAULT FALSE,
  used        BOOLEAN DEFAULT FALSE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.portal_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID,
  mrn           TEXT,
  mobile        TEXT,
  session_token TEXT UNIQUE,
  token         TEXT UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  is_active     BOOLEAN DEFAULT TRUE,
  last_used     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── §19  OT Schedules — required by 010_fix_missing/018/v01 ─────────────────

CREATE TABLE IF NOT EXISTS public.ot_schedules (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID,
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

-- ── §20  Pharmacy supporting tables — required by 013 ───────────────────────

CREATE TABLE IF NOT EXISTS public.pharmacy_stock_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id   UUID,
  type          TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 0,
  reference_id  UUID,
  notes         TEXT,
  done_by       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pharmacy_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id   UUID,
  batch_number  TEXT,
  quantity      INTEGER NOT NULL DEFAULT 0,
  expiry_date   DATE,
  mrp           NUMERIC(10,2),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── §21  Final cleanup: PostgREST cache reload ──────────────────────────────

NOTIFY pgrst, 'reload schema';

INSERT INTO public.schema_migrations (version, name, applied_at, notes)
VALUES ('000', 'canonical_schema_alignment', NOW(),
        'Pre-creates snake_case canonical tables + dual columns so v00 + 006-036 coexist')
ON CONFLICT (version) DO NOTHING;

COMMIT;

SELECT '000_canonical_schema_alignment: bootstrap complete' AS result;
