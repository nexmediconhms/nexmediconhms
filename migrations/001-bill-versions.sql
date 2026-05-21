-- ============================================================
-- MIGRATION: Bill Versions — Immutable Audit Trail
-- Run in: Supabase SQL Editor
-- Purpose: Track all bill modifications with full snapshots
-- ============================================================

-- Create the bill_versions table for immutable bill history
CREATE TABLE IF NOT EXISTS bill_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_id UUID NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1,
  snapshot JSONB NOT NULL,           -- Full bill state at time of modification
  modified_by TEXT NOT NULL,          -- User who made the change
  modification_type TEXT NOT NULL,    -- 'discount', 'tax', 'amount', 'items', 'status'
  reason TEXT NOT NULL,               -- Required reason for modification
  previous_amount NUMERIC(10,2),      -- Amount BEFORE change
  new_amount NUMERIC(10,2),           -- Amount AFTER change
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_bill_version UNIQUE(bill_id, version_number)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bill_versions_bill_id ON bill_versions(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_versions_created ON bill_versions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_versions_modifier ON bill_versions(modified_by);

-- Enable RLS
ALTER TABLE bill_versions ENABLE ROW LEVEL SECURITY;

-- Policies:
-- Only admin and doctor can view bill versions (financial audit)
CREATE POLICY "Admin/Doctor can view bill versions" ON bill_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid()
        AND is_active = TRUE
        AND role IN ('admin', 'doctor')
    )
  );

-- Any authenticated active user can insert versions (the app controls when this happens)
CREATE POLICY "Active users can insert bill versions" ON bill_versions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND is_active = TRUE
    )
  );

-- IMPORTANT: No UPDATE or DELETE policies — versions are IMMUTABLE
-- This is by design for audit compliance.

COMMENT ON TABLE bill_versions IS 'Immutable bill modification history. Each row captures the complete state of a bill BEFORE it was modified. No updates or deletes allowed.';
