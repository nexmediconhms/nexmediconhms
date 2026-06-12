-- ═══════════════════════════════════════════════════════════════════════
-- Migration 033: Schema Convergence (Issue 1 Fix — SAFE, ADDITIVE)
-- ═══════════════════════════════════════════════════════════════════════
-- v2: Fixes bugs found in static review of v1:
--   - hstore extension created AFTER function that uses it → fixed: extension first
--   - Generic dynamic SQL trigger had type-coercion issues → replaced with
--     per-column generated trigger code (no dynamic SQL inside trigger)
--   - verify_schema_completeness had dead code in CASE → simplified
--   - Generated trigger names now properly length-truncated to 63 chars
-- v3 (this revision):
--   - Defensively recreates notify_insurance_on_patient_update() at the top
--     so that ensure_dual_columns()'s UPDATE on patients (which fires that
--     trigger) doesn't fail with "22P02 invalid input syntax for type
--     boolean" on deployments where the older trigger function — with
--     untyped COALESCE(NEW.mediclaim, '') — is still installed and
--     mediclaim/cashless have been promoted to BOOLEAN.
--
-- HOW IT WORKS:
--   For each (table, snake_col, camel_col) pair:
--     1. If both columns exist, just create a sync trigger.
--     2. If only one exists, add the other with same TYPE (autodetected
--        from existing column) and a default backfill.
--     3. Trigger fires BEFORE INSERT/UPDATE and copies whichever side
--        is non-NULL to the side that is NULL.
--
-- ZERO DATA LOSS. Re-runnable. No DROP TABLE / DROP COLUMN.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Step 0: Heal any stale notify_insurance_on_patient_update() trigger ─
--
-- The original version in 010_billing_sequence_finance_sync.sql did
--   COALESCE(NEW.mediclaim, '') != COALESCE(OLD.mediclaim, '')
-- which fails with "22P02 invalid input syntax for type boolean: \"\""
-- on DBs where mediclaim or cashless are BOOLEAN (some Supabase deploys,
-- some early 017 variants). Because the trigger fires on every UPDATE
-- patients (including the ones ensure_dual_columns() does later in this
-- file), the whole 033 migration aborts.
--
-- We unconditionally CREATE OR REPLACE the function to the type-safe
-- (cast-to-text) version before doing any UPDATE patients. CREATE OR
-- REPLACE is a no-op if the function doesn't exist yet — the trigger
-- in 010 will pick up the corrected body on its next run regardless.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='patients') THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.notify_insurance_on_patient_update()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $body$
      BEGIN
        IF (
          COALESCE(NEW.mediclaim::text,       '') IS DISTINCT FROM COALESCE(OLD.mediclaim::text,       '') OR
          COALESCE(NEW.cashless::text,        '') IS DISTINCT FROM COALESCE(OLD.cashless::text,        '') OR
          COALESCE(NEW.policy_tpa_name::text, '') IS DISTINCT FROM COALESCE(OLD.policy_tpa_name::text, '') OR
          COALESCE(NEW.insurance_name::text,  '') IS DISTINCT FROM COALESCE(OLD.insurance_name::text,  '') OR
          COALESCE(NEW.insurance_id::text,    '') IS DISTINCT FROM COALESCE(OLD.insurance_id::text,    '')
        ) THEN
          PERFORM pg_notify('insurance_patient_update', json_build_object(
            'patient_id',      NEW.id,
            'patient_name',    NEW.full_name,
            'mediclaim',       NEW.mediclaim::text,
            'cashless',        NEW.cashless::text,
            'policy_tpa_name', NEW.policy_tpa_name,
            'event',           'patient_insurance_updated'
          )::text);
        END IF;
        RETURN NEW;
      END $body$;
    $fn$;
  END IF;
EXCEPTION
  -- If the function references columns that don't exist on the patients
  -- table (e.g. on a fresh DB where policy_tpa_name isn't there yet),
  -- the CREATE succeeds but the body will fail at trigger fire time.
  -- That's tolerable: the only way the trigger fires is if it was
  -- already created by 010, which means those columns *do* exist.
  WHEN undefined_column THEN
    RAISE NOTICE 'notify_insurance_on_patient_update: skipping rebuild — patient insurance columns missing';
  WHEN undefined_function THEN
    RAISE NOTICE 'notify_insurance_on_patient_update: skipping rebuild — function CREATE failed';
END $$;

-- Step 1: Convergence procedure that generates a per-pair trigger function.
-- The generated function does NO dynamic SQL — it uses static column
-- references, so PostgreSQL can type-check it and the trigger is fast.

CREATE OR REPLACE FUNCTION ensure_dual_columns(
  p_table     TEXT,
  p_col_a     TEXT,   -- typically the snake_case name
  p_col_b     TEXT    -- typically the camelCase / no-underscore name
) RETURNS VOID AS $$
DECLARE
  has_a BOOLEAN;
  has_b BOOLEAN;
  col_type TEXT;
  trigger_name TEXT;
  func_name TEXT;
  fn_body TEXT;
BEGIN
  -- 0. Table must exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name=p_table
  ) THEN
    RAISE NOTICE 'ensure_dual_columns: table % does not exist, skipping', p_table;
    RETURN;
  END IF;

  -- 1. Detect which columns exist + their type
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=p_table AND column_name=p_col_a)
    INTO has_a;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=p_table AND column_name=p_col_b)
    INTO has_b;

  IF NOT has_a AND NOT has_b THEN
    RAISE NOTICE 'ensure_dual_columns: neither %.% nor %.% exists, skipping',
      p_table, p_col_a, p_table, p_col_b;
    RETURN;
  END IF;

  -- Detect column type from whichever side exists
  IF has_a THEN
    SELECT data_type INTO col_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=p_table AND column_name=p_col_a;
  ELSE
    SELECT data_type INTO col_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=p_table AND column_name=p_col_b;
  END IF;

  -- Map information_schema type name to a usable DDL type
  col_type := CASE col_type
    WHEN 'character varying' THEN 'TEXT'
    WHEN 'timestamp with time zone' THEN 'TIMESTAMPTZ'
    WHEN 'timestamp without time zone' THEN 'TIMESTAMP'
    WHEN 'integer' THEN 'INTEGER'
    WHEN 'bigint' THEN 'BIGINT'
    WHEN 'numeric' THEN 'NUMERIC(12,2)'
    WHEN 'boolean' THEN 'BOOLEAN'
    WHEN 'uuid' THEN 'UUID'
    WHEN 'date' THEN 'DATE'
    WHEN 'json' THEN 'JSONB'
    WHEN 'jsonb' THEN 'JSONB'
    WHEN 'text' THEN 'TEXT'
    ELSE 'TEXT'
  END;

  -- 2. Add the missing column + backfill from the existing one
  IF has_a AND NOT has_b THEN
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I %s', p_table, p_col_b, col_type);
    EXECUTE format('UPDATE public.%I SET %I = %I', p_table, p_col_b, p_col_a);
    RAISE NOTICE 'Added %.% (% mirrored from %)', p_table, p_col_b, col_type, p_col_a;
  ELSIF has_b AND NOT has_a THEN
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I %s', p_table, p_col_a, col_type);
    EXECUTE format('UPDATE public.%I SET %I = %I', p_table, p_col_a, p_col_b);
    RAISE NOTICE 'Added %.% (% mirrored from %)', p_table, p_col_a, col_type, p_col_b;
  ELSE
    -- Both exist — sync any NULL values both directions
    EXECUTE format('UPDATE public.%I SET %I = %I WHERE %I IS NULL AND %I IS NOT NULL',
      p_table, p_col_b, p_col_a, p_col_b, p_col_a);
    EXECUTE format('UPDATE public.%I SET %I = %I WHERE %I IS NULL AND %I IS NOT NULL',
      p_table, p_col_a, p_col_b, p_col_a, p_col_b);
  END IF;

  -- 3. Build trigger function NAME (truncated to 63 char Postgres limit)
  func_name := left(format('fn_sync_%s_%s_%s', p_table, p_col_a, p_col_b), 63);
  trigger_name := left(format('trg_sync_%s_%s_%s', p_table, p_col_a, p_col_b), 63);

  -- 4. Build a per-pair trigger function with STATIC column references
  --    (no dynamic SQL inside the trigger → fast + type-safe)
  fn_body := format($body$
    CREATE OR REPLACE FUNCTION public.%I()
    RETURNS TRIGGER AS $func$
    BEGIN
      IF NEW.%I IS NULL AND NEW.%I IS NOT NULL THEN
        NEW.%I := NEW.%I;
      ELSIF NEW.%I IS NULL AND NEW.%I IS NOT NULL THEN
        NEW.%I := NEW.%I;
      END IF;
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  $body$,
    func_name,
    p_col_a, p_col_b, p_col_a, p_col_b,
    p_col_b, p_col_a, p_col_b, p_col_a
  );

  EXECUTE fn_body;

  -- 5. Recreate trigger
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name, p_table);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I()',
    trigger_name, p_table, func_name
  );
END;
$$ LANGUAGE plpgsql;

-- Step 2: Apply convergence to known dual-named columns
DO $$
BEGIN
  -- patients
  PERFORM ensure_dual_columns('patients', 'created_at', 'createdat');
  PERFORM ensure_dual_columns('patients', 'updated_at', 'updatedat');
  PERFORM ensure_dual_columns('patients', 'full_name', 'fullname');
  PERFORM ensure_dual_columns('patients', 'date_of_birth', 'dateofbirth');
  PERFORM ensure_dual_columns('patients', 'is_deleted', 'isdeleted');

  -- bills
  PERFORM ensure_dual_columns('bills', 'patient_id', 'patientid');
  PERFORM ensure_dual_columns('bills', 'invoice_number', 'invoicenumber');
  PERFORM ensure_dual_columns('bills', 'created_at', 'createdat');
  PERFORM ensure_dual_columns('bills', 'updated_at', 'updatedat');
  PERFORM ensure_dual_columns('bills', 'is_deleted', 'isdeleted');
  PERFORM ensure_dual_columns('bills', 'net_amount', 'netamount');
  PERFORM ensure_dual_columns('bills', 'gst_amount', 'gstamount');
  PERFORM ensure_dual_columns('bills', 'gst_percent', 'gstpercent');

  -- encounters
  PERFORM ensure_dual_columns('encounters', 'patient_id', 'patientid');
  PERFORM ensure_dual_columns('encounters', 'created_at', 'createdat');
  PERFORM ensure_dual_columns('encounters', 'updated_at', 'updatedat');

  -- ipd_admissions
  PERFORM ensure_dual_columns('ipd_admissions', 'patient_id', 'patientid');
  PERFORM ensure_dual_columns('ipd_admissions', 'created_at', 'createdat');
  PERFORM ensure_dual_columns('ipd_admissions', 'admission_date', 'admissiondate');
  PERFORM ensure_dual_columns('ipd_admissions', 'discharge_date', 'dischargedate');

  -- bill_payments
  PERFORM ensure_dual_columns('bill_payments', 'bill_id', 'billid');
  PERFORM ensure_dual_columns('bill_payments', 'patient_id', 'patientid');
  PERFORM ensure_dual_columns('bill_payments', 'created_at', 'createdat');

  -- lab_orders
  PERFORM ensure_dual_columns('lab_orders', 'patient_id', 'patientid');
  PERFORM ensure_dual_columns('lab_orders', 'created_at', 'createdat');

  -- prescriptions
  PERFORM ensure_dual_columns('prescriptions', 'patient_id', 'patientid');
  PERFORM ensure_dual_columns('prescriptions', 'created_at', 'createdat');

  -- appointments
  PERFORM ensure_dual_columns('appointments', 'patient_id', 'patientid');
  PERFORM ensure_dual_columns('appointments', 'created_at', 'createdat');
END $$;

-- Step 3: Table-level aliasing via views (when only one of the two table
--         names exists; create view in the missing name).
DO $$
DECLARE
  has_cu_under  BOOLEAN;  -- clinic_users
  has_cu_concat BOOLEAN;  -- clinicusers
  has_view_cu_under  BOOLEAN;
  has_view_cu_concat BOOLEAN;
  has_ipd_under  BOOLEAN;  -- ipd_admissions
  has_ipd_concat BOOLEAN;  -- ipdadmissions
  has_view_ipd_concat BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='clinic_users' AND table_type='BASE TABLE')
    INTO has_cu_under;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='clinicusers' AND table_type='BASE TABLE')
    INTO has_cu_concat;
  SELECT EXISTS (SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='clinic_users')
    INTO has_view_cu_under;
  SELECT EXISTS (SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='clinicusers')
    INTO has_view_cu_concat;

  IF has_cu_concat AND NOT has_cu_under AND NOT has_view_cu_under THEN
    CREATE OR REPLACE VIEW public.clinic_users AS SELECT * FROM public.clinicusers;
    RAISE NOTICE 'Created view: clinic_users → clinicusers';
  ELSIF has_cu_under AND NOT has_cu_concat AND NOT has_view_cu_concat THEN
    CREATE OR REPLACE VIEW public.clinicusers AS SELECT * FROM public.clinic_users;
    RAISE NOTICE 'Created view: clinicusers → clinic_users';
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='ipd_admissions' AND table_type='BASE TABLE')
    INTO has_ipd_under;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='ipdadmissions' AND table_type='BASE TABLE')
    INTO has_ipd_concat;
  SELECT EXISTS (SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='ipdadmissions')
    INTO has_view_ipd_concat;

  IF has_ipd_under AND NOT has_ipd_concat AND NOT has_view_ipd_concat THEN
    CREATE OR REPLACE VIEW public.ipdadmissions AS SELECT * FROM public.ipd_admissions;
    RAISE NOTICE 'Created view: ipdadmissions → ipd_admissions';
  END IF;
END $$;

-- Step 4: Ensure critical "bills" columns exist (covers schemas that never
--         had them — defensive only; most installs already have these)
DO $$
DECLARE
  to_add RECORD;
BEGIN
  -- Only run if bills table exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='bills') THEN
    RETURN;
  END IF;

  FOR to_add IN
    SELECT * FROM (VALUES
      ('status',       'TEXT',          E'''pending'''),
      ('paid',         'NUMERIC(12,2)', '0'),
      ('due',          'NUMERIC(12,2)', '0'),
      ('items',        'JSONB',         E'''[]'''),
      ('discount',     'NUMERIC(12,2)', '0'),
      ('subtotal',     'NUMERIC(12,2)', '0'),
      ('total',        'NUMERIC(12,2)', '0'),
      ('bill_module',  'TEXT',          E'''OPD'''),
      ('payment_mode', 'TEXT',          'NULL')
    ) AS x(col, typ, dflt)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='bills' AND column_name=to_add.col) THEN
      EXECUTE format('ALTER TABLE public.bills ADD COLUMN %I %s DEFAULT %s',
        to_add.col, to_add.typ, to_add.dflt);
      RAISE NOTICE 'Added bills.% % DEFAULT %', to_add.col, to_add.typ, to_add.dflt;
    END IF;
  END LOOP;
END $$;

-- Step 5: Schema completeness checker. Returns ONLY missing columns.
--         Zero rows returned = everything in order.
CREATE OR REPLACE FUNCTION verify_schema_completeness()
RETURNS TABLE (table_name TEXT, column_name TEXT) AS $$
BEGIN
  RETURN QUERY
  WITH expected AS (
    SELECT 'bills'::TEXT t, 'patient_id'::TEXT c UNION ALL
    SELECT 'bills', 'invoice_number' UNION ALL
    SELECT 'bills', 'net_amount' UNION ALL
    SELECT 'bills', 'paid' UNION ALL
    SELECT 'bills', 'due' UNION ALL
    SELECT 'bills', 'status' UNION ALL
    SELECT 'bills', 'items' UNION ALL
    SELECT 'bills', 'created_at' UNION ALL
    SELECT 'bill_payments', 'bill_id' UNION ALL
    SELECT 'bill_payments', 'amount' UNION ALL
    SELECT 'patients', 'full_name' UNION ALL
    SELECT 'patients', 'mrn' UNION ALL
    SELECT 'encounters', 'patient_id' UNION ALL
    SELECT 'ipd_admissions', 'patient_id'
  )
  SELECT e.t, e.c
  FROM expected e
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns ic
    WHERE ic.table_schema='public'
      AND ic.table_name = e.t
      AND ic.column_name = e.c
  );
END;
$$ LANGUAGE plpgsql;

-- Step 6: Record migration
INSERT INTO schema_migrations (version, name, applied_at)
VALUES ('033', 'schema_convergence_safe_v2', NOW())
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFICATION:
--   SELECT * FROM verify_schema_completeness();
--   → zero rows = all required columns present
--
--   Test the trigger sync (run on a non-production DB first):
--     INSERT INTO bills (patient_id) VALUES ('00000000-0000-0000-0000-000000000001');
--     SELECT patient_id, patientid FROM bills ORDER BY created_at DESC LIMIT 1;
--   Both columns should hold the same UUID.
-- ═══════════════════════════════════════════════════════════════════════
