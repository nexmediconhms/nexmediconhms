/**
 * src/app/api/me/route.ts
 *
 * Returns the current authenticated user's clinic_users profile.
 * 
 * SIMPLIFIED: No auto-bootstrap. If no profile exists, returns 404.
 * Admin users are pre-created via SQL during deployment.
 *
 * What this does:
 * 1. Verifies the user's auth token
 * 2. Looks up their clinic_users row by auth_id
 * 3. If not found by auth_id, tries by email (handles auth_id mismatch)
 * 4. If still not found, returns 404 — user must be added by admin
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: 'Server configuration incomplete. Check Vercel environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY).' },
        { status: 500 }
      )
    }

    // Extract the access token from the Authorization header
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) {
      return NextResponse.json({ error: 'No authorization token provided' }, { status: 401 })
    }

    // Verify the user's identity
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data: { user: authUser }, error: authError } = await userClient.auth.getUser()

    if (authError || !authUser) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    // Determine which client to use for DB operations
    // Prefer service_role (bypasses RLS) but fall back to user's token
    let dbClient
    if (serviceKey) {
      dbClient = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    } else {
      dbClient = userClient
    }

    // Attempt 1: Find by auth_id
    const { data, error } = await dbClient
      .from('clinic_users')
      .select('*')
      .eq('auth_id', authUser.id)
      .eq('is_active', true)
      .single()

    if (!error && data) {
      return NextResponse.json({ user: data })
    }

    // Attempt 2: Find by email (handles auth_id mismatch after user re-creation)
    if (authUser.email) {
      const { data: emailMatch, error: emailError } = await dbClient
        .from('clinic_users')
        .select('*')
        .eq('email', authUser.email)
        .eq('is_active', true)
        .single()

      if (!emailError && emailMatch) {
        // Fix the auth_id mismatch
        await dbClient
          .from('clinic_users')
          .update({ auth_id: authUser.id })
          .eq('id', emailMatch.id)

        emailMatch.auth_id = authUser.id
        return NextResponse.json({ user: emailMatch, auth_id_fixed: true })
      }
    }

    // No profile found — return 404 (admin must add this user via Settings → Manage Users)
    return NextResponse.json(
      { error: 'No clinic profile found for this account', email: authUser.email },
      { status: 404 }
    )
  } catch (err: any) {
    console.error('[/api/me] Unexpected error:', err.message)
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    )
  }
}