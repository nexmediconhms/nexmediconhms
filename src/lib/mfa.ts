/**
 * src/lib/mfa.ts
 *
 * Multi-Factor Authentication (MFA) using Supabase's built-in TOTP
 *
 * Flow:
 *   1. Admin enables MFA requirement in settings
 *   2. User logs in with email/password
 *   3. If MFA not enrolled → show QR code to enroll
 *   4. If MFA enrolled → prompt for TOTP code
 *   5. Verify TOTP → grant access
 *
 * Uses Supabase Auth MFA API:
 *   - supabase.auth.mfa.enroll()
 *   - supabase.auth.mfa.challenge()
 *   - supabase.auth.mfa.verify()
 */

import { supabase } from './supabase'

// ─── Types ────────────────────────────────────────────────────

export interface MFAEnrollment {
  id: string
  type: 'totp'
  totp: {
    qr_code: string   // data URI for QR code
    secret: string     // base32 secret for manual entry
    uri: string        // otpauth:// URI
  }
}

export interface MFAFactor {
  id: string
  type: 'totp'
  status: 'verified' | 'unverified'
  created_at: string
  updated_at: string
}

export interface MFAChallengeResult {
  id: string
  expires_at: string
}

export interface MFAVerifyResult {
  success: boolean
  error?: string
}

// ─── Check MFA Status ─────────────────────────────────────────

/**
 * Check if the current user has MFA enrolled and verified.
 */
export async function getMFAStatus(): Promise<{
  enrolled: boolean
  verified: boolean
  factors: MFAFactor[]
}> {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error || !data) {
      return { enrolled: false, verified: false, factors: [] }
    }

    const totpFactors = (data.totp || []).map((f: any) => ({
      id: f.id,
      type: 'totp' as const,
      status: f.status || 'unverified',
      created_at: f.created_at,
      updated_at: f.updated_at,
    })) as MFAFactor[]
    const hasVerified = totpFactors.some(f => f.status === 'verified')

    return {
      enrolled: totpFactors.length > 0,
      verified: hasVerified,
      factors: totpFactors,
    }
  } catch {
    return { enrolled: false, verified: false, factors: [] }
  }
}

/**
 * Check if the current session has passed MFA verification.
 * Returns the Authenticator Assurance Level (AAL).
 */
export async function getAAL(): Promise<{
  currentLevel: 'aal1' | 'aal2'
  nextLevel: 'aal1' | 'aal2'
  needsMFA: boolean
}> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || !data) {
      return { currentLevel: 'aal1', nextLevel: 'aal1', needsMFA: false }
    }

    return {
      currentLevel: data.currentLevel as 'aal1' | 'aal2',
      nextLevel: data.nextLevel as 'aal1' | 'aal2',
      needsMFA: data.currentLevel === 'aal1' && data.nextLevel === 'aal2',
    }
  } catch {
    return { currentLevel: 'aal1', nextLevel: 'aal1', needsMFA: false }
  }
}

// ─── Enroll MFA ───────────────────────────────────────────────

/**
 * Start MFA enrollment — generates a TOTP secret and QR code.
 * User must scan the QR code with an authenticator app (Google Authenticator, Authy, etc.)
 * then verify with a code to complete enrollment.
 */
export async function enrollMFA(friendlyName?: string): Promise<{
  success: boolean
  enrollment?: MFAEnrollment
  error?: string
}> {
  try {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: friendlyName || 'NexMedicon HMS',
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      enrollment: {
        id: data.id,
        type: data.type as 'totp',
        totp: {
          qr_code: data.totp.qr_code,
          secret: data.totp.secret,
          uri: data.totp.uri,
        },
      },
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to enroll MFA' }
  }
}

// ─── Challenge & Verify ───────────────────────────────────────

/**
 * Create an MFA challenge for a specific factor.
 * This must be called before verify.
 */
export async function challengeMFA(factorId: string): Promise<{
  success: boolean
  challengeId?: string
  error?: string
}> {
  try {
    const { data, error } = await supabase.auth.mfa.challenge({ factorId })
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true, challengeId: data.id }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to create MFA challenge' }
  }
}

/**
 * Verify an MFA challenge with a TOTP code.
 * On success, the session is upgraded to AAL2.
 */
export async function verifyMFA(factorId: string, challengeId: string, code: string): Promise<MFAVerifyResult> {
  try {
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Invalid verification code' }
  }
}

/**
 * Convenience: challenge + verify in one step.
 * Used when the user enters their TOTP code on the login screen.
 */
export async function verifyMFACode(code: string): Promise<MFAVerifyResult> {
  const status = await getMFAStatus()
  const verifiedFactor = status.factors.find(f => f.status === 'verified')

  if (!verifiedFactor) {
    return { success: false, error: 'No MFA factor enrolled. Please set up MFA first.' }
  }

  const challenge = await challengeMFA(verifiedFactor.id)
  if (!challenge.success || !challenge.challengeId) {
    return { success: false, error: challenge.error || 'Failed to create challenge' }
  }

  return verifyMFA(verifiedFactor.id, challenge.challengeId, code)
}

// ─── Unenroll MFA ─────────────────────────────────────────────

/**
 * Remove MFA factor (admin action or user self-service).
 */
export async function unenrollMFA(factorId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to unenroll MFA' }
  }
}

// ─── Update clinic_users MFA status ───────────────────────────

/**
 * Mark the current user's MFA status in clinic_users table.
 */
export async function updateMFAStatus(userId: string, enabled: boolean): Promise<void> {
  try {
    await supabase
      .from('clinic_users')
      .update({
        mfa_enabled: enabled,
        mfa_enrolled_at: enabled ? new Date().toISOString() : null,
      })
      .eq('id', userId)
  } catch (err) {
    console.warn('[MFA] Failed to update clinic_users MFA status:', err)
  }
}
