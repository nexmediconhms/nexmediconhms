/**
 * src/app/api/me/route.ts
 *
 * Returns the current authenticated user's clinic_users profile.
 * 
 * CRITICAL: This endpoint handles the first-time admin bootstrap.
 * When a user logs in and no clinic_users rows exist, it auto-creates
 * them as admin. This fixes the chicken-and-egg problem where:
 *   - RLS blocks client-side queries to clinic_users
 *   - No admin exists to add users via the UI
 *   - The first user needs to become admin automatically
 *
 * Uses service_role key if available (bypasses RLS).
 * Falls back to anon key + user token if service key is missing.
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
        { error: 'Server configuration incomplete (missing SUPABASE_URL or ANON_KEY)' },
        { status: 500 }
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

    // Create a client with the user's token to verify identity
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

    // Determine which client to use for DB operations
    // Prefer service_role (bypasses RLS) but fall back to user's token
    let dbClient
    let usingServiceRole = false

    if (serviceKey) {
      dbClient = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      usingServiceRole = true
    } else {
      // No service key — use the user's own token (subject to RLS)
      dbClient = userClient
    }

    // Try to find the user's clinic profile
    const { data, error } = await dbClient
      .from('clinic_users')
      .select('*')
      .eq('auth_id', authUser.id)
      .eq('is_active', true)
      .single()

    if (!error && data) {
      return NextResponse.json({ user: data })
    }

    // Profile not found — check if this is first-time setup (no users at all)
    const { count, error: countError } = await dbClient
      .from('clinic_users')
      .select('id', { count: 'exact', head: true })

    // If count query fails (RLS blocking even count), try a different approach
    if (countError && !usingServiceRole) {
      // RLS is blocking everything — we need to bootstrap
      // Try inserting directly (relies on "Allow first user bootstrap" RLS policy)
      console.log('[/api/me] RLS blocking count query, attempting direct bootstrap for:', authUser.email)
      
      const { data: newUser, error: insertError } = await userClient
        .from('clinic_users')
        .insert({
          auth_id: authUser.id,
          email: authUser.email,
          full_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Admin',
          role: 'admin',
          is_active: true,
        })
        .select()
        .single()

      if (!insertError && newUser) {
        return NextResponse.json({ user: newUser, bootstrapped: true })
      }

      // If insert also fails, return a helpful error
      console.error('[/api/me] Bootstrap insert failed:', insertError?.message)
      return NextResponse.json({
        error: 'Cannot access clinic_users table. RLS policies may need to be configured.',
        details: insertError?.message,
        fix: 'Run the SQL in 03-fix-clinic-users-rls.sql in your Supabase SQL Editor',
      }, { status: 500 })
    }

    if ((count ?? 0) === 0) {
      // First-time setup: auto-create this user as admin
      console.log('[/api/me] First-time setup — creating admin for:', authUser.email)

      const { data: newUser, error: insertError } = await dbClient
        .from('clinic_users')
        .insert({
          auth_id: authUser.id,
          email: authUser.email,
          full_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Admin',
          role: 'admin',
          is_active: true,
        })
        .select()
        .single()

      if (insertError) {
        console.error('[/api/me] Auto-bootstrap failed:', insertError.message)
        return NextResponse.json(
          { error: 'Failed to create admin profile', details: insertError.message },
          { status: 500 }
        )
      }

      return NextResponse.json({ user: newUser, bootstrapped: true })
    }

    // Table has users but this user isn't one of them
    // Try matching by email (handles auth_id mismatch after user re-creation)
    const { data: emailMatch, error: emailError } = await dbClient
      .from('clinic_users')
      .select('*')
      .eq('email', authUser.email || '')
      .eq('is_active', true)
      .single()

    if (!emailError && emailMatch) {
      // Found by email — fix the auth_id mismatch
      console.log('[/api/me] Fixing auth_id mismatch for:', authUser.email)
      
      await dbClient
        .from('clinic_users')
        .update({ auth_id: authUser.id })
        .eq('id', emailMatch.id)

      emailMatch.auth_id = authUser.id
      return NextResponse.json({ user: emailMatch, auth_id_fixed: true })
    }

    // Genuinely no profile for this user
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
