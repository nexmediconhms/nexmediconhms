-- Migration 039: Discharge Sign-offs Table
-- Adds a formal sign-off mechanism for nurses and doctors during patient discharge.
-- Each sign-off records: who signed, their role, when, and optional comments.
-- SAFE: Fully idempotent, no drops or renames of existing tables.

-- Create the discharge_signoffs table
CREATE TABLE IF NOT EXISTS public.discharge_signoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id UUID NOT NULL,
  patient_id UUID,
  role TEXT NOT NULL CHECK (role IN ('nurse', 'doctor', 'admin')),
  signed_by TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'rejected', 'revoked')),
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by admission
CREATE INDEX IF NOT EXISTS idx_discharge_signoffs_admission
  ON public.discharge_signoffs(admission_id);

-- Index for lookups by patient
CREATE INDEX IF NOT EXISTS idx_discharge_signoffs_patient
  ON public.discharge_signoffs(patient_id);

-- RLS: Allow all authenticated users to read and write sign-offs
ALTER TABLE public.discharge_signoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS discharge_signoffs_authenticated_all ON public.discharge_signoffs;
CREATE POLICY discharge_signoffs_authenticated_all
  ON public.discharge_signoffs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON public.discharge_signoffs TO authenticated;
GRANT ALL ON public.discharge_signoffs TO service_role;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

SELECT 'Migration 039: Discharge sign-offs table created successfully' AS result;
