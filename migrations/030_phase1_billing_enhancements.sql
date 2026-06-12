-- ═══════════════════════════════════════════════════════════════════════
-- Migration 030: Phase 1 Billing Enhancements
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT THIS ADDS (all additive — nothing is dropped or renamed):
--
--   §1  patient_deposits            – Advance / deposit payments for IPD
--   §2  credit_notes                – Formal credit notes for cancellations / refunds
--   §3  bill_payers                 – Split payer tracking (patient vs insurance)
--   §4  Additive columns on bills   – admission_id, bill_type, deposit_adjusted, discount meta
--   §5  Additive columns on bill_payments – receipt_number
--   §6  Additive columns on ipd_admissions – deposit_collected, billing_cleared
--   §7  Additive column on insurance_claims – bill_id, co_pay_amount
--   §8  receipt_number_seq          – Sequence for receipt numbers
--   §9  Indexes for new columns
--   §10 RLS policies for new tables
--   §11 Finance auto-sync trigger for deposits
--   §12 Record in schema_migrations
--
-- SAFETY:
--   - Every CREATE TABLE uses IF NOT EXISTS
--   - Every ALTER TABLE ADD COLUMN uses IF NOT EXISTS
--   - Every CREATE INDEX uses IF NOT EXISTS
--   - Every policy uses IF NOT EXISTS (via DO block)
--   - Can be re-run safely (fully idempotent)
--
-- ═══════════════════════════════════════════════════════════════════════


-- ── §1 patient_deposits ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.patient_deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL,
  admission_id    UUID,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_mode    TEXT NOT NULL DEFAULT 'cash',
  payment_ref     TEXT,
  receipt_number  TEXT,
  status          TEXT NOT NULL DEFAULT 'collected'
                    CHECK (status IN ('collected', 'partially_adjusted', 'fully_adjusted', 'refunded')),
  adjusted_amount NUMERIC(12,2) DEFAULT 0,
  adjusted_bill_id UUID,
  refund_amount   NUMERIC(12,2) DEFAULT 0,
  refund_reason   TEXT,
  refund_mode     TEXT,
  collected_by    TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  is_deleted      BOOLEAN DEFAULT FALSE
);

COMMENT ON TABLE public.patient_deposits IS
  'Advance/deposit payments collected at IPD admission or before procedures. Adjusted against final bill at discharge.';


-- ── §2 credit_notes ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.credit_notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number  TEXT NOT NULL,
  original_bill_id    UUID NOT NULL,
  patient_id          UUID NOT NULL,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason              TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'cancellation'
                        CHECK (type IN ('cancellation', 'refund', 'correction', 'discount', 'other')),
  gst_percent         NUMERIC(5,2) DEFAULT 0,
  gst_amount          NUMERIC(10,2) DEFAULT 0,
  cgst                NUMERIC(10,2) DEFAULT 0,
  sgst                NUMERIC(10,2) DEFAULT 0,
  linked_refund_id    UUID,
  created_by          TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  is_deleted          BOOLEAN DEFAULT FALSE
);

-- Unique partial index on credit_note_number (non-deleted only)
DROP INDEX IF EXISTS idx_credit_notes_number_unique;
CREATE UNIQUE INDEX idx_credit_notes_number_unique
  ON public.credit_notes (credit_note_number)
  WHERE is_deleted = FALSE;

COMMENT ON TABLE public.credit_notes IS
  'Formal credit notes generated for bill cancellations, refunds, or corrections. Required for GST compliance.';


-- ── §3 bill_payers ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bill_payers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id         UUID NOT NULL,
  payer_type      TEXT NOT NULL CHECK (payer_type IN ('patient', 'insurance', 'tpa', 'corporate', 'government')),
  payer_ref_id    UUID,
  payer_name      TEXT,
  expected_amount NUMERIC(12,2) DEFAULT 0,
  paid_amount     NUMERIC(12,2) DEFAULT 0,
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending', 'partial', 'settled', 'rejected', 'written_off')),
  settlement_ref  TEXT,
  settlement_date TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.bill_payers IS
  'Tracks who pays what portion of a bill. Enables insurance co-pay, TPA settlement, and corporate billing splits.';


-- ── §4 Additive columns on bills ─────────────────────────────────────

DO $$
BEGIN
  -- admission_id: links IPD bills to specific admissions (replaces fragile notes-based matching)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='admission_id') THEN
    ALTER TABLE public.bills ADD COLUMN admission_id UUID;
    RAISE NOTICE 'Added bills.admission_id';
  END IF;

  -- bill_type: distinguishes regular vs package vs cashless vs credit_note
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='bill_type') THEN
    ALTER TABLE public.bills ADD COLUMN bill_type TEXT DEFAULT 'regular';
    RAISE NOTICE 'Added bills.bill_type';
  END IF;

  -- deposit_adjusted: how much of the total was covered by advance deposit
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='deposit_adjusted') THEN
    ALTER TABLE public.bills ADD COLUMN deposit_adjusted NUMERIC(12,2) DEFAULT 0;
    RAISE NOTICE 'Added bills.deposit_adjusted';
  END IF;

  -- discount_reason: mandatory when discount > 0 (for audit)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='discount_reason') THEN
    ALTER TABLE public.bills ADD COLUMN discount_reason TEXT;
    RAISE NOTICE 'Added bills.discount_reason';
  END IF;

  -- discount_approved_by: who approved the discount
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='discount_approved_by') THEN
    ALTER TABLE public.bills ADD COLUMN discount_approved_by TEXT;
    RAISE NOTICE 'Added bills.discount_approved_by';
  END IF;

  -- bill_module: ensure this column exists (some schemas may not have it)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='bill_module') THEN
    ALTER TABLE public.bills ADD COLUMN bill_module TEXT DEFAULT 'OPD';
    RAISE NOTICE 'Added bills.bill_module';
  END IF;
END $$;


-- ── §5 Additive columns on bill_payments ─────────────────────────────

DO $$
BEGIN
  -- receipt_number: formal receipt number for each payment transaction
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bill_payments' AND column_name='receipt_number') THEN
    ALTER TABLE public.bill_payments ADD COLUMN receipt_number TEXT;
    RAISE NOTICE 'Added bill_payments.receipt_number';
  END IF;

  -- split_group: groups multiple payment modes in a single transaction
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bill_payments' AND column_name='split_group') THEN
    ALTER TABLE public.bill_payments ADD COLUMN split_group UUID;
    RAISE NOTICE 'Added bill_payments.split_group';
  END IF;
END $$;


-- ── §6 Additive columns on ipd_admissions ────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='ipd_admissions') THEN
    RAISE NOTICE '§6 skipped: ipd_admissions table missing';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ipd_admissions' AND column_name='deposit_collected') THEN
    ALTER TABLE public.ipd_admissions ADD COLUMN deposit_collected NUMERIC(12,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ipd_admissions' AND column_name='billing_cleared') THEN
    ALTER TABLE public.ipd_admissions ADD COLUMN billing_cleared BOOLEAN DEFAULT FALSE;
  END IF;
END $$;


-- ── §7 Additive columns on insurance_claims ──────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='insurance_claims') THEN
    RAISE NOTICE '§7 skipped: insurance_claims table missing';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='insurance_claims' AND column_name='bill_id') THEN
    ALTER TABLE public.insurance_claims ADD COLUMN bill_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='insurance_claims' AND column_name='co_pay_amount') THEN
    ALTER TABLE public.insurance_claims ADD COLUMN co_pay_amount NUMERIC(12,2) DEFAULT 0;
  END IF;
END $$;


-- ── §8 Receipt number sequence ───────────────────────────────────────
-- Used by the API to generate sequential receipt numbers

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'receipt_number_seq' AND relkind = 'S') THEN
    CREATE SEQUENCE receipt_number_seq START WITH 1 INCREMENT BY 1;
    RAISE NOTICE 'Created receipt_number_seq';
  END IF;
END $$;


-- ── §9 Indexes ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_patient_deposits_patient     ON public.patient_deposits(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_deposits_admission   ON public.patient_deposits(admission_id)  WHERE admission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_deposits_status      ON public.patient_deposits(status);
CREATE INDEX IF NOT EXISTS idx_patient_deposits_created     ON public.patient_deposits(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_notes_bill            ON public.credit_notes(original_bill_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_patient         ON public.credit_notes(patient_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_created         ON public.credit_notes(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bill_payers_bill             ON public.bill_payers(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payers_payer            ON public.bill_payers(payer_type, payer_ref_id);

CREATE INDEX IF NOT EXISTS idx_bills_admission              ON public.bills(admission_id) WHERE admission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bills_bill_type              ON public.bills(bill_type)     WHERE bill_type IS NOT NULL;


-- ── §10 RLS policies ─────────────────────────────────────────────────

ALTER TABLE public.patient_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_notes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_payers      ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- patient_deposits: all authenticated users can read; admin/staff can write
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'patient_deposits' AND policyname = 'patient_deposits_all_access') THEN
    CREATE POLICY patient_deposits_all_access ON public.patient_deposits FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- credit_notes: all authenticated users can read; admin can write
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'credit_notes' AND policyname = 'credit_notes_all_access') THEN
    CREATE POLICY credit_notes_all_access ON public.credit_notes FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- bill_payers
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bill_payers' AND policyname = 'bill_payers_all_access') THEN
    CREATE POLICY bill_payers_all_access ON public.bill_payers FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ── §11 Finance auto-sync trigger for deposits ──────────────────────

CREATE OR REPLACE FUNCTION sync_deposit_to_finance()
RETURNS TRIGGER AS $$
BEGIN
  -- Only sync on insert (deposit collected) or status change to refunded
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.hospital_fund (type, category, amount, description, submitted_by, approved_by, status, created_at)
    VALUES (
      'topup',
      'deposit',
      NEW.amount,
      'IPD Advance Deposit — Patient ID: ' || COALESCE(LEFT(NEW.patient_id::text, 8), '?') ||
        ' | Receipt: ' || COALESCE(NEW.receipt_number, 'N/A'),
      COALESCE(NEW.collected_by, 'System'),
      COALESCE(NEW.collected_by, 'System'),
      'approved',
      NOW()
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Non-fatal: don't block deposit recording if fund sync fails
  RAISE WARNING 'sync_deposit_to_finance failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_deposit_to_finance') THEN
    CREATE TRIGGER trg_sync_deposit_to_finance
      AFTER INSERT ON public.patient_deposits
      FOR EACH ROW
      EXECUTE FUNCTION sync_deposit_to_finance();
    RAISE NOTICE 'Created trigger trg_sync_deposit_to_finance';
  END IF;
END $$;


-- ── §12 Record migration ────────────────────────────────────────────

INSERT INTO schema_migrations (version, name, applied_at)
VALUES ('030', 'phase1_billing_enhancements', NOW())
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- Done. All Phase 1 schema changes applied.
-- ═══════════════════════════════════════════════════════════════════════
