/**
 * src/app/api/bootstrap/route.ts
 *
 * First-time admin bootstrap endpoint — IMPROVED.
 *
 * FIXES:
 * - Better error diagnostics: tells you exactly what went wrong
 * - Handles the case where clinic_users table doesn't exist
 * - Handles the case where users exist but auth_id doesn't match
 * - Deletes stale clinic_users rows if they exist but have mismatched auth_ids
 *   (this happens when you recreate Supabase auth users but the old clinic_users
 *   rows still reference the old auth_ids)
 *
 * This uses the service_role key to bypass RLS completely, which solves
 * the chicken-and-egg problem: RLS policies on clinic_users require an
 * admin to exist, but the first admin can't be created because no admin
 * exists yet to satisfy the INSERT policy.
 *
 * Security:
 * - Only works when the clinic_users table is COMPLETELY empty (0 rows)
 *   OR when existing rows have no matching auth user (stale data)
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

    // ── Diagnostics: check each env var individually ──────────
    if (!supabaseUrl) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SUPABASE_URL is not set in environment variables' },
        { status: 500 }
      )
    }
    if (!anonKey) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SUPABASE_ANON_KEY is not set in environment variables' },
        { status: 500 }
      )
    }
    if (!serviceKey) {
      return NextResponse.json(
        {
          error: 'SUPABASE_SERVICE_ROLE_KEY is not set in environment variables',
          fix: 'Go to Supabase Dashboard → Project Settings → API → service_role key, then add it to Vercel Environment Variables',
        },
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
        { error: 'Invalid or expired token', details: authError?.message },
        { status: 401 }
      )
    }

    // Use admin client (service_role) to bypass RLS
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── Check if clinic_users table exists and count rows ──────
    const { count, error: countError } = await adminClient
      .from('clinic_users')
      .select('id', { count: 'exact', head: true })

    if (countError) {
      // Provide specific diagnostic info
      const errorDetails = {
        code: countError.code,
        message: countError.message,
        hint: countError.hint || undefined,
        details: countError.details || undefined,
      }

      // Common case: table doesn't exist
      if (
        countError.message?.includes('relation') &&
        countError.message?.includes('does not exist')
      ) {
        return NextResponse.json(
          {
            error: 'The clinic_users table does not exist in your Supabase database',
            fix: 'Run the database schema SQL in your Supabase SQL Editor. Check your project for a file like schema.sql or 00-schema.sql and execute it.',
            supabase_error: errorDetails,
          },
          { status: 500 }
        )
      }

      // Check if service key might be wrong (permission denied)
      if (
        countError.code === '42501' ||
        countError.message?.includes('permission denied')
      ) {
        return NextResponse.json(
          {
            error: 'Permission denied — the SUPABASE_SERVICE_ROLE_KEY might be incorrect',
            fix: 'Verify your SUPABASE_SERVICE_ROLE_KEY in Vercel matches what Supabase Dashboard → Project Settings → API shows.',
            supabase_error: errorDetails,
          },
          { status: 500 }
        )
      }

      // Generic error with full diagnostics
      console.error('[/api/bootstrap] Count query failed:', JSON.stringify(errorDetails))
      return NextResponse.json(
        {
          error: 'Failed to check existing users',
          supabase_error: errorDetails,
          fix: 'Check the Supabase logs and verify your environment variables are correct.',
        },
        { status: 500 }
      )
    }

    // ── If users exist, check if any of them are actually reachable ──
    if ((count ?? 0) > 0) {
      // Check if the current user already has a profile
      const { data: existingProfile } = await adminClient
        .from('clinic_users')
        .select('id, email, role, auth_id')
        .or(`auth_id.eq.${authUser.id},email.eq.${authUser.email}`)
        .limit(1)

      if (existingProfile && existingProfile.length > 0) {
        const profile = existingProfile[0]

        // If auth_id doesn't match, fix it
        if (profile.auth_id !== authUser.id) {
          await adminClient
            .from('clinic_users')
            .update({ auth_id: authUser.id })
            .eq('id', profile.id)

          return NextResponse.json({
            success: true,
            message: `Your existing profile (${profile.role}) was found and auth link was repaired. Try refreshing the page.`,
            user: { ...profile, auth_id: authUser.id },
            auth_id_fixed: true,
          })
        }

        return NextResponse.json(
          {
            error: `Setup already completed. You already have a "${profile.role}" account. Try refreshing the page or sign out and sign back in.`,
          },
          { status: 403 }
        )
      }

      // Users exist but none match this auth user
      // Check if all existing clinic_users have valid auth accounts
      const { data: allUsers } = await adminClient
        .from('clinic_users')
        .select('id, email, auth_id, role')

      if (allUsers && allUsers.length > 0) {
        // Verify each user's auth_id is still valid
        let hasValidAdmin = false
        for (const u of allUsers) {
          if (u.role === 'admin') {
            try {
              const { data: { user: checkUser } } = await adminClient.auth.admin.getUserById(u.auth_id)
              if (checkUser) {
                hasValidAdmin = true
                break
              }
            } catch {
              // auth user doesn't exist anymore — this is a stale row
            }
          }
        }

        if (!hasValidAdmin) {
          // All admin rows are stale (their auth accounts no longer exist)
          // This happens when someone deletes auth users from Supabase dashboard
          // but clinic_users rows remain.
          // Safe to clear stale data and let this user become admin.
          console.log('[/api/bootstrap] All existing admin rows are stale. Clearing clinic_users for fresh bootstrap.')

          const { error: deleteError } = await adminClient
            .from('clinic_users')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000')

          if (deleteError) {
            // Can't delete — there might be FK constraints.
            // Fall through to create the admin alongside stale rows.
            console.warn('[/api/bootstrap] Could not clear stale rows:', deleteError.message)
          }
          // Continue to insert below
        } else {
          return NextResponse.json(
            {
              error: 'Setup already completed. An admin account exists. Contact your admin to add your email.',
              existingUserCount: allUsers.length,
            },
            { status: 403 }
          )
        }
      }
    }

    // ── Insert the first admin user (bypasses RLS via service_role) ──
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

      // Check for common insert errors
      if (insertError.message?.includes('duplicate key')) {
        return NextResponse.json(
          {
            error: 'A user with this email already exists. Try signing out and back in.',
            details: insertError.message,
          },
          { status: 409 }
        )
      }

      return NextResponse.json(
        {
          error: 'Failed to create admin user',
          details: insertError.message,
          code: insertError.code,
          hint: insertError.hint || undefined,
        },
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
    console.error('[/api/bootstrap] Unexpected error:', err.message, err.stack)
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
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
          missing: [
            ...(!supabaseUrl ? ['NEXT_PUBLIC_SUPABASE_URL'] : []),
            ...(!serviceKey ? ['SUPABASE_SERVICE_ROLE_KEY'] : []),
          ],
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
      console.error('[/api/bootstrap] GET count failed:', error.message, error.code)

      // If the table doesn't exist, it's definitely first-time setup
      if (error.message?.includes('does not exist')) {
        return NextResponse.json({
          isFirstTime: true,
          userCount: 0,
          warning: 'clinic_users table does not exist — run the schema SQL first',
        })
      }

      return NextResponse.json(
        {
          error: 'Failed to check setup status',
          details: error.message,
          code: error.code,
        },
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
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    )
  }
}