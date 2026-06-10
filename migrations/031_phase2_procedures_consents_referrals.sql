-- ============================================================================
-- Migration 031: Phase 2 — Procedures, Consents, Referrals & Lab Order Linkage
-- ============================================================================
--
-- TABLES CREATED:
--   1. opd_procedures   — minor procedures performed during OPD visits
--   2. consents         — digital consent capture (OPD + IPD)
--   3. referrals        — outgoing referrals to specialists / imaging centers
--
-- TABLES ENHANCED:
--   4. lab_orders       — add encounter linkage + ordering workflow columns
--
-- SAFETY: fully idempotent, all IF NOT EXISTS, no drops/renames.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- §1  OPD_PROCEDURES TABLE
-- ─────────────────────────────────────────────────────────────────────────────
-- Tracks minor procedures performed in OPD by gynaecologists:
-- IUD insertion/removal, endometrial biopsy, PAP smear, colposcopy,
-- cervical cauterization, office hysteroscopy, D&C (minor), etc.

CREATE TABLE IF NOT EXISTS opd_procedures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id      UUID NOT NULL,
  patient_id        UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS procedure_name      TEXT NOT NULL DEFAULT '';
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS procedure_code      TEXT;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS procedure_category  TEXT DEFAULT 'minor';
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS indication          TEXT;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS technique           TEXT;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS findings            TEXT;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS complications       TEXT;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS specimen_sent       BOOLEAN DEFAULT FALSE;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS specimen_details    TEXT;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS anesthesia_type     TEXT;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS anesthesia_details  TEXT;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS materials_used      JSONB DEFAULT '[]';
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS post_procedure_instructions TEXT;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS consent_id          UUID;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS doctor_id           UUID;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS assistant_id        UUID;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS status              TEXT DEFAULT 'completed';
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS started_at          TIMESTAMPTZ;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS ended_at            TIMESTAMPTZ;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS duration_mins       INTEGER;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS bill_item_id        UUID;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS notes               TEXT;
ALTER TABLE opd_procedures ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- FK constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='opd_procedures' AND constraint_name='opd_procedures_encounter_id_fkey') THEN
    BEGIN
      ALTER TABLE opd_procedures ADD CONSTRAINT opd_procedures_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FK opd_procedures_encounter_id skipped: %', SQLERRM; END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='opd_procedures' AND constraint_name='opd_procedures_patient_id_fkey') THEN
    BEGIN
      ALTER TABLE opd_procedures ADD CONSTRAINT opd_procedures_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FK opd_procedures_patient_id skipped: %', SQLERRM; END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_opd_procedures_encounter ON opd_procedures (encounter_id);
CREATE INDEX IF NOT EXISTS idx_opd_procedures_patient   ON opd_procedures (patient_id);
CREATE INDEX IF NOT EXISTS idx_opd_procedures_name      ON opd_procedures (procedure_name);


-- ─────────────────────────────────────────────────────────────────────────────
-- §2  CONSENTS TABLE
-- ─────────────────────────────────────────────────────────────────────────────
-- Digital consent management for OPD and IPD.
-- Stores consent type, content, signature (base64), witness info.

CREATE TABLE IF NOT EXISTS consents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE consents ADD COLUMN IF NOT EXISTS encounter_id         UUID;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS admission_id         UUID;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS consent_type         TEXT NOT NULL DEFAULT 'general';
ALTER TABLE consents ADD COLUMN IF NOT EXISTS consent_title        TEXT NOT NULL DEFAULT '';
ALTER TABLE consents ADD COLUMN IF NOT EXISTS consent_body         TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS consent_template_id  TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS language             TEXT DEFAULT 'en';
ALTER TABLE consents ADD COLUMN IF NOT EXISTS patient_signature    TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS guardian_name        TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS guardian_relation    TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS guardian_signature   TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS witness_name         TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS witness_signature    TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS doctor_id            UUID;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS doctor_name          TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS status               TEXT DEFAULT 'pending';
ALTER TABLE consents ADD COLUMN IF NOT EXISTS signed_at            TIMESTAMPTZ;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS revoked_at           TIMESTAMPTZ;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS revocation_reason    TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS ip_address           TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS pdf_path             TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS metadata             JSONB DEFAULT '{}';
ALTER TABLE consents ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE consents ADD COLUMN IF NOT EXISTS created_by           UUID;

-- FK constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='consents' AND constraint_name='consents_patient_id_fkey') THEN
    BEGIN
      ALTER TABLE consents ADD CONSTRAINT consents_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FK consents_patient_id skipped: %', SQLERRM; END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='consents' AND constraint_name='consents_encounter_id_fkey') THEN
    BEGIN
      ALTER TABLE consents ADD CONSTRAINT consents_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FK consents_encounter_id skipped: %', SQLERRM; END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_consents_patient    ON consents (patient_id);
CREATE INDEX IF NOT EXISTS idx_consents_encounter  ON consents (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consents_type       ON consents (consent_type);
CREATE INDEX IF NOT EXISTS idx_consents_status     ON consents (status);


-- ─────────────────────────────────────────────────────────────────────────────
-- §3  REFERRALS TABLE
-- ─────────────────────────────────────────────────────────────────────────────
-- Outgoing referrals from gynaecologist to other specialists/centres.
-- Tracks referral lifecycle: created → sent → acknowledged → report_received → closed.

CREATE TABLE IF NOT EXISTS referrals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID NOT NULL,
  encounter_id      UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referral_type       TEXT DEFAULT 'specialist';
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_to_name    TEXT NOT NULL DEFAULT '';
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_to_specialty TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_to_hospital TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_to_phone   TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_to_email   TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_to_address TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS reason              TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS clinical_summary    TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS urgency             TEXT DEFAULT 'routine';
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS provisional_diagnosis TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS investigations_done JSONB DEFAULT '[]';
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS investigations_requested JSONB DEFAULT '[]';
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS status              TEXT DEFAULT 'created';
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS sent_at             TIMESTAMPTZ;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS acknowledged_at     TIMESTAMPTZ;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS appointment_date    DATE;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS report_received     BOOLEAN DEFAULT FALSE;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS report_summary      TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS report_attachment_id UUID;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS closed_at           TIMESTAMPTZ;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referring_doctor_id UUID;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referring_doctor_name TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS letter_content      TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS letter_pdf_path     TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS notes               TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- FK constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='referrals' AND constraint_name='referrals_patient_id_fkey') THEN
    BEGIN
      ALTER TABLE referrals ADD CONSTRAINT referrals_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FK referrals_patient_id skipped: %', SQLERRM; END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='referrals' AND constraint_name='referrals_encounter_id_fkey') THEN
    BEGIN
      ALTER TABLE referrals ADD CONSTRAINT referrals_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FK referrals_encounter_id skipped: %', SQLERRM; END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_referrals_patient   ON referrals (patient_id);
CREATE INDEX IF NOT EXISTS idx_referrals_encounter ON referrals (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_status    ON referrals (status);


-- ─────────────────────────────────────────────────────────────────────────────
-- §4  ENHANCE LAB_ORDERS (if table exists)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds ordering workflow columns: status tracking, doctor linkage, urgency.
-- If lab_orders doesn't exist, we create a minimal version.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lab_orders') THEN
    CREATE TABLE lab_orders (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id      UUID NOT NULL,
      encounter_id    UUID,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  END IF;
END $$;

ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS encounter_id       UUID;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS ordered_by         UUID;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS ordered_at         TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS test_name          TEXT;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS test_code          TEXT;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS test_category      TEXT;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS urgency            TEXT DEFAULT 'routine';
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS clinical_notes     TEXT;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS status             TEXT DEFAULT 'ordered';
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS sample_collected   BOOLEAN DEFAULT FALSE;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS sample_collected_at TIMESTAMPTZ;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS sent_to_lab        BOOLEAN DEFAULT FALSE;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS sent_to_lab_at     TIMESTAMPTZ;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS lab_partner_id     UUID;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS result_received    BOOLEAN DEFAULT FALSE;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS result_received_at TIMESTAMPTZ;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS result_id          UUID;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS is_abnormal        BOOLEAN;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS doctor_reviewed    BOOLEAN DEFAULT FALSE;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS doctor_reviewed_at TIMESTAMPTZ;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS bill_item_id       UUID;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_lab_orders_encounter  ON lab_orders (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_orders_patient    ON lab_orders (patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_status     ON lab_orders (status);


-- ─────────────────────────────────────────────────────────────────────────────
-- §5  RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE opd_procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals      ENABLE ROW LEVEL SECURITY;

-- opd_procedures
DROP POLICY IF EXISTS opd_procedures_select ON opd_procedures;
CREATE POLICY opd_procedures_select ON opd_procedures FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS opd_procedures_insert ON opd_procedures;
CREATE POLICY opd_procedures_insert ON opd_procedures FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS opd_procedures_update ON opd_procedures;
CREATE POLICY opd_procedures_update ON opd_procedures FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS opd_procedures_delete ON opd_procedures;
CREATE POLICY opd_procedures_delete ON opd_procedures FOR DELETE TO authenticated USING (true);

-- consents
DROP POLICY IF EXISTS consents_select ON consents;
CREATE POLICY consents_select ON consents FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS consents_insert ON consents;
CREATE POLICY consents_insert ON consents FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS consents_update ON consents;
CREATE POLICY consents_update ON consents FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS consents_delete ON consents;
CREATE POLICY consents_delete ON consents FOR DELETE TO authenticated USING (true);

-- referrals
DROP POLICY IF EXISTS referrals_select ON referrals;
CREATE POLICY referrals_select ON referrals FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS referrals_insert ON referrals;
CREATE POLICY referrals_insert ON referrals FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS referrals_update ON referrals;
CREATE POLICY referrals_update ON referrals FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS referrals_delete ON referrals;
CREATE POLICY referrals_delete ON referrals FOR DELETE TO authenticated USING (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- §6  REALTIME
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='referrals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE referrals;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='consents') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE consents;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Realtime publication update skipped: %', SQLERRM;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- §7  UPDATED_AT TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_generic_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_opd_procedures_updated_at ON opd_procedures;
CREATE TRIGGER trg_opd_procedures_updated_at BEFORE UPDATE ON opd_procedures FOR EACH ROW EXECUTE FUNCTION update_generic_updated_at();

DROP TRIGGER IF EXISTS trg_consents_updated_at ON consents;
CREATE TRIGGER trg_consents_updated_at BEFORE UPDATE ON consents FOR EACH ROW EXECUTE FUNCTION update_generic_updated_at();

DROP TRIGGER IF EXISTS trg_referrals_updated_at ON referrals;
CREATE TRIGGER trg_referrals_updated_at BEFORE UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION update_generic_updated_at();


SELECT 'Migration 031: Phase 2 — Procedures, Consents, Referrals & Lab Orders — COMPLETE' AS result;
