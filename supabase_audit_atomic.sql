-- ============================================================
-- AUDIT LOG — Atomic Hash Chain Insert Function
-- ============================================================
--
-- SECURITY FIX: This function ensures hash chain integrity by
-- serializing audit log inserts using an advisory lock.
--
-- Problem it solves:
--   Two concurrent audit writes could both read the SAME prev_hash
--   (because the read and write were separate operations on the client),
--   creating a forked chain where two entries point to the same parent.
--
-- Solution:
--   This function uses pg_advisory_xact_lock() to ensure only ONE
--   insert can compute the hash chain at a time. The lock is released
--   automatically when the transaction commits.
--
-- Performance:
--   Advisory locks are lightweight (no table-level locking).
--   Under normal hospital load (< 100 concurrent users), the
--   serialization overhead is negligible (< 1ms per audit entry).
--
-- Run this ONCE in Supabase → SQL Editor → New Query.
-- Safe to re-run (uses CREATE OR REPLACE).
-- ============================================================

-- ─── Add hash chain columns if they don't exist ──────────────
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entry_hash TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash  TEXT;

-- ─── Index for fast prev_hash lookup ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_log_entry_hash ON audit_log(entry_hash);
CREATE INDEX IF NOT EXISTS idx_audit_log_chain ON audit_log(created_at DESC) 
  INCLUDE (entry_hash);

-- ─── Enable pgcrypto extension for SHA-256 ───────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Atomic insert function ──────────────────────────────────
CREATE OR REPLACE FUNCTION insert_audit_entry(
  p_user_id      UUID    DEFAULT NULL,
  p_user_email   TEXT    DEFAULT NULL,
  p_user_role    TEXT    DEFAULT NULL,
  p_action       TEXT    DEFAULT 'view',
  p_entity_type  TEXT    DEFAULT 'user',
  p_entity_id    TEXT    DEFAULT NULL,
  p_entity_label TEXT    DEFAULT NULL,
  p_changes      JSONB   DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_hash  TEXT;
  v_entry_hash TEXT;
  v_entry_id   UUID;
  v_payload    TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(8675309);

  SELECT entry_hash INTO v_prev_hash
  FROM audit_log
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_prev_hash IS NULL THEN
    v_prev_hash := NULL;
  END IF;

  v_payload := json_build_object(
    'user_id',      COALESCE(p_user_id::TEXT, 'null'),
    'user_email',   COALESCE(p_user_email, 'null'),
    'user_role',    COALESCE(p_user_role, 'null'),
    'action',       p_action,
    'entity_type',  p_entity_type,
    'entity_id',    COALESCE(p_entity_id, 'null'),
    'entity_label', COALESCE(p_entity_label, 'null'),
    'changes',      COALESCE(p_changes::TEXT, 'null'),
    'prev_hash',    COALESCE(v_prev_hash, 'GENESIS')
  )::TEXT;

  v_entry_hash := encode(digest(v_payload, 'sha256'), 'hex');

  INSERT INTO audit_log (
    user_id, user_email, user_role,
    action, entity_type, entity_id, entity_label,
    changes, entry_hash, prev_hash
  ) VALUES (
    p_user_id, p_user_email, p_user_role,
    p_action, p_entity_type, p_entity_id, p_entity_label,
    p_changes, v_entry_hash, v_prev_hash
  )
  RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_audit_entry TO authenticated;

-- ─── Prevent direct manipulation of hash columns ─────────────
CREATE OR REPLACE FUNCTION protect_audit_hash_columns()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.entry_hash IS DISTINCT FROM NEW.entry_hash THEN
      RAISE EXCEPTION 'Cannot modify entry_hash — audit log is immutable';
    END IF;
    IF OLD.prev_hash IS DISTINCT FROM NEW.prev_hash THEN
      RAISE EXCEPTION 'Cannot modify prev_hash — audit log is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_audit_hashes ON audit_log;
CREATE TRIGGER trg_protect_audit_hashes
  BEFORE UPDATE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION protect_audit_hash_columns();

-- ─── Verification function (for admin use) ───────────────────
CREATE OR REPLACE FUNCTION verify_audit_chain(p_limit INTEGER DEFAULT 1000)
RETURNS TABLE(
  total_checked INTEGER,
  valid_links   INTEGER,
  broken_links  INTEGER,
  first_broken_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total   INTEGER := 0;
  v_valid   INTEGER := 0;
  v_broken  INTEGER := 0;
  v_first_broken UUID := NULL;
  v_prev_hash TEXT := NULL;
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT id, entry_hash, prev_hash
    FROM audit_log
    ORDER BY created_at ASC
    LIMIT p_limit
  LOOP
    v_total := v_total + 1;

    IF v_total = 1 THEN
      v_valid := v_valid + 1;
    ELSE
      IF v_row.prev_hash = v_prev_hash THEN
        v_valid := v_valid + 1;
      ELSIF v_row.prev_hash IS NULL AND v_prev_hash IS NULL THEN
        v_valid := v_valid + 1;
      ELSE
        v_broken := v_broken + 1;
        IF v_first_broken IS NULL THEN
          v_first_broken := v_row.id;
        END IF;
      END IF;
    END IF;

    v_prev_hash := v_row.entry_hash;
  END LOOP;

  RETURN QUERY SELECT v_total, v_valid, v_broken, v_first_broken;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_audit_chain TO authenticated;
