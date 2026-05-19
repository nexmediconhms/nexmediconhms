/**
 * src/app/api/users/invite/route.ts — OTP-FIRST
 *
 * Creates a new clinic user (admin/doctor/staff/lab_partner).
 *
 * With OTP-first login, the flow is simplified:
 *   1. Admin enters email + name + role
 *   2. We create the Supabase auth user (with a random internal password they'll never use)
 *   3. We create the clinic_users profile
 *   4. Done — user can immediately login via email OTP (no temp password to share!)
 *
 * The old "temp password" flow is kept as a fallback option if admin explicitly requests it.
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
    const { email, full_name, role, phone, generatePassword } = body

    if (!email || !full_name || !role) {
      return NextResponse.json({ error: 'email, full_name, and role are required' }, { status: 400 })
    }
    if (!['admin', 'doctor', 'staff', 'lab_partner'].includes(role)) {
      return NextResponse.json({ error: 'role must be admin, doctor, staff, or lab_partner' }, { status: 400 })
    }

    let adminClient: ReturnType<typeof getAdminClient>
    try {
      adminClient = getAdminClient()
    } catch (err: any) {
      return NextResponse.json({
        error: err.message,
        _hint: 'Add SUPABASE_SERVICE_ROLE_KEY to your environment variables',
      }, { status: 500 })
    }

    // Check if user already exists in clinic_users
    const { data: existing } = await adminClient
      .from('clinic_users')
      .select('id, email, role')
      .eq('email', email.toLowerCase())
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({
        error: `User ${email} already exists with role "${existing[0].role}". Update their role from the user management panel instead.`,
      }, { status: 409 })
    }

    // Generate internal password — user won't need to know this (they use OTP)
    // Only generate a sharable temp password if admin explicitly asks for it
    const internalPassword = generatePassword
      ? generateTempPassword()
      : generateRandomPassword()

    // Create auth user with email auto-confirmed
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase(),
      password: internalPassword,
      email_confirm: true,
      user_metadata: { full_name, role },
    })

    if (authError) {
      // User might already exist in auth but not in clinic_users
      if (authError.message.includes('already been registered') || authError.message.includes('already exists')) {
        const { data: { users } } = await adminClient.auth.admin.listUsers() as any
        const existingAuth = (users as any[])?.find((u: any) => u.email === email.toLowerCase())

        if (existingAuth) {
          const { error: insertError } = await adminClient
            .from('clinic_users')
            .insert({
              auth_id: existingAuth.id,
              email: email.toLowerCase(),
              full_name,
              role,
              phone: phone || null,
              is_active: true,
            })

          if (insertError) {
            return NextResponse.json({ error: `Failed to create user profile: ${insertError.message}` }, { status: 500 })
          }

          return NextResponse.json({
            success: true,
            message: `User ${email} already had an auth account. Created clinic profile with role "${role}". They can login immediately using email OTP.`,
            loginMethod: 'otp',
          })
        }
      }
      return NextResponse.json({ error: `Auth error: ${authError.message}` }, { status: 500 })
    }

    // Create clinic_users record
    const { error: profileError } = await adminClient
      .from('clinic_users')
      .insert({
        auth_id:  authData.user.id,
        email:    email.toLowerCase(),
        full_name,
        role,
        phone:    phone || null,
        is_active: true,
      })

    if (profileError) {
      // Rollback: delete the auth user we just created
      await adminClient.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: `Failed to create user profile: ${profileError.message}` }, { status: 500 })
    }

    // Response depends on whether admin requested a password
    if (generatePassword) {
      return NextResponse.json({
        success: true,
        message: `User ${full_name} (${email}) created with role "${role}".`,
        loginMethod: 'password',
        tempPassword: internalPassword,
        _note: 'Share this password with the user. They can also login via email OTP without it.',
      })
    }

    return NextResponse.json({
      success: true,
      message: `User ${full_name} (${email}) created with role "${role}". They can login immediately using their email — no password needed!`,
      loginMethod: 'otp',
    })

  } catch (err: any) {
    console.error('[users/invite]', err)
    return NextResponse.json({ error: err.message || 'Failed to invite user' }, { status: 500 })
  }
}

// ── Helpers ──────────────────────────────────────────────────

/** Readable temp password (for when admin explicitly wants to share one) */
function generateTempPassword(): string {
  const words = ['Welcome', 'Clinic', 'Health', 'Doctor', 'Staff', 'NexMed', 'Hospital']
  const word = words[Math.floor(Math.random() * words.length)]
  const digits = Math.floor(1000 + Math.random() * 9000)
  const specials = ['!', '@', '#', '$']
  const special = specials[Math.floor(Math.random() * specials.length)]
  return `${word}${digits}${special}`
}

/** Strong random password (user never sees this — just for Supabase auth requirement) */
function generateRandomPassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%'
  let pwd = ''
  for (let i = 0; i < 24; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)]
  }
  return pwd
}