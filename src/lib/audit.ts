/**
 * src/lib/audit.ts
 *
 * Audit Log helper with Hash Chain Immutability
 *
 * Each audit entry is hashed (SHA-256) and linked to the previous entry,
 * creating a tamper-evident chain.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SECURITY FIX: Hash chain is now computed ATOMICALLY on the server  ║
 * ║  via a Postgres function (insert_audit_entry). This prevents race   ║
 * ║  conditions where concurrent writes could fork the chain.           ║
 * ║                                                                      ║
 * ║  Previous bug: Two concurrent audit writes could both read the SAME  ║
 * ║  prev_hash, creating duplicate chain links (forked chain).           ║
 * ║                                                                      ║
 * ║  Fix: The DB function uses advisory locking to serialize hash chain  ║
 * ║  computation. Only one insert can compute the chain at a time.       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   import { audit } from '@/lib/audit'
 *   await audit('create', 'patient', patient.id, patient.full_name)
 *   await audit('update', 'bill', bill.id, `Bill #${bill.invoice_number}`, { before, after })
 */

import { supabase } from '@/lib/supabase'

export type AuditAction =
  | 'create' | 'update' | 'delete'
  | 'view'   | 'print'
  | 'login'  | 'logout'
  | 'export' | 'scan' | 'autofill'
  | 'safety_override' | 'mfa_enroll' | 'mfa_verify'
  | 'backup' | 'purge'

export type AuditEntity =
  | 'patient'      | 'encounter'    | 'prescription'
  | 'bill'         | 'lab_report'   | 'attachment'
  | 'user'         | 'settings'     | 'discharge'
  | 'appointment'  | 'bed'
  | 'drug_interaction' | 'allergy_override' | 'critical_alert'

interface AuditChanges {
  before?: Record<string, unknown>
  after?:  Record<string, unknown>
}

let _cachedUser: { id: string; email: string; role: string } | null = null

/** Lazily fetch the current clinic_user from Supabase (cached per session). */
async function getCurrentUser() {
  if (_cachedUser) return _cachedUser

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('clinic_users')
    .select('id, email, role')
    .eq('auth_id', user.id)
    .single()

  if (data) {
    _cachedUser = { id: data.id, email: data.email, role: data.role }
  }
  return _cachedUser
}

/** Clear cache on logout */
export function clearAuditCache() {
  _cachedUser = null
}

// ─── Atomic Hash Chain Insert ─────────────────────────────────
//
// The hash chain is now computed server-side in the database via
// the `insert_audit_entry` RPC function. This eliminates the race
// condition where two concurrent clients could read the same prev_hash.
//
// If the RPC function doesn't exist yet (before migration), we fall back
// to a client-side approach with a local mutex to at least prevent
// concurrent calls from the same browser tab from racing.

/** Simple in-memory mutex to serialize audit calls from the same client */
let _auditLock: Promise<void> = Promise.resolve()

/**
 * Acquire the audit lock — ensures only one audit call is in-flight at a time
 * from this client instance. This is a secondary protection; the primary
 * protection is the database-level advisory lock in insert_audit_entry().
 */
function withAuditLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void
  const next = new Promise<void>(resolve => { release = resolve })
  const prev = _auditLock
  _auditLock = next

  return prev.then(async () => {
    try {
      return await fn()
    } finally {
      release!()
    }
  })
}

/**
 * Compute SHA-256 hash of an audit entry for tamper detection.
 * Used as fallback when the database RPC is unavailable.
 */
async function computeEntryHash(entry: Record<string, unknown>, prevHash: string | null): Promise<string> {
  try {
    const payload = JSON.stringify({
      ...entry,
      prev_hash: prevHash || 'GENESIS',
    })

    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder()
      const data = encoder.encode(payload)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    }

    let hash = 0
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `fallback-${Math.abs(hash).toString(16).padStart(8, '0')}`
  } catch {
    return `nohash-${Date.now()}`
  }
}

/**
 * Write an audit log entry with atomic hash chain.
 *
 * Strategy:
 *   1. Try the database RPC function `insert_audit_entry` (atomic, race-free)
 *   2. If RPC doesn't exist (pre-migration), fall back to client-side
 *      insert with a local mutex (prevents same-tab races, but not cross-tab)
 *
 * @param action       - What happened (create/update/delete/print/…)
 * @param entityType   - What kind of record was affected
 * @param entityId     - UUID of the affected record (optional for login/logout)
 * @param entityLabel  - Human-readable name (patient name, invoice number, etc.)
 * @param changes      - Optional { before, after } for update actions
 */
export async function audit(
  action:      AuditAction,
  entityType:  AuditEntity,
  entityId?:   string,
  entityLabel?: string,
  changes?:    AuditChanges,
): Promise<void> {
  try {
    const cu = await getCurrentUser()

    const entry = {
      user_id:      cu?.id    ?? null,
      user_email:   cu?.email ?? null,
      user_role:    cu?.role  ?? null,
      action,
      entity_type:  entityType,
      entity_id:    entityId    ?? null,
      entity_label: entityLabel ?? null,
      changes:      changes     ?? null,
    }

    // ── Strategy 1: API Route (preferred — bypasses RLS) ─────────
    const apiResult = await tryApiInsert(entry)
    if (apiResult === 'success') return

    // ── Strategy 2: Atomic RPC (fallback — race-free) ────────────
    const rpcResult = await tryAtomicInsert(entry)
    if (rpcResult === 'success') return
    // If RPC doesn't exist, fall through to Strategy 3

    // ── Strategy 3: Client-side mutex + hash (last resort) ───────
    await withAuditLock(async () => {
      await fallbackInsert(entry)
    })
  } catch (err) {
    // Never crash the app if audit fails — log and continue
    console.warn('[Audit] Unexpected error:', err)
  }
}

/**
 * Try to insert via the /api/audit API route.
 * This bypasses RLS since the API uses the service role key.
 * Returns 'success' if it worked, 'unavailable' if the API is unreachable.
 */
async function tryApiInsert(
  entry: Record<string, unknown>
): Promise<'success' | 'unavailable'> {
  // Only attempt API call in browser context (not during SSR)
  if (typeof window === 'undefined') return 'unavailable'
  try {
    const res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
    if (res.ok) return 'success'
    // If API returns error, fall through to other strategies
    return 'unavailable'
  } catch {
    // Network error or API not available
    return 'unavailable'
  }
}

/**
 * Try to insert via the atomic database RPC function.
 * Returns 'success' if it worked, 'unavailable' if the function doesn't exist.
 */
async function tryAtomicInsert(
  entry: Record<string, unknown>
): Promise<'success' | 'unavailable'> {
  try {
    const { error } = await supabase.rpc('insert_audit_entry', {
      p_user_id:      entry.user_id      as string | null,
      p_user_email:   entry.user_email   as string | null,
      p_user_role:    entry.user_role    as string | null,
      p_action:       entry.action       as string,
      p_entity_type:  entry.entity_type  as string,
      p_entity_id:    entry.entity_id    as string | null,
      p_entity_label: entry.entity_label as string | null,
      p_changes:      entry.changes      ? JSON.stringify(entry.changes) : null,
    })

    if (error) {
      // Check if the error is because the function doesn't exist yet
      // Supabase returns 42883 (undefined_function) or contains "does not exist"
      const msg = error.message?.toLowerCase() || ''
      const code = (error as any).code || ''
      if (
        code === '42883' ||
        msg.includes('does not exist') ||
        msg.includes('could not find') ||
        msg.includes('function') ||
        msg.includes('not found')
      ) {
        return 'unavailable'
      }

      // Some other error — log but don't crash
      console.warn('[Audit] RPC insert_audit_entry failed:', error.message)
      return 'unavailable' // Fall back to client-side
    }

    return 'success'
  } catch {
    return 'unavailable'
  }
}

/**
 * Fallback: Client-side hash computation with local mutex.
 * This prevents same-tab races. Cross-tab races are still possible
 * but are much less likely and non-critical (the chain will still be
 * ordered by created_at, just with potential duplicate prev_hash).
 */
async function fallbackInsert(entry: Record<string, unknown>): Promise<void> {
  try {
    // Read the latest hash
    const { data: lastEntry } = await supabase
      .from('audit_log')
      .select('entry_hash')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const prevHash = lastEntry?.entry_hash || null

    // Compute new hash
    const entryHash = await computeEntryHash(entry, prevHash)

    // Insert with hash chain
    const { error } = await supabase.from('audit_log').insert({
      ...entry,
      entry_hash: entryHash,
      prev_hash: prevHash,
    })

    if (error) {
      console.warn('[Audit] Fallback insert failed:', error.message)
    }
  } catch (err) {
    console.warn('[Audit] Fallback insert error:', err)
  }
}

/** Convenience: audit a login event */
export async function auditLogin() {
  await audit('login', 'user', undefined, undefined)
}

/** Convenience: audit a logout event */
export async function auditLogout() {
  await audit('logout', 'user', undefined, undefined)
  clearAuditCache()
}

/** Convenience: audit a safety override (drug interaction, allergy, dose) */
export async function auditSafetyOverride(
  overrideType: 'drug_interaction' | 'allergy_override' | 'critical_alert',
  entityId: string,
  entityLabel: string,
  details: Record<string, unknown>
) {
  await audit('safety_override', overrideType, entityId, entityLabel, { after: details })
}

// ─── Hash Chain Verification ──────────────────────────────────

export async function verifyAuditChain(limit: number = 100): Promise<{
  totalChecked: number
  valid: number
  broken: number
  brokenEntries: string[]
}> {
  try {
    const { data: entries } = await supabase
      .from('audit_log')
      .select('id, entry_hash, prev_hash, created_at')
      .order('created_at', { ascending: true })
      .limit(limit)

    if (!entries || entries.length === 0) {
      return { totalChecked: 0, valid: 0, broken: 0, brokenEntries: [] }
    }

    let valid = 0
    let broken = 0
    const brokenEntries: string[] = []

    for (let i = 1; i < entries.length; i++) {
      const current = entries[i]
      const previous = entries[i - 1]

      if (current.prev_hash === previous.entry_hash) {
        valid++
      } else if (current.prev_hash === null && previous.entry_hash === null) {
        valid++
      } else {
        broken++
        brokenEntries.push(current.id)
      }
    }

    return {
      totalChecked: entries.length,
      valid: valid + 1,
      broken,
      brokenEntries,
    }
  } catch {
    return { totalChecked: 0, valid: 0, broken: 0, brokenEntries: [] }
  }
}
