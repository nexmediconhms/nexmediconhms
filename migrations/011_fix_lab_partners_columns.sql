-- ============================================================
-- Migration 011: Fix lab_partners table columns
--
-- Ensures the lab_partners table has all columns that the
-- application code references. This handles the case where:
--   - Original schema used 'hospitalshare'/'labshare'
--   - Application code uses 'hospital_pct'/'lab_pct'
--   - Settings page needs 'phone' column (not 'contact')
-- ============================================================

-- Skip everything if lab_partners table doesn't exist (run 000_canonical_alignment
-- first to create it from v00's labpartners legacy table).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='lab_partners') THEN
    RAISE NOTICE 'lab_partners table missing — skipping migration 011. '
                 'Run 000_canonical_schema_alignment.sql first.';
    RETURN;
  END IF;

  -- Add columns the application code expects
  ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS hospital_pct NUMERIC(5,2) DEFAULT 30;
  ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS lab_pct NUMERIC(5,2) DEFAULT 70;
  ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS phone TEXT;
  ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS email TEXT;
  ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS address TEXT;
  ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS contact_person TEXT;
  ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
  ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

  -- Backfill from legacy column names if they exist on the same table.
  --
  -- IMPORTANT: PL/pgSQL parses every static SQL statement inside a DO block
  -- at compile time. Referencing a column that doesn't exist (e.g.
  -- 'hospitalshare' on a fresh DB) would fail BEFORE the IF EXISTS guard
  -- runs. We therefore use dynamic EXECUTE for every UPDATE that touches a
  -- legacy column.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='lab_partners' AND column_name='hospitalshare'
  ) THEN
    EXECUTE 'UPDATE public.lab_partners SET hospital_pct = hospitalshare WHERE hospital_pct IS NULL OR hospital_pct = 30';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='lab_partners' AND column_name='labshare'
  ) THEN
    EXECUTE 'UPDATE public.lab_partners SET lab_pct = labshare WHERE lab_pct IS NULL OR lab_pct = 70';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='lab_partners' AND column_name='isactive'
  ) THEN
    EXECUTE 'UPDATE public.lab_partners SET is_active = isactive WHERE is_active IS NULL';
  END IF;

  -- Cross-table backfill from the v00 legacy labpartners table (if present).
  -- Built dynamically so missing source columns don't blow up the parser.
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='labpartners' AND table_type='BASE TABLE') THEN
    DECLARE
      sets TEXT := '';
      add_pair  CONSTANT TEXT := ', ';
      legacy_has_col  BOOLEAN;
      target_has_col  BOOLEAN;
      pairs TEXT[][] := ARRAY[
        ARRAY['phone',          'phone'],
        ARRAY['email',          'email'],
        ARRAY['address',        'address'],
        ARRAY['hospital_pct',   'hospitalshare'],
        ARRAY['lab_pct',        'labshare'],
        ARRAY['is_active',      'isactive'],
        ARRAY['contact_person', 'contactperson']
      ];
      i INT;
      tgt TEXT;
      src TEXT;
    BEGIN
      FOR i IN 1 .. array_length(pairs, 1) LOOP
        tgt := pairs[i][1];
        src := pairs[i][2];
        target_has_col := EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_schema='public' AND table_name='lab_partners'  AND column_name=tgt);
        legacy_has_col := EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_schema='public' AND table_name='labpartners'   AND column_name=src);
        IF target_has_col AND legacy_has_col THEN
          IF sets <> '' THEN sets := sets || ', '; END IF;
          sets := sets || format('%1$I = COALESCE(lp.%1$I, src.%2$I)', tgt, src);
        END IF;
      END LOOP;

      IF sets <> '' THEN
        EXECUTE format(
          'UPDATE public.lab_partners lp SET %s FROM public.labpartners src WHERE lp.id = src.id',
          sets
        );
      END IF;
    END;
  END IF;
END $$;

-- ── Done ─────────────────────────────────────────────────────────