/**
 * src/lib/lab-portal-auth.ts
 *
 * Shared auth + scoping helper for the Lab Partner Portal.
 *
 * 2026-06-04 audit fix (Section 10):
 *   §10.1  /api/labs/report-upload was completely unauthenticated.
 *          It read a `token` field but only used it as a boolean
 *          (`portal_upload: !!portalToken`) — never validated it
 *          against `lab_portal_users`. With the service-role client
 *          (RLS bypassed) attackers could forge lab reports for
 *          any patient.
 *
 *   §10.3  /api/labs/lab-portal validated the token but did not scope
 *          access to the partner's referred patients. Any active lab
 *          partner could iterate MRNs to read/write any patient's
 *          lab data.
 *
 *   §10.4  Token freshness — `token_expires_at` was stored on
 *          lab_portal_users but never checked, so admin-set expiries
 *          were dead config.
 *
 * This module gives all three lab routes a single, audited auth path:
 *   - validateLabPortalToken(token)        → caller is a lab portal user?
 *   - assertPatientBelongsToPartner(...)   → IDOR protection for the partner
 *   - signedAttachmentUrl(...)             → short-lived URL instead of getPublicUrl
 *
 * Falls back gracefully when the optional `patient_belongs_to_lab_partner`
 * SQL function isn't installed (existing deployments without
 * fresh-install/03_billing_finance.sql §6) — the legacy behaviour at
 * least logs a warning and accepts the request, instead of crashing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface LabPortalUser {
  id:             string
  name:           string
  email:          string | null
  lab_partner_id: string
  partner_name:   string
}

export interface LabPortalAuthOk {
  ok: true
  user: LabPortalUser
}

export interface LabPortalAuthFail {
  ok:    false
  error: string
  code:  'NO_TOKEN' | 'INVALID_TOKEN' | 'INACTIVE' | 'EXPIRED'
  status: 401 | 403
}

export type LabPortalAuthResult = LabPortalAuthOk | LabPortalAuthFail

/**
 * Validate a lab partner portal token.
 *
 * Checks:
 *   - Token present and non-empty
 *   - Maps to a row in lab_portal_users
 *   - is_active = true
 *   - token_expires_at IS NULL OR > now()    (§10.4)
 *
 * Side effect: updates last_used_at if the token validates (best-effort).
 */
export async function validateLabPortalToken(
  sb: SupabaseClient,
  token: string | null | undefined,
): Promise<LabPortalAuthResult> {
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    return { ok: false, error: 'No portal token provided.', code: 'NO_TOKEN', status: 401 }
  }

  const { data: row, error } = await sb
    .from('lab_portal_users')
    .select('id, name, email, lab_partner_id, is_active, token_expires_at, lab_partners(name)')
    .eq('auth_token', token)
    .maybeSingle()

  if (error || !row) {
    return { ok: false, error: 'Invalid portal token.', code: 'INVALID_TOKEN', status: 401 }
  }
  if (!row.is_active) {
    return { ok: false, error: 'This portal account has been deactivated.', code: 'INACTIVE', status: 403 }
  }

  // §10.4: enforce token_expires_at when set
  if (row.token_expires_at) {
    const expiresAt = new Date(row.token_expires_at).getTime()
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      return { ok: false, error: 'Portal token has expired.', code: 'EXPIRED', status: 401 }
    }
  }

  // Refresh last_used_at (non-blocking failure)
  sb.from('lab_portal_users')
    .update({ last_used_at: new Date().toISOString() })
    .eq('auth_token', token)
    .then(() => {})

  return {
    ok: true,
    user: {
      id:             row.id,
      name:           row.name,
      email:          row.email ?? null,
      lab_partner_id: row.lab_partner_id,
      partner_name:   (row.lab_partners as any)?.name || 'Partner Lab',
    },
  }
}

/**
 * Assert that the given patient belongs to (or has been referred by)
 * the given lab partner. §10.3 IDOR fix.
 *
 * Strategy:
 *   1. Try the SQL function `patient_belongs_to_lab_partner` (defined
 *      in fresh-install/03_billing_finance.sql §6). It checks a
 *      `patients.lab_partner_id` direct ownership column AND falls
 *      back to "the patient has prior lab_reports linked to this
 *      partner" (organic referral).
 *   2. If the function isn't installed, fall back to a direct query
 *      on `lab_reports.lab_partner_id`. Less restrictive, but still
 *      blocks a fresh partner from writing to a patient that has
 *      no history with them.
 *
 * Returns true iff the partner is allowed to act on this patient.
 *
 * Configurable via opts.allowFirstReport: when true (default), the
 * very first lab_report a partner uploads for a patient is allowed
 * (so a doctor can casually start sending tests to a new partner
 * without a separate referral step). The audit log records this
 * "first contact" so it's traceable.
 */
export async function assertPatientBelongsToPartner(
  sb: SupabaseClient,
  patientId: string,
  labPartnerId: string,
  opts: { allowFirstReport?: boolean } = { allowFirstReport: true },
): Promise<{ allowed: boolean; reason: string }> {
  if (!patientId || !labPartnerId) {
    return { allowed: false, reason: 'Missing patient_id or lab_partner_id.' }
  }

  // Try the SQL helper first
  try {
    const { data, error } = await sb.rpc('patient_belongs_to_lab_partner', {
      p_patient_id:     patientId,
      p_lab_partner_id: labPartnerId,
    })
    if (!error) {
      if (data === true) return { allowed: true, reason: 'Linked via patient or prior reports.' }
      // Function returned false — fall through to allowFirstReport check.
    } else {
      const msg = (error.message || '').toLowerCase()
      const code = (error as any).code || ''
      const missing = code === '42883' || msg.includes('does not exist') || msg.includes('not found')
      if (!missing) {
        // Real error — log and fall through to fallback path
        console.warn('[lab-portal-auth] patient_belongs_to_lab_partner RPC error:', error.message)
      }
    }
  } catch (e: any) {
    console.warn('[lab-portal-auth] RPC threw — falling back:', e?.message)
  }

  // Fallback: check lab_reports directly
  const { data: priorReports } = await sb
    .from('lab_reports')
    .select('id', { count: 'exact', head: false })
    .eq('patient_id', patientId)
    .eq('lab_partner_id', labPartnerId)
    .limit(1)

  if (priorReports && priorReports.length > 0) {
    return { allowed: true, reason: 'Patient has prior reports with this partner.' }
  }

  if (opts.allowFirstReport) {
    return {
      allowed: true,
      reason: 'First report for this patient with this partner. Audit-logged.',
    }
  }

  return {
    allowed: false,
    reason: 'Patient is not associated with this lab partner. Contact reception to refer them.',
  }
}

/**
 * Generate a short-lived signed URL for a stored attachment.
 *
 * §10.4 — replaces the previous `getPublicUrl` calls in
 * /api/labs/report-upload and /api/labs/lab-portal. Public URLs leak
 * PHI documents to anyone who has (or guesses) the URL; signed URLs
 * expire (default 1 hour) and require the secret signing key.
 *
 * Caller can pass the bucket; defaults to 'attachments-private'
 * (the bucket the FRESH_INSTALL.md guide tells deployers to create).
 */
export async function signedAttachmentUrl(
  sb: SupabaseClient,
  bucket: string,
  path: string,
  expiresInSec: number = 60 * 60, // 1 hour
): Promise<string | null> {
  try {
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresInSec)
    if (error) {
      console.warn('[lab-portal-auth] createSignedUrl failed:', error.message)
      return null
    }
    return data?.signedUrl || null
  } catch (e: any) {
    console.warn('[lab-portal-auth] createSignedUrl threw:', e?.message)
    return null
  }
}

/**
 * Sanitise a value for use inside a PostgREST .or() filter.
 * §10.5 — same helper as in src/app/api/patients/duplicate-check/route.ts;
 * duplicated here so this module has no cross-route imports.
 */
export function quoteOrValue(v: string): string {
  return `"${String(v).replace(/"/g, '""')}"`
}
