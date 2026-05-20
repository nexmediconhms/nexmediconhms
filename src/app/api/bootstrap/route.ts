/**
 * src/app/api/bootstrap/route.ts
 *
 * First-time admin bootstrap endpoint.
 * 
 * This uses the service_role key to bypass RLS completely, which solves
 * the chicken-and-egg problem: RLS policies on clinic_users require an
 * admin to exist, but the first admin can't be created because no admin
 * exists yet to satisfy the INSERT policy.
 *
 * Security:
 * - Only works when the clinic_users table is COMPLETELY empty (0 rows)
 * - Requires a valid authenticated Supabase session (Bearer token)
 * - Creates exactly one admin user — subsequent calls will fail
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    // Detailed error for missing config
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: 'Supabase URL or Anon Key not configured. Check Vercel environment variables.' },
        { status: 500 }
      )
    }

    if (!serviceKey) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Vercel → Settings → Environment Variables. Find it in Supabase → Project Settings → API → service_role (secret).' },
        { status: 500 }
      )
    }

    // Parse request body
    const body = await req.json().catch(() => ({}))
    const fullName = body.full_name?.trim()

    if (!fullName) {
      return NextResponse.json(
        { error: 'full_name is required' },
        { status: 400 }
      )
    }

    // Extract the access token from the Authorization header
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

    // Use admin client (service_role) to bypass RLS
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // SECURITY CHECK: Only allow bootstrap if clinic_users is empty
    const { count, error: countError } = await adminClient
      .from('clinic_users')
      .select('id', { count: 'exact', head: true })

    if (countError) {
      console.error('[/api/bootstrap] Count query failed:', countError.message, countError.code)
      return NextResponse.json(
        { 
          error: 'Failed to check existing users', 
          details: countError.message,
          hint: countError.message.includes('does not exist') 
            ? 'The clinic_users table does not exist. Run the fresh-start-setup.sql in Supabase SQL Editor first.'
            : 'The SUPABASE_SERVICE_ROLE_KEY might be incorrect. Re-copy it from Supabase → Project Settings → API → service_role key.'
        },
        { status: 500 }
      )
    }

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Setup already completed. Users already exist. Contact your admin.' },
        { status: 403 }
      )
    }

    // Insert the first admin user (bypasses RLS via service_role)
    const { data, error: insertError } = await adminClient
      .from('clinic_users')
      .insert({
        auth_id: authUser.id,
        email: authUser.email,
        full_name: fullName,
        role: 'admin',
        is_active: true,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[/api/bootstrap] Insert failed:', insertError.message)
      return NextResponse.json(
        { error: 'Failed to create admin user', details: insertError.message },
        { status: 500 }
      )
    }

    console.log('[/api/bootstrap] First admin created:', {
      email: authUser.email,
      name: fullName,
      id: data.id,
    })

    return NextResponse.json({
      success: true,
      message: 'Admin account created successfully',
      user: {
        id: data.id,
        email: data.email,
        full_name: data.full_name,
        role: data.role,
      },
    })
  } catch (err: any) {
    console.error('[/api/bootstrap] Unexpected error:', err.message)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET — Check if first-time setup is needed
 * Uses service_role to bypass RLS for the count check
 */
export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { 
          error: 'Server configuration incomplete',
          hint: !serviceKey 
            ? 'SUPABASE_SERVICE_ROLE_KEY is missing from environment variables. Add it in Vercel → Settings → Environment Variables.'
            : 'NEXT_PUBLIC_SUPABASE_URL is missing.'
        },
        { status: 500 }
      )
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { count, error } = await adminClient
      .from('clinic_users')
      .select('id', { count: 'exact', head: true })

    if (error) {
      console.error('[/api/bootstrap] GET count failed:', error.message)
      return NextResponse.json(
        { error: 'Failed to check setup status' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      isFirstTime: (count ?? 0) === 0,
      userCount: count ?? 0,
    })
  } catch (err: any) {
    console.error('[/api/bootstrap] GET unexpected error:', err.message)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
