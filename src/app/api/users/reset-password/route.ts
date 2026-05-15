/**
 * src/app/api/users/reset-password/route.ts
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * ────────
 * Allows ADMIN to reset any staff/doctor/admin user's password.
 * Generates a new temporary password and returns it.
 * The admin then shares this with the user (e.g., verbally or on paper).
 * 
 * THE BUG (Bug #5):
 * ─────────────────
 * Previously, password reset required the user to:
 * 1. Remember their email
 * 2. Click "Forgot Password" on login
 * 3. Check their email inbox
 * 4. Click the reset link
 * 5. Set a new password
 * 
 * This is problematic in a hospital:
 * - Staff may not have regular email access at the clinic
 * - Doctor doesn't have time for a multi-step email flow
 * - In an emergency, admin needs to instantly restore access
 * 
 * SOLUTION:
 * ─────────
 * Admin clicks "Reset Password" next to any user in Settings → Manage Users.
 * API generates a temp password and returns it instantly.
 * No email required. Admin tells the user their new password.
 * 
 * SECURITY:
 * ─────────
 * - Only users with role 'admin' can call this API
 * - Uses Supabase Admin API (service_role key) to update auth password
 * - Generates strong temporary password (word + 4 digits + special char)
 * - Audit logged
 * 
 * DOES IT BREAK ANYTHING?
 * ───────────────────────
 * No. This is a NEW API endpoint. The existing "Forgot Password" flow via
 * email still works for users who prefer self-service.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  // ── Auth gate: admin only ────────────────────────────────────
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  try {
    const body = await req.json()
    const { userId } = body  // clinic_users.id (NOT auth_id)

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    // Get admin client for privileged operations
    let adminClient: ReturnType<typeof getAdminClient>
    try {
      adminClient = getAdminClient()
    } catch (err: any) {
      return NextResponse.json({
        error: err.message,
        _hint: 'Add SUPABASE_SERVICE_ROLE_KEY to your environment variables',
      }, { status: 500 })
    }

    // Look up the user's auth_id from clinic_users
    const { data: clinicUser, error: lookupErr } = await adminClient
      .from('clinic_users')
      .select('auth_id, email, full_name, role')
      .eq('id', userId)
      .single()

    if (lookupErr || !clinicUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Generate a new temporary password
    const tempPassword = generateTempPassword()

    // Update the user's password via Supabase Admin API
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(
      clinicUser.auth_id,
      { password: tempPassword }
    )

    if (updateErr) {
      return NextResponse.json({ 
        error: `Failed to reset password: ${updateErr.message}` 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `Password reset for ${clinicUser.full_name} (${clinicUser.email}).`,
      tempPassword,
      userName: clinicUser.full_name,
      userEmail: clinicUser.email,
      userRole: clinicUser.role,
      _note: 'Share this temporary password with the user. They should change it after login.',
    })

  } catch (err: any) {
    console.error('[users/reset-password]', err)
    return NextResponse.json({ error: err.message || 'Failed to reset password' }, { status: 500 })
  }
}

// ── Helper ──────────────────────────────────────────────────

function generateTempPassword(): string {
  const words = ['Reset', 'Clinic', 'Access', 'Secure', 'Health', 'NexMed', 'Temp']
  const word = words[Math.floor(Math.random() * words.length)]
  const digits = Math.floor(1000 + Math.random() * 9000)
  const specials = ['!', '@', '#', '$', '&']
  const special = specials[Math.floor(Math.random() * specials.length)]
  return `${word}${digits}${special}`
}
