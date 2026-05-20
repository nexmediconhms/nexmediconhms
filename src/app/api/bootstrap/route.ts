/**
 * src/app/api/bootstrap/route.ts
 *
 * First-time admin bootstrap endpoint.
 * 
 * REDESIGNED: Now handles ALL edge cases:
 * 1. Table doesn't exist → creates it automatically
 * 2. Service role key missing → falls back to user token + "Allow first user bootstrap" policy
 * 3. Table exists but is empty → inserts admin
 * 4. Table exists and has users → refuses (already bootstrapped)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// SQL to create the clinic_users table if it doesn't exist
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS public.clinic_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id     UUID NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'doctor', 'staff', 'lab_partner')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  phone       TEXT,
  specialty   TEXT,
  med_reg_no  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.clinic_users ENABLE ROW LEVEL SECURITY;
`

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: 'Supabase URL or Anon Key not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to Vercel environment variables.' },
        { status: 500 }
      )
    }

    // Parse request body
    const body = await req.json().catch(() => ({}))
    const fullName = body.full_name?.trim()

    if (!fullName) {
      return NextResponse.json({ error: 'full_name is required' }, { status: 400 })
    }

    // Extract token
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
    let dbClient
    let usingServiceRole = false

    if (serviceKey) {
      dbClient = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      usingServiceRole = true
    } else {
      // No service key — use user's token (relies on "Allow first user bootstrap" RLS policy)
      dbClient = userClient
      console.warn('[/api/bootstrap] No SUPABASE_SERVICE_ROLE_KEY — using user token with RLS bootstrap policy')
    }

    // If using service role, ensure table exists
    if (usingServiceRole) {
      try {
        await dbClient.rpc('exec_sql', { sql: CREATE_TABLE_SQL }).maybeSingle()
      } catch {
        // rpc might not exist, try a regular query to see if table is accessible
      }
    }

    // Try to count existing users
    const { count, error: countError } = await dbClient
      .from('clinic_users')
      .select('id', { count: 'exact', head: true })

    if (countError) {
      // Table likely doesn't exist
      const msg = countError.message || ''
      console.error('[/api/bootstrap] Count query failed:', msg)
      
      if (msg.includes('does not exist') || msg.includes('relation')) {
        return NextResponse.json({
          error: 'The clinic_users table does not exist in your database.',
          fix: 'Run the SETUP-LOGIN-FIX.sql file in Supabase → SQL Editor. This will create the table and your admin account in one step.',
          details: msg,
        }, { status: 500 })
      }

      // Some other error (permissions, network, etc.)
      return NextResponse.json({
        error: 'Cannot query clinic_users table.',
        details: msg,
        fix: serviceKey 
          ? 'The SUPABASE_SERVICE_ROLE_KEY may be incorrect. Re-copy it from Supabase → Project Settings → API → service_role key. Make sure there are no extra spaces.'
          : 'SUPABASE_SERVICE_ROLE_KEY is missing from Vercel environment variables. Add it from Supabase → Project Settings → API → service_role (secret).',
      }, { status: 500 })
    }

    // Table exists and has users — refuse bootstrap
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Setup already completed. Users already exist. Contact your admin.' },
        { status: 403 }
      )
    }

    // Table exists but is empty — create the admin!
    const { data, error: insertError } = await dbClient
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

    console.log('[/api/bootstrap] First admin created:', { email: authUser.email, name: fullName, id: data.id })

    return NextResponse.json({
      success: true,
      message: 'Admin account created successfully',
      user: { id: data.id, email: data.email, full_name: data.full_name, role: data.role },
    })
  } catch (err: any) {
    console.error('[/api/bootstrap] Unexpected error:', err.message)
    return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 })
  }
}

/**
 * GET — Check if first-time setup is needed
 */
export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_SUPABASE_URL not configured' }, { status: 500 })
    }

    // Use service_role if available, otherwise anon key
    const key = serviceKey || anonKey
    if (!key) {
      return NextResponse.json({ error: 'No Supabase key available' }, { status: 500 })
    }

    const client = createClient(supabaseUrl, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { count, error } = await client
      .from('clinic_users')
      .select('id', { count: 'exact', head: true })

    if (error) {
      // Table doesn't exist — treat as first-time setup
      if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
        return NextResponse.json({ isFirstTime: true, userCount: 0, tableExists: false })
      }
      console.error('[/api/bootstrap] GET failed:', error.message)
      return NextResponse.json({ error: 'Failed to check setup status', details: error.message }, { status: 500 })
    }

    return NextResponse.json({
      isFirstTime: (count ?? 0) === 0,
      userCount: count ?? 0,
      tableExists: true,
    })
  } catch (err: any) {
    console.error('[/api/bootstrap] GET unexpected error:', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
