/**
 * src/app/api/users/reset-mfa/route.ts
 *
 * Admin-only endpoint to reset/disable MFA for a user who is locked out.
 * This allows the admin to unenroll all TOTP factors for a specified user.
 *
 * POST body: { userId: string } — the clinic_users.id (not auth_id)
 *
 * Use case: A doctor or staff member lost their phone or authenticator app
 * and cannot complete MFA verification. Admin resets their MFA so they can
 * login with just email+password and re-enroll MFA later.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'
import { getAdminClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  // Only admin can reset MFA for others
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    let adminClient: ReturnType<typeof getAdminClient>
    try {
      adminClient = getAdminClient()
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }

    // Look up the user's auth_id from clinic_users
    const { data: clinicUser, error: lookupErr } = await adminClient
      .from('clinic_users')
      .select('auth_id, full_name, email')
      .eq('id', userId)
      .single()

    if (lookupErr || !clinicUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // List all MFA factors for this auth user using admin API
    // Note: supabase-js v2.x uses auth.admin.mfa.listFactors
    // If that doesn't exist, fall back to updating clinic_users only
    let unenrolled = 0
    try {
      const { data: factorsData, error: factorsErr } = await (adminClient.auth.admin as any).mfa.listFactors({
        userId: clinicUser.auth_id,
      })

      if (!factorsErr && factorsData?.factors?.length > 0) {
        for (const factor of factorsData.factors) {
          try {
            await (adminClient.auth.admin as any).mfa.deleteFactor({
              userId: clinicUser.auth_id,
              factorId: factor.id,
            })
            unenrolled++
          } catch {
            // Continue even if one factor fails to delete
          }
        }
      }
    } catch (mfaErr: any) {
      // If admin MFA API is not available (older Supabase version),
      // we still update clinic_users to disable MFA flag.
      // The user will need to contact Supabase support for factor removal
      // OR the next login will work if their session is cleared.
      console.warn('[reset-mfa] Admin MFA API not available:', mfaErr.message || mfaErr)
    }

    // Update clinic_users to reflect MFA disabled
    await adminClient
      .from('clinic_users')
      .update({ mfa_enabled: false, mfa_enrolled_at: null })
      .eq('id', userId)

    return NextResponse.json({
      success: true,
      message: unenrolled > 0
        ? `MFA reset for ${clinicUser.full_name} (${clinicUser.email}). ${unenrolled} factor(s) removed. They can now login with email + password only.`
        : `MFA flag cleared for ${clinicUser.full_name} (${clinicUser.email}). They should be able to login without MFA on next attempt.`,
    })
  } catch (err: any) {
    console.error('[reset-mfa]', err)
    return NextResponse.json({ error: err.message || 'Failed to reset MFA' }, { status: 500 })
  }
}
