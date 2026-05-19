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
    const { userId } = await req.json()

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const adminClient = getAdminClient()

    // Look up the user's auth_id from clinic_users
    const { data: clinicUser, error: lookupErr } = await adminClient
      .from('clinic_users')
      .select('auth_id, full_name, email')
      .eq('id', userId)
      .single()

    if (lookupErr || !clinicUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // List all MFA factors for this auth user
    const { data: factorsData, error: factorsErr } = await adminClient.auth.admin.mfa.listFactors({
      userId: clinicUser.auth_id,
    })

    if (factorsErr) {
      return NextResponse.json({ error: `Failed to list MFA factors: ${factorsErr.message}` }, { status: 500 })
    }

    const factors = factorsData?.factors || []

    if (factors.length === 0) {
      return NextResponse.json({
        success: true,
        message: `${clinicUser.full_name} has no MFA factors enrolled. They can login normally.`,
      })
    }

    // Unenroll all factors
    let unenrolled = 0
    for (const factor of factors) {
      const { error: delErr } = await adminClient.auth.admin.mfa.deleteFactor({
        userId: clinicUser.auth_id,
        factorId: factor.id,
      })
      if (!delErr) unenrolled++
    }

    // Update clinic_users to reflect MFA disabled
    await adminClient
      .from('clinic_users')
      .update({ mfa_enabled: false, mfa_enrolled_at: null })
      .eq('id', userId)

    return NextResponse.json({
      success: true,
      message: `MFA reset for ${clinicUser.full_name} (${clinicUser.email}). ${unenrolled} factor(s) removed. They can now login with email + password only.`,
    })
  } catch (err: any) {
    console.error('[reset-mfa]', err)
    return NextResponse.json({ error: err.message || 'Failed to reset MFA' }, { status: 500 })
  }
}
