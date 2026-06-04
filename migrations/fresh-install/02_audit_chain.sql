-- ════════════════════════════════════════════════════════════════════
-- 02_audit_chain.sql
--
-- FRESH-INSTALL STEP 3 of 7 — Tamper-evident audit-log hash chain.
--
-- This is the single source of truth for audit-log integrity:
--   1. insert_audit_entry()       — atomic, advisory-locked insert
--                                    that computes SHA-256 hash chain
--                                    based on the actual row contents.
--   2. protect_audit_hash_columns — trigger that rejects any UPDATE to
--                                    entry_hash / prev_hash. Audit log
--                                    is APPEND-ONLY.
--   3. verify_audit_chain()       — for admin diagnostic page; now
--                                    RECOMPUTES each row's expected hash
--                                    from contents (catches tampering).
--
-- Re-runnable safely (CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- Hash chain columns (idempotent)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entry_hash TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash  TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_log_entry_hash ON audit_log(entry_hash);

-- ════════════════════════════════════════════════════════════════════
-- §1  ATOMIC INSERT (advisory-locked, SHA-256, content-bound)
-- ════════════════════════════════════════════════════════════════════
--
-- The hash binds: user identity + action + entity + changes + prev_hash.
-- Any tampering with these fields invalidates the chain.
--
-- Concurrency is serialised via pg_advisory_xact_lock(8675309) — the
-- lock auto-releases at transaction commit. Lightweight: well under 1ms
-- per audit insert under typical hospital load (<100 concurrent users).
-- ════════════════════════════════════════════════════════════════════

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
  -- Serialise hash-chain computation across concurrent writers.
  PERFORM pg_advisory_xact_lock(8675309);

  -- Read the most recent entry's hash
  SELECT entry_hash INTO v_prev_hash
    FROM audit_log
    ORDER BY created_at DESC
    LIMIT 1;

  -- Build canonical payload — must match verify_audit_chain() byte-for-byte.
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

-- ════════════════════════════════════════════════════════════════════
-- §2  IMMUTABILITY TRIGGER
-- ════════════════════════════════════════════════════════════════════
-- Audit entries must never be modified. The trigger rejects any UPDATE
-- that touches entry_hash / prev_hash. We also block UPDATEs to the
-- substantive columns to keep the chain trustworthy.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION protect_audit_hash_columns()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.entry_hash    IS DISTINCT FROM NEW.entry_hash    THEN
      RAISE EXCEPTION 'Cannot modify entry_hash — audit log is immutable'; END IF;
    IF OLD.prev_hash     IS DISTINCT FROM NEW.prev_hash     THEN
      RAISE EXCEPTION 'Cannot modify prev_hash — audit log is immutable'; END IF;
    IF OLD.action        IS DISTINCT FROM NEW.action        THEN
      RAISE EXCEPTION 'Cannot modify action — audit log is immutable'; END IF;
    IF OLD.entity_type   IS DISTINCT FROM NEW.entity_type   THEN
      RAISE EXCEPTION 'Cannot modify entity_type — audit log is immutable'; END IF;
    IF OLD.entity_id     IS DISTINCT FROM NEW.entity_id     THEN
      RAISE EXCEPTION 'Cannot modify entity_id — audit log is immutable'; END IF;
    IF OLD.entity_label  IS DISTINCT FROM NEW.entity_label  THEN
      RAISE EXCEPTION 'Cannot modify entity_label — audit log is immutable'; END IF;
    IF OLD.changes       IS DISTINCT FROM NEW.changes       THEN
      RAISE EXCEPTION 'Cannot modify changes — audit log is immutable'; END IF;
    IF OLD.user_id       IS DISTINCT FROM NEW.user_id       THEN
      RAISE EXCEPTION 'Cannot modify user_id — audit log is immutable'; END IF;
    IF OLD.user_email    IS DISTINCT FROM NEW.user_email    THEN
      RAISE EXCEPTION 'Cannot modify user_email — audit log is immutable'; END IF;
    IF OLD.user_role     IS DISTINCT FROM NEW.user_role     THEN
      RAISE EXCEPTION 'Cannot modify user_role — audit log is immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_audit_hashes ON audit_log;
CREATE TRIGGER trg_protect_audit_hashes
  BEFORE UPDATE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION protect_audit_hash_columns();

-- Block DELETE on audit log (separate trigger so message is clear)
CREATE OR REPLACE FUNCTION block_audit_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Cannot delete audit log entries — append-only by design';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_audit_delete ON audit_log;
CREATE TRIGGER trg_block_audit_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION block_audit_delete();

-- ════════════════════════════════════════════════════════════════════
-- §3  CHAIN VERIFICATION (recomputes hashes from contents)
-- ════════════════════════════════════════════════════════════════════
-- Returns:
--   total_checked       — rows examined
--   valid_links         — rows whose recomputed hash matches stored hash
--                         AND prev_hash matches previous row's entry_hash
--   broken_links        — rows that fail either check
--   first_broken_id     — earliest broken row (for forensics)
--
-- Critical: this verifies content integrity, not just chain linking.
-- The previous (client-side) verifier only compared prev_hash links
-- which let any single-row tampering slip through.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION verify_audit_chain(p_limit INTEGER DEFAULT 1000)
RETURNS TABLE(
  total_checked   INTEGER,
  valid_links     INTEGER,
  broken_links    INTEGER,
  first_broken_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total          INTEGER := 0;
  v_valid          INTEGER := 0;
  v_broken         INTEGER := 0;
  v_first_broken   UUID    := NULL;
  v_prev_stored    TEXT    := NULL;
  v_prev_for_chain TEXT    := NULL;
  v_payload        TEXT;
  v_expected_hash  TEXT;
  v_row            RECORD;
  v_is_valid       BOOLEAN;
BEGIN
  -- Admin-only
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Access denied. verify_audit_chain is admin-only.';
  END IF;

  FOR v_row IN
    SELECT id, user_id, user_email, user_role,
           action, entity_type, entity_id, entity_label,
           changes, entry_hash, prev_hash, created_at
      FROM audit_log
      ORDER BY created_at ASC
      LIMIT p_limit
  LOOP
    v_total := v_total + 1;

    -- Recompute expected hash from this row's contents + prev_for_chain
    v_payload := json_build_object(
      'user_id',      COALESCE(v_row.user_id::TEXT, 'null'),
      'user_email',   COALESCE(v_row.user_email, 'null'),
      'user_role',    COALESCE(v_row.user_role, 'null'),
      'action',       v_row.action,
      'entity_type',  v_row.entity_type,
      'entity_id',    COALESCE(v_row.entity_id, 'null'),
      'entity_label', COALESCE(v_row.entity_label, 'null'),
      'changes',      COALESCE(v_row.changes::TEXT, 'null'),
      'prev_hash',    COALESCE(v_prev_for_chain, 'GENESIS')
    )::TEXT;

    v_expected_hash := encode(digest(v_payload, 'sha256'), 'hex');

    -- Valid iff: stored hash matches recomputed hash AND prev_hash chain links correctly
    v_is_valid := (v_row.entry_hash = v_expected_hash)
                  AND (v_row.prev_hash IS NOT DISTINCT FROM v_prev_stored);

    IF v_is_valid THEN
      v_valid := v_valid + 1;
    ELSE
      v_broken := v_broken + 1;
      IF v_first_broken IS NULL THEN
        v_first_broken := v_row.id;
      END IF;
    END IF;

    -- Walk the chain using STORED hash (so we can detect a forged middle row)
    v_prev_stored    := v_row.entry_hash;
    v_prev_for_chain := v_row.entry_hash;
  END LOOP;

  RETURN QUERY SELECT v_total, v_valid, v_broken, v_first_broken;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_audit_chain TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- DONE
-- ════════════════════════════════════════════════════════════════════

INSERT INTO schema_migrations (version, name, applied_at, notes)
VALUES ('FI-02', 'fresh_install_audit_chain', NOW(),
        'Tamper-evident hash chain (atomic insert + immutability + content-based verification)')
ON CONFLICT (version) DO NOTHING;

COMMIT;

SELECT 'Fresh-install 02/07: Audit chain — DONE' AS result;
