-- ═══════════════════════════════════════════════════════════════════════
-- Migration 031: Phase 2/3 Billing Enhancements
-- ═══════════════════════════════════════════════════════════════════════
-- ADDITIVE ONLY. All IF NOT EXISTS. Safe to re-run.
--
-- §1  lab_orders.bill_id + bill_item_id  — link lab orders to bill items
-- §2  billing_templates table            — procedure/package billing templates
-- §3  insurance_claims additive columns  — settlement linkage
-- §4  bills.credit_note_id              — link to credit note
-- §5  Indexes
-- §6  RLS
-- §7  Record migration
-- ═══════════════════════════════════════════════════════════════════════

-- §1 Lab Orders → Bill linkage
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lab_orders' AND column_name='bill_id') THEN
    ALTER TABLE public.lab_orders ADD COLUMN bill_id UUID;
    RAISE NOTICE 'Added lab_orders.bill_id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lab_orders' AND column_name='bill_item_id') THEN
    ALTER TABLE public.lab_orders ADD COLUMN bill_item_id TEXT;
    RAISE NOTICE 'Added lab_orders.bill_item_id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lab_orders' AND column_name='billing_status') THEN
    ALTER TABLE public.lab_orders ADD COLUMN billing_status TEXT DEFAULT 'unbilled';
    RAISE NOTICE 'Added lab_orders.billing_status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lab_orders' AND column_name='charge_amount') THEN
    ALTER TABLE public.lab_orders ADD COLUMN charge_amount NUMERIC(12,2) DEFAULT 0;
    RAISE NOTICE 'Added lab_orders.charge_amount';
  END IF;
END $$;

-- §2 Billing Templates
CREATE TABLE IF NOT EXISTS public.billing_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'procedure',
  description     TEXT,
  items           JSONB NOT NULL DEFAULT '[]',
  total           NUMERIC(12,2) DEFAULT 0,
  gst_percent     NUMERIC(5,2) DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  module          TEXT DEFAULT 'OPD',
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  is_deleted      BOOLEAN DEFAULT FALSE
);

COMMENT ON TABLE public.billing_templates IS
  'Reusable billing templates for procedures, packages, and common charge sets. Items is a JSON array of {label, amount, category}.';

-- §3 Insurance Claims — settlement linkage
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='insurance_claims' AND column_name='settled_amount') THEN
    ALTER TABLE public.insurance_claims ADD COLUMN settled_amount NUMERIC(12,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='insurance_claims' AND column_name='patient_copay') THEN
    ALTER TABLE public.insurance_claims ADD COLUMN patient_copay NUMERIC(12,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='insurance_claims' AND column_name='settlement_bill_id') THEN
    ALTER TABLE public.insurance_claims ADD COLUMN settlement_bill_id UUID;
  END IF;
END $$;

-- §4 Bills — credit note link
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='credit_note_id') THEN
    ALTER TABLE public.bills ADD COLUMN credit_note_id UUID;
  END IF;
END $$;

-- §5 Indexes
CREATE INDEX IF NOT EXISTS idx_lab_orders_bill         ON public.lab_orders(bill_id) WHERE bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_orders_billing_status ON public.lab_orders(billing_status);
CREATE INDEX IF NOT EXISTS idx_billing_templates_active ON public.billing_templates(is_active, category);
CREATE INDEX IF NOT EXISTS idx_billing_templates_module ON public.billing_templates(module);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_bill    ON public.insurance_claims(bill_id) WHERE bill_id IS NOT NULL;

-- §6 RLS
ALTER TABLE public.billing_templates ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'billing_templates' AND policyname = 'billing_templates_all_access') THEN
    CREATE POLICY billing_templates_all_access ON public.billing_templates FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- §7 Record migration
INSERT INTO schema_migrations (version, name, applied_at)
VALUES ('031', 'phase2_3_billing_enhancements', NOW())
ON CONFLICT DO NOTHING;
