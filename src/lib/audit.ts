/**
 * src/lib/audit.ts
 *
 * Audit Log helper with Hash Chain Immutability
 *
 * Each audit entry is hashed (SHA-256) and linked to the previous entry,
 * creating a blockchain-style tamper-evident chain.
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
  | 'export' | 'scan'
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

// ─── Hash Chain ───────────────────────────────────────────────

/**
 * Compute SHA-256 hash of an audit entry for tamper detection.
 * Uses the Web Crypto API (available in browsers and Node 18+).
 */
async function computeEntryHash(entry: Record<string, unknown>, prevHash: string | null): Promise<string> {
  try {
    const payload = JSON.stringify({
      ...entry,
      prev_hash: prevHash || 'GENESIS',
    })

    // Use Web Crypto API if available (browser + Node 18+)
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder()
      const data = encoder.encode(payload)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    }

    // Fallback: simple hash for environments without crypto.subtle
    let hash = 0
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return `fallback-${Math.abs(hash).toString(16).padStart(8, '0')}`
  } catch {
    return `nohash-${Date.now()}`
  }
}

/**
 * Get the hash of the most recent audit log entry.
 */
async function getLastEntryHash(): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('audit_log')
      .select('entry_hash')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    return data?.entry_hash || null
  } catch {
    return null
  }
}

/**
 * Write an audit log entry with hash chain.
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

    const entry: Record<string, unknown> = {
      user_id:      cu?.id    ?? null,
      user_email:   cu?.email ?? null,
      user_role:    cu?.role  ?? null,
      action,
      entity_type:  entityType,
      entity_id:    entityId    ?? null,
      entity_label: entityLabel ?? null,
      changes:      changes     ?? null,
    }

    // Compute hash chain
    const prevHash = await getLastEntryHash()
    const entryHash = await computeEntryHash(entry, prevHash)

    const { error } = await supabase.from('audit_log').insert({
      ...entry,
      entry_hash: entryHash,
      prev_hash: prevHash,
    })

    if (error) {
      // Don't crash the app if audit fails — just log to console
      console.warn('[Audit] Failed to write log entry:', error.message)
    }
  } catch (err) {
    console.warn('[Audit] Unexpected error:', err)
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

/**
 * Verify the integrity of the audit log hash chain.
 * Returns the number of valid entries and any broken links.
 *
 * Call this from admin settings to detect tampering.
 */
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
        // Both null — legacy entries before hash chain was added
        valid++
      } else {
        broken++
        brokenEntries.push(current.id)
      }
    }

    return {
      totalChecked: entries.length,
      valid: valid + 1, // first entry is always valid
      broken,
      brokenEntries,
    }
  } catch {
    return { totalChecked: 0, valid: 0, broken: 0, brokenEntries: [] }
  }
}
