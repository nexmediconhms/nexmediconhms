/**
 * src/app/api/users/invite/route.ts  — UPDATED
 *
 * CHANGE: Replaced the manual inline caller-role check with requireRole('admin').
 * Everything else — temp password generator, auth.admin.createUser, duplicate
 * email handling, rollback on profile insert failure, response shape — is
 * preserved from the original exactly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  // ── Auth gate: admin only ────────────────────────────────────
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  try {
    // Parse request body
    const body = await req.json()
    const { email, full_name, role, phone } = body

    if (!email || !full_name || !role) {
      return NextResponse.json({ error: 'email, full_name, and role are required' }, { status: 400 })
    }
    if (!['admin', 'doctor', 'staff'].includes(role)) {
      return NextResponse.json({ error: 'role must be admin, doctor, or staff' }, { status: 400 })
    }

    // Use admin client for privileged operations
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

    // Generate a temporary password
    const tempPassword = generateTempPassword()

    // Create auth user
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase(),
      password: tempPassword,
      email_confirm: true,  // auto-confirm email
      user_metadata: { full_name, role },
    })

    if (authError) {
      // User might already exist in auth but not in clinic_users
      if (authError.message.includes('already been registered') || authError.message.includes('already exists')) {
        const { data: { users } } = await adminClient.auth.admin.listUsers() as any
        const existingAuth = (users as any[])?.find((u: any) => u.email === email.toLowerCase())

        if (existingAuth) {
          // Create clinic_users record for existing auth user
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
            message: `User ${email} already had an auth account. Created clinic profile with role "${role}". They can log in with their existing password.`,
            tempPassword: null,
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

    return NextResponse.json({
      success: true,
      message: `User ${full_name} (${email}) created with role "${role}".`,
      tempPassword,
      _note: 'Share this temporary password with the user. They should change it after first login.',
    })

  } catch (err: any) {
    console.error('[users/invite]', err)
    return NextResponse.json({ error: err.message || 'Failed to invite user' }, { status: 500 })
  }
}

// ── Helpers ──────────────────────────────────────────────────

function generateTempPassword(): string {
  const words    = ['Welcome', 'Clinic', 'Health', 'Doctor', 'Staff', 'NexMed', 'Hospital']
  const word     = words[Math.floor(Math.random() * words.length)]
  const digits   = Math.floor(1000 + Math.random() * 9000)
  const specials = ['!', '@', '#', '$']
  const special  = specials[Math.floor(Math.random() * specials.length)]
  return `${word}${digits}${special}`
}