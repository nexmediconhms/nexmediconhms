-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 037: Post-v00 finalize — sync data between dual-named tables/columns
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS:
--   The migration set has two naming conventions running side-by-side
--   (v00 uses concat-lowercase, all others use snake_case). Migration
--   000_canonical_schema_alignment.sql pre-creates the snake_case
--   canonical tables so later migrations don't error out, but data
--   written through the v00 tables (patients, encounters, opdqueue,
--   ipdadmissions, labreports, hospitalfund, labpartners,
--   dischargesummaries, bills) must be visible through the snake_case
--   tables/columns too.
--
--   This migration runs LAST and:
--     1. Backfills snake_case columns from concat-lowercase columns
--        (and vice versa) on every dual-named table.
--     2. Backfills snake_case "shadow" tables (lab_reports, opd_queue,
--        ipd_admissions, …) from v00 base tables when both exist.
--     3. Adds triggers that keep both column names in sync for new writes,
--        but ONLY when BOTH columns of every pair actually exist on the table.
--
-- IMPORTANT — PL/pgSQL static-SQL parser:
--   Inside DO $$ blocks, PostgreSQL parses every static SQL statement at
--   compile time. Referencing a column that doesn't exist will fail
--   *before* any IF EXISTS guard runs. We therefore use either:
--     • public._safe_backfill(table, dst, src)  — dynamic EXECUTE, skips if
--       the table or either column is missing.
--     • a column-pair existence check that wraps the whole INSERT…SELECT
--       in EXECUTE so it isn't parsed unless every referenced column exists.
--
-- SAFETY: All operations gated by EXISTS checks. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── §0  Make sure the dynamic-backfill helper from 000 exists ───────────────
-- (Defensive: 037 could be re-run on a DB where 000's helper was dropped.)

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

-- Helper: returns TRUE iff a column exists on a public table
CREATE OR REPLACE FUNCTION public._col_exists(p_table TEXT, p_col TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_col
  );
$$;

-- ── §1  Re-sync patients dual columns (after v00 created data) ───────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='patients'
               AND table_type='BASE TABLE') THEN
    -- Snake → concat
    PERFORM public._safe_backfill('patients', 'fullname',      'full_name');
    PERFORM public._safe_backfill('patients', 'dob',           'date_of_birth');
    PERFORM public._safe_backfill('patients', 'aadhaar',       'aadhaar_no');
    PERFORM public._safe_backfill('patients', 'abhaid',        'abha_id');
    PERFORM public._safe_backfill('patients', 'bloodgroup',    'blood_group');
    PERFORM public._safe_backfill('patients', 'insurancename', 'insurance_name');
    PERFORM public._safe_backfill('patients', 'insuranceid',   'insurance_id');
    PERFORM public._safe_backfill('patients', 'isactive',      'is_active');
    PERFORM public._safe_backfill('patients', 'createdat',     'created_at');
    PERFORM public._safe_backfill('patients', 'updatedat',     'updated_at');

    -- Concat → snake (for rows written via the legacy names)
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

-- ── §2  Trigger to keep patients dual columns synchronized on every write ───
--
-- The trigger function is generated dynamically so that field references like
-- NEW.fullname are only emitted when both columns of a pair exist on the
-- patients table. Otherwise PL/pgSQL would resolve the static field at
-- runtime against the row's TupleDesc and raise "record has no field …".

DO $$
DECLARE
  pairs TEXT[][] := ARRAY[
    ARRAY['full_name',      'fullname'],
    ARRAY['date_of_birth',  'dob'],
    ARRAY['aadhaar_no',     'aadhaar'],
    ARRAY['abha_id',        'abhaid'],
    ARRAY['blood_group',    'bloodgroup'],
    ARRAY['insurance_name', 'insurancename'],
    ARRAY['insurance_id',   'insuranceid'],
    ARRAY['is_active',      'isactive'],
    ARRAY['created_at',     'createdat'],
    ARRAY['updated_at',     'updatedat']
  ];
  body TEXT := '';
  i    INT;
  snake TEXT;
  concat TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='patients' AND table_type='BASE TABLE') THEN
    RETURN;
  END IF;

  FOR i IN 1 .. array_length(pairs, 1) LOOP
    snake  := pairs[i][1];
    concat := pairs[i][2];
    IF public._col_exists('patients', snake) AND public._col_exists('patients', concat) THEN
      body := body || format(
        'IF NEW.%1$I IS NULL AND NEW.%2$I IS NOT NULL THEN NEW.%1$I := NEW.%2$I; '
        || 'ELSIF NEW.%2$I IS NULL AND NEW.%1$I IS NOT NULL THEN NEW.%2$I := NEW.%1$I; END IF; ',
        snake, concat
      );
    END IF;
  END LOOP;

  IF body = '' THEN
    -- nothing to sync; ensure no stale trigger remains
    DROP TRIGGER IF EXISTS trg_sync_patients_dual ON public.patients;
    RETURN;
  END IF;

  EXECUTE
    'CREATE OR REPLACE FUNCTION public.fn_sync_patients_dual_cols() '
    || 'RETURNS TRIGGER LANGUAGE plpgsql AS $body$ BEGIN '
    || body
    || 'RETURN NEW; END $body$;';

  DROP TRIGGER IF EXISTS trg_sync_patients_dual ON public.patients;
  CREATE TRIGGER trg_sync_patients_dual
    BEFORE INSERT OR UPDATE ON public.patients
    FOR EACH ROW EXECUTE FUNCTION public.fn_sync_patients_dual_cols();
END $$;

-- ── §3  Encounters dual-column sync ─────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='encounters' AND table_type='BASE TABLE') THEN
    PERFORM public._safe_backfill('encounters', 'patient_id',     'patientid');
    PERFORM public._safe_backfill('encounters', 'patientid',      'patient_id');
    PERFORM public._safe_backfill('encounters', 'doctor_id',      'doctorid');
    PERFORM public._safe_backfill('encounters', 'doctorid',       'doctor_id');
    PERFORM public._safe_backfill('encounters', 'encounter_date', 'date');
    PERFORM public._safe_backfill('encounters', 'visit_date',     'date');
    PERFORM public._safe_backfill('encounters', 'created_at',     'createdat');
    PERFORM public._safe_backfill('encounters', 'createdat',      'created_at');
  END IF;
END $$;

-- ── §4  Bills dual-column sync ──────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='bills' AND table_type='BASE TABLE') THEN
    PERFORM public._safe_backfill('bills', 'patient_id',     'patientid');
    PERFORM public._safe_backfill('bills', 'patientid',      'patient_id');
    PERFORM public._safe_backfill('bills', 'invoice_number', 'invoicenumber');
    PERFORM public._safe_backfill('bills', 'invoicenumber',  'invoice_number');
    PERFORM public._safe_backfill('bills', 'payment_mode',   'paymentmode');
    PERFORM public._safe_backfill('bills', 'paymentmode',    'payment_mode');
    PERFORM public._safe_backfill('bills', 'created_at',     'createdat');
    PERFORM public._safe_backfill('bills', 'createdat',      'created_at');

    -- net_amount ← COALESCE(net_amount, total, 0) — only if both columns exist
    IF public._col_exists('bills', 'net_amount') AND public._col_exists('bills', 'total') THEN
      EXECUTE 'UPDATE public.bills SET net_amount = COALESCE(net_amount, total, 0)';
    ELSIF public._col_exists('bills', 'net_amount') THEN
      EXECUTE 'UPDATE public.bills SET net_amount = COALESCE(net_amount, 0)';
    END IF;
  END IF;
END $$;

-- ── §5  Backfill snake_case lab_reports/opd_queue/etc from v00 tables ───────
--
-- Each INSERT…SELECT below references a long list of concat-lowercase columns
-- on the legacy v00 base table. Those columns may not exist (e.g. the legacy
-- table was created by a different schema version). We therefore build the
-- INSERT…SELECT dynamically using only the columns that actually exist on
-- both sides, and skip the entire block when the legacy table is absent.

-- Helper: copy rows from src table to dst table for every (dst_col, src_col)
-- pair where BOTH columns exist. The dst PK column 'id' is required on both
-- sides (used for the NOT EXISTS dedupe). Pairs is a flat TEXT[] of
-- [dst1, src1, dst2, src2, …].
CREATE OR REPLACE FUNCTION public._safe_copy_rows(
  p_dst TEXT, p_src TEXT, p_pairs TEXT[]
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  dst_cols TEXT := '';
  src_cols TEXT := '';
  i        INT;
  dcol     TEXT;
  scol     TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name=p_dst AND table_type='BASE TABLE')
  OR NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name=p_src AND table_type='BASE TABLE') THEN
    RETURN;
  END IF;
  -- 'id' is required on both sides for the dedupe to make sense
  IF NOT public._col_exists(p_dst, 'id') OR NOT public._col_exists(p_src, 'id') THEN
    RETURN;
  END IF;

  -- Always include id ↔ id
  dst_cols := quote_ident('id');
  src_cols := 's.' || quote_ident('id');

  i := 1;
  WHILE i <= array_length(p_pairs, 1) LOOP
    dcol := p_pairs[i];
    scol := p_pairs[i + 1];
    IF public._col_exists(p_dst, dcol) AND public._col_exists(p_src, scol) THEN
      dst_cols := dst_cols || ', ' || quote_ident(dcol);
      src_cols := src_cols || ', s.' || quote_ident(scol);
    END IF;
    i := i + 2;
  END LOOP;

  EXECUTE format(
    'INSERT INTO public.%1$I (%2$s) SELECT %3$s FROM public.%4$I s '
    || 'WHERE NOT EXISTS (SELECT 1 FROM public.%1$I d WHERE d.id = s.id)',
    p_dst, dst_cols, src_cols, p_src
  );
END $$;

DO $$
BEGIN
  -- lab_reports ← labreports
  PERFORM public._safe_copy_rows('lab_reports', 'labreports', ARRAY[
    'patient_id',     'patientid',
    'encounter_id',   'encounterid',
    'report_name',    'reportname',
    'test_name',      'reportname',
    'report_date',    'reportdate',
    'result',         'result',
    'result_text',    'result',
    'normal_range',   'normalrange',
    'unit',           'unit',
    'status',         'status',
    'notes',          'notes',
    'attachment_url', 'attachmenturl',
    'file_url',       'attachmenturl',
    'lab_partner_id', 'labpartnerid',
    'created_at',     'createdat',
    'updated_at',     'updatedat'
  ]);

  -- opd_queue ← opdqueue
  PERFORM public._safe_copy_rows('opd_queue', 'opdqueue', ARRAY[
    'patient_id',   'patientid',
    'patient_name', 'patientname',
    'mrn',          'mrn',
    'mobile',       'mobile',
    'token_number', 'queuenumber',
    'queue_number', 'queuenumber',
    'queue_date',   'date',
    'status',       'status',
    'notes',        'notes',
    'created_at',   'createdat',
    'updated_at',   'updatedat'
  ]);

  -- ipd_admissions ← ipdadmissions
  PERFORM public._safe_copy_rows('ipd_admissions', 'ipdadmissions', ARRAY[
    'patient_id',       'patientid',
    'bed_id',           'bedid',
    'admission_date',   'admissiondate',
    'discharge_date',   'dischargedate',
    'admitting_doctor', 'admittingdoctor',
    'diagnosis',        'diagnosis',
    'notes',            'notes',
    'status',           'status',
    'created_at',       'createdat',
    'updated_at',       'updatedat'
  ]);

  -- discharge_summaries ← dischargesummaries
  PERFORM public._safe_copy_rows('discharge_summaries', 'dischargesummaries', ARRAY[
    'patient_id',               'patientid',
    'admission_date',           'admissiondate',
    'discharge_date',           'dischargedate',
    'final_diagnosis',          'finaldiagnosis',
    'secondary_diagnosis',      'secondarydiagnosis',
    'clinical_summary',         'clinicalsummary',
    'investigations',           'investigations',
    'treatment_given',          'treatmentgiven',
    'condition_at_discharge',   'conditionatdischarge',
    'discharge_advice',         'dischargeadvice',
    'diet_advice',              'dietadvice',
    'medications_at_discharge', 'medicationsatdischarge',
    'follow_up_date',           'followupdate',
    'follow_up_note',           'followupnote',
    'is_final',                 'isfinal',
    'version',                  'version',
    'signed_by',                'signedby',
    'signed_at',                'signedat',
    'finalized_at',             'finalizedat',
    'created_at',               'createdat',
    'updated_at',               'updatedat'
  ]);

  -- hospital_fund ← hospitalfund
  PERFORM public._safe_copy_rows('hospital_fund', 'hospitalfund', ARRAY[
    'type',        'type',
    'amount',      'amount',
    'description', 'description',
    'category',    'category',
    'approved_by', 'approvedby',
    'status',      'status',
    'created_at',  'createdat'
  ]);

  -- lab_partners ← labpartners
  PERFORM public._safe_copy_rows('lab_partners', 'labpartners', ARRAY[
    'name',                 'name',
    'contact_person',       'contactperson',
    'phone',                'phone',
    'email',                'email',
    'address',              'address',
    'hospital_pct',         'hospitalshare',
    'lab_pct',              'labshare',
    'default_hospital_pct', 'hospitalshare',
    'default_lab_pct',      'labshare',
    'is_active',            'isactive',
    'created_at',           'createdat'
  ]);
END $$;

-- ── §6  Reload PostgREST schema cache so the new structure is visible ───────

NOTIFY pgrst, 'reload schema';

INSERT INTO public.schema_migrations (version, name, applied_at, notes)
VALUES ('037', 'post_v00_finalize', NOW(),
        'Backfills snake_case data from v00 concat-lowercase tables and adds dual-column sync triggers')
ON CONFLICT (version) DO NOTHING;

COMMIT;

SELECT '037_post_v00_finalize: schema alignment complete' AS result;
