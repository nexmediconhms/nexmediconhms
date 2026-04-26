/**
 * src/lib/audit.ts
 *
 * Audit Log helper — call these functions from any page/component
 * to record who did what. Entries go into the `audit_log` Supabase table.
 *
 * Usage:
 *   import { audit } from '@/lib/audit'
 *   await audit('create', 'patient', patient.id, patient.full_name)
 *   await audit('update', 'bill', bill.id, `Bill #${bill.invoice_number}`, { before, after })
 *   await audit('delete', 'encounter', id, patientName)
 *   await audit('print', 'prescription', id, patientName)
 */

import { supabase } from '@/lib/supabase'

export type AuditAction =
  | 'create' | 'update' | 'delete'
  | 'view'   | 'print'
  | 'login'  | 'logout'
  | 'export' | 'scan'

export type AuditEntity =
  | 'patient'      | 'encounter'    | 'prescription'
  | 'bill'         | 'lab_report'   | 'attachment'
  | 'user'         | 'settings'     | 'discharge'
  | 'appointment'  | 'bed'

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

/**
 * Write an audit log entry.
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

    const { error } = await supabase.from('audit_log').insert(entry)
    if (error) {
      // Don't crash the app if audit fails — just log to console
      console.warn('[Audit] Failed to write log entry:', error.message)
    }
  } catch (err) {
    console.warn('[Audit] Unexpected error:', err)
  }
}

/** Convenience: audit a login event */
export async function auditLogin(email: string) {
  _cachedUser = null // clear cache so we refetch with new session
  await audit('login', 'user', undefined, email)
}

/** Convenience: audit a logout event */
export async function auditLogout(email?: string) {
  await audit('logout', 'user', undefined, email)
  clearAuditCache()
}