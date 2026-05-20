/**
 * src/app/api/me/route.ts
 *
 * Returns the current authenticated user's clinic_users profile.
 * 
 * SIMPLIFIED: No auto-bootstrap. If no profile exists, returns 404.
 * Admin users are pre-created via SQL during deployment.
 *
 * Error handling:
 * - Table doesn't exist → returns 503 with clear "run SETUP-LOGIN-FIX.sql" message
 * - User not found → returns 404
 * - Auth failed → returns 401
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

    // Verify the user's identity using anon key + their token
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data: { user: authUser }, error: authError } = await userClient.auth.getUser()

    if (authError || !authUser) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    // Use service_role if available (bypasses RLS), else use user's token
    // With RLS disabled on clinic_users, even the user's token will work
    let dbClient
    if (serviceKey) {
      dbClient = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    } else {
      // Even without service_role, clinic_users has RLS DISABLED so this works
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

    // Check if the error is "table doesn't exist"
    if (error && (error.message?.includes('does not exist') || error.message?.includes('relation') || error.code === '42P01')) {
      return NextResponse.json({
        error: 'Database not set up. The clinic_users table does not exist.',
        fix: 'Run SETUP-LOGIN-FIX.sql in Supabase → SQL Editor. This creates the table and your admin account.',
        details: error.message,
      }, { status: 503 })
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
        // Fix the auth_id mismatch silently
        await dbClient
          .from('clinic_users')
          .update({ auth_id: authUser.id })
          .eq('id', emailMatch.id)

        emailMatch.auth_id = authUser.id
        return NextResponse.json({ user: emailMatch, auth_id_fixed: true })
      }
    }

    // No profile found
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
