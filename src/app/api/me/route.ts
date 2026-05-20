/**
 * src/app/api/me/route.ts
 *
 * Returns the current authenticated user's clinic_users profile.
 * Uses the service_role key to bypass RLS — this ensures the user
 * can always load their own profile even if RLS policies on
 * clinic_users are misconfigured.
 *
 * The caller must send their Supabase access token in the
 * Authorization header (Bearer <token>). We verify the token
 * server-side using supabase.auth.getUser() to ensure authenticity.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return NextResponse.json(
        { error: 'Server configuration incomplete' },
        { status: 500 }
      )
    }

    // Extract the access token from the Authorization header or cookie
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) {
      return NextResponse.json(
        { error: 'No authorization token provided' },
        { status: 401 }
      )
    }

    // Verify the token by calling getUser with the user's token
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data: { user: authUser }, error: authError } = await userClient.auth.getUser()

    if (authError || !authUser) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    // Use admin client (service_role) to bypass RLS and fetch the clinic_users row
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await adminClient
      .from('clinic_users')
      .select('*')
      .eq('auth_id', authUser.id)
      .eq('is_active', true)
      .single()

    if (error || !data) {
      console.error('[/api/me] clinic_users lookup failed:', {
        authId: authUser.id,
        email: authUser.email,
        error: error?.message || 'No matching row found',
        code: error?.code,
      })
      return NextResponse.json(
        { error: 'No clinic profile found', details: error?.message },
        { status: 404 }
      )
    }

    return NextResponse.json({ user: data })
  } catch (err: any) {
    console.error('[/api/me] Unexpected error:', err.message)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
