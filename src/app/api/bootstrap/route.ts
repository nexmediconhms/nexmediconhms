/**
 * src/app/api/bootstrap/route.ts
 *
 * OPTIONAL utility endpoint — NOT used in the main auth flow.
 * 
 * The primary admin setup is now done via SQL (SETUP-LOGIN-FIX.sql)
 * during deployment. This endpoint is kept only as an emergency
 * fallback tool that can be called manually if needed.
 *
 * GET  → Check if clinic_users table is empty (for diagnostics)
 * POST → Manually create admin (requires valid auth token + empty table)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: 'Supabase URL or Anon Key not configured.' },
        { status: 500 }
      )
    }

    if (!serviceKey) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is required for bootstrap. Add it in Vercel → Settings → Environment Variables.' },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const fullName = body.full_name?.trim()

    if (!fullName) {
      return NextResponse.json({ error: 'full_name is required' }, { status: 400 })
    }

    // Verify token
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) {
      return NextResponse.json({ error: 'No authorization token provided' }, { status: 401 })
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data: { user: authUser }, error: authError } = await userClient.auth.getUser()

    if (authError || !authUser) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    // Use service_role to bypass RLS
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Only allow if clinic_users is empty
    const { count, error: countError } = await adminClient
      .from('clinic_users')
      .select('id', { count: 'exact', head: true })

    if (countError) {
      return NextResponse.json(
        { error: 'Failed to check existing users', details: countError.message },
        { status: 500 }
      )
    }

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Users already exist. Use Settings → Manage Users to add new users.' },
        { status: 403 }
      )
    }

    // Insert admin
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
      return NextResponse.json(
        { error: 'Failed to create admin user', details: insertError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Admin account created successfully',
      user: { id: data.id, email: data.email, full_name: data.full_name, role: data.role },
    })
  } catch (err: any) {
    console.error('[/api/bootstrap] Error:', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET — Diagnostic: check if first-time setup is needed
 */
export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const key = serviceKey || anonKey
    if (!supabaseUrl || !key) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    }

    const client = createClient(supabaseUrl, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { count, error } = await client
      .from('clinic_users')
      .select('id', { count: 'exact', head: true })

    if (error) {
      return NextResponse.json({
        isFirstTime: true,
        userCount: 0,
        tableExists: false,
        error: error.message,
      })
    }

    return NextResponse.json({
      isFirstTime: (count ?? 0) === 0,
      userCount: count ?? 0,
      tableExists: true,
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
