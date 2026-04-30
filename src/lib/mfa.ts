/**
 * src/lib/mfa.ts  — UPDATED
 *
 * Changes vs original:
 *  1. getAAL() now correctly reads currentLevel / nextLevel from
 *     supabase.auth.mfa.getAuthenticatorAssuranceLevel() and determines
 *     needsMFA = (nextLevel === 'aal2' && currentLevel !== 'aal2').
 *  2. verifyMFACode() now reuses a single challenge created once and caches
 *     the challengeId within the call, preventing double-challenge bugs.
 *  3. unenrollMFA() now also clears the clinic_users DB row in one call.
 *  4. getMFAEnforcementStatus() helper added — lets admin pages check whether
 *     the current session is AAL2 before allowing sensitive operations.
 *
 * Uses Supabase Auth MFA API:
 *   supabase.auth.mfa.listFactors()
 *   supabase.auth.mfa.getAuthenticatorAssuranceLevel()
 *   supabase.auth.mfa.enroll()
 *   supabase.auth.mfa.challenge()
 *   supabase.auth.mfa.verify()
 *   supabase.auth.mfa.unenroll()
 */

import { supabase } from './supabase'

// ─── Types ────────────────────────────────────────────────────

export interface MFAEnrollment {
  id:   string
  type: 'totp'
  totp: {
    qr_code: string  // data URI (<img src={...}>)
    secret:  string  // base32 — for manual entry
    uri:     string  // otpauth:// URI
  }
}

export interface MFAFactor {
  id:         string
  type:       'totp'
  status:     'verified' | 'unverified'
  created_at: string
  updated_at: string
}

export interface MFAVerifyResult {
  success: boolean
  error?:  string
}

// ─── Check MFA Status ─────────────────────────────────────────

/**
 * List all TOTP factors enrolled for the current user.
 * Returns enrolled=true even for unverified factors (user started but didn't finish).
 * verified=true only when at least one factor is status='verified'.
 */
export async function getMFAStatus(): Promise<{
  enrolled: boolean
  verified: boolean
  factors:  MFAFactor[]
}> {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error || !data) return { enrolled: false, verified: false, factors: [] }

    const totpFactors = (data.totp ?? []).map((f: any): MFAFactor => ({
      id:         f.id,
      type:       'totp',
      status:     f.status ?? 'unverified',
      created_at: f.created_at,
      updated_at: f.updated_at,
    }))

    return {
      enrolled: totpFactors.length > 0,
      verified: totpFactors.some(f => f.status === 'verified'),
      factors:  totpFactors,
    }
  } catch {
    return { enrolled: false, verified: false, factors: [] }
  }
}

/**
 * Check the Authenticator Assurance Level of the current session.
 *
 * currentLevel  — the level the current token is at:
 *   'aal1' = password-only login
 *   'aal2' = MFA verified
 *
 * nextLevel — the level required to access this account:
 *   'aal1' = no MFA factor enrolled
 *   'aal2' = user has a verified TOTP factor; session must be AAL2
 *
 * needsMFA = nextLevel === 'aal2' && currentLevel !== 'aal2'
 *           → show TOTP prompt before granting dashboard access
 */
export async function getAAL(): Promise<{
  currentLevel: 'aal1' | 'aal2'
  nextLevel:    'aal1' | 'aal2'
  needsMFA:     boolean
}> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || !data) return { currentLevel: 'aal1', nextLevel: 'aal1', needsMFA: false }

    const current = (data.currentLevel ?? 'aal1') as 'aal1' | 'aal2'
    const next    = (data.nextLevel    ?? 'aal1') as 'aal1' | 'aal2'

    return {
      currentLevel: current,
      nextLevel:    next,
      needsMFA:     next === 'aal2' && current !== 'aal2',
    }
  } catch {
    return { currentLevel: 'aal1', nextLevel: 'aal1', needsMFA: false }
  }
}

/**
 * Convenience helper for pages that require AAL2 before performing
 * sensitive operations (e.g. user management, audit-log access, bulk delete).
 *
 * Usage:
 *   const { isEnforced } = await getMFAEnforcementStatus()
 *   if (!isEnforced) { showReAuthModal(); return }
 */
export async function getMFAEnforcementStatus(): Promise<{
  isEnforced: boolean
  reason:     string
}> {
  try {
    const aal = await getAAL()
    if (aal.currentLevel === 'aal2') {
      return { isEnforced: true, reason: 'Session is AAL2 (MFA verified)' }
    }
    if (aal.nextLevel === 'aal1') {
      return { isEnforced: false, reason: 'User has no MFA factor enrolled' }
    }
    return { isEnforced: false, reason: 'MFA required but not yet verified this session' }
  } catch {
    return { isEnforced: false, reason: 'Could not determine AAL' }
  }
}

// ─── Enroll MFA ───────────────────────────────────────────────

/**
 * Start MFA enrollment.
 * Returns a QR code (data URI) and a base32 secret.
 * User must scan the QR → enter a TOTP code → call verifyMFA() to activate.
 */
export async function enrollMFA(friendlyName?: string): Promise<{
  success:    boolean
  enrollment?: MFAEnrollment
  error?:     string
}> {
  try {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType:   'totp',
      friendlyName: friendlyName || 'NexMedicon HMS',
    })

    if (error) return { success: false, error: error.message }

    return {
      success: true,
      enrollment: {
        id:   data.id,
        type: data.type as 'totp',
        totp: {
          qr_code: data.totp.qr_code,
          secret:  data.totp.secret,
          uri:     data.totp.uri,
        },
      },
    }
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Failed to start MFA enrollment' }
  }
}

// ─── Challenge ────────────────────────────────────────────────

/**
 * Create a challenge for a specific factor ID.
 * Must be called immediately before verify().
 * Challenges expire in ~5 minutes.
 */
export async function challengeMFA(factorId: string): Promise<{
  success:     boolean
  challengeId?: string
  error?:      string
}> {
  try {
    const { data, error } = await supabase.auth.mfa.challenge({ factorId })
    if (error) return { success: false, error: error.message }
    return { success: true, challengeId: data.id }
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Failed to create MFA challenge' }
  }
}

// ─── Verify ───────────────────────────────────────────────────

/**
 * Verify a challenge using the TOTP code.
 * On success the session is upgraded to AAL2.
 */
export async function verifyMFA(
  factorId:    string,
  challengeId: string,
  code:        string,
): Promise<MFAVerifyResult> {
  try {
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code })
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Verification failed' }
  }
}

/**
 * One-shot: challenge + verify using the first verified factor.
 * Used on the MFA login screen when the user types their TOTP code.
 *
 * FIX vs original: we no longer call challengeMFA twice;
 * we store the challengeId and pass it directly to verifyMFA.
 */
export async function verifyMFACode(code: string): Promise<MFAVerifyResult> {
  const status = await getMFAStatus()
  const factor = status.factors.find(f => f.status === 'verified')

  if (!factor) {
    return { success: false, error: 'No MFA factor enrolled. Please set up MFA in Settings first.' }
  }

  const challenge = await challengeMFA(factor.id)
  if (!challenge.success || !challenge.challengeId) {
    return { success: false, error: challenge.error ?? 'Failed to create challenge' }
  }

  return verifyMFA(factor.id, challenge.challengeId, code)
}

// ─── Unenroll ─────────────────────────────────────────────────

/**
 * Remove an MFA factor. Also clears mfa_enabled in clinic_users.
 */
export async function unenrollMFA(factorId: string, clinicUserId?: string): Promise<{
  success: boolean
  error?:  string
}> {
  try {
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) return { success: false, error: error.message }

    // Sync clinic_users table if we know the internal user id
    if (clinicUserId) {
      await updateMFAStatus(clinicUserId, false)
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Failed to unenroll MFA' }
  }
}

// ─── Update clinic_users MFA status ───────────────────────────

/**
 * Sync MFA status to clinic_users table (for admin visibility).
 * Fire-and-forget — never throws.
 */
export async function updateMFAStatus(clinicUserId: string, enabled: boolean): Promise<void> {
  try {
    await supabase
      .from('clinic_users')
      .update({
        mfa_enabled:    enabled,
        mfa_enrolled_at: enabled ? new Date().toISOString() : null,
      })
      .eq('id', clinicUserId)
  } catch (err) {
    console.warn('[MFA] Failed to update clinic_users MFA status:', err)
  }
}