/**
 * src/app/api/reset-seed/route.ts
 *
 * DANGER ZONE — Wipes ALL data and creates fresh users.
 *
 * After running this, you can login with:
 *   - admin@nexmedicon.com  / Welcome@1234  (Admin)
 *   - doctor@nexmedicon.com / Welcome@1234  (Doctor)
 *   - staff@nexmedicon.com  / Welcome@1234  (Staff)
 *   - lab@nexmedicon.com    / Welcome@1234  (Lab Partner)
 *
 * HOW TO USE:
 *   Option A (from browser): Visit /api/reset-seed?confirm=yes-delete-everything
 *     → This is a GET request that runs the reset. Simple and works even when login is broken.
 *
 *   Option B (from code/Postman): POST /api/reset-seed
 *     Headers: X-Confirm-Reset: yes-delete-everything
 *
 * WHAT IT DOES:
 *   1. Deletes all rows from data tables (respecting FK order)
 *   2. Deletes all Supabase auth users
 *   3. Creates 4 fresh users with password "Welcome@1234"
 *
 * SECURITY NOTE:
 *   This endpoint uses the SUPABASE_SERVICE_ROLE_KEY server-side.
 *   After your initial setup, you should DELETE this file or disable it.
 *   Never leave it accessible in production.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const DEFAULT_PASSWORD = 'Welcome@1234'

const SEED_USERS = [
  {
    email: 'admin@nexmedicon.com',
    full_name: 'Admin User',
    role: 'admin',
    phone: '+919876543210',
  },
  {
    email: 'doctor@nexmedicon.com',
    full_name: 'Dr. Sharma',
    role: 'doctor',
    phone: '+919876543211',
    specialty: 'General Medicine',
    med_reg_no: 'MED-2024-001',
  },
  {
    email: 'staff@nexmedicon.com',
    full_name: 'Staff Member',
    role: 'staff',
    phone: '+919876543212',
  },
  {
    email: 'lab@nexmedicon.com',
    full_name: 'Lab Partner',
    role: 'lab_partner',
    phone: '+919876543213',
  },
]

// Tables to clear — child tables first to avoid FK violations.
// We use a broad list and skip any table that doesn't exist.
const TABLES_TO_CLEAR = [
  'auditlog',
  'reminderlog',
  'reminders',
  'attachments',
  'videorooms',
  'bill_payments',
  'bills',
  'dischargesummaries',
  'ipdadmissions',
  'beds',
  'ancvisits',
  'ancregistrations',
  'labreports',
  'prescriptions',
  'encounters',
  'opdqueue',
  'appointments',
  'hospitalfund',
  'ipdchargerates',
  'portalsessions',
  'portalpatients',
  'patients',
  'labpartners',
  'clinic_users',
]

async function runReset(supabaseUrl: string, serviceKey: string) {
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const log: string[] = []

  // ── Step 1: Clear all data tables ──────────────────────────
  log.push('=== Step 1: Clearing data tables ===')

  for (const table of TABLES_TO_CLEAR) {
    try {
      const { error } = await adminClient
        .from(table)
        .delete()
        .not('id', 'is', null)

      if (error) {
        if (error.message?.includes('does not exist') || error.code === '42P01') {
          log.push(`  ${table}: table does not exist, skipped`)
        } else if (error.message?.includes('column') && error.message?.includes('id')) {
          const { error: err2 } = await adminClient
            .from(table)
            .delete()
            .gte('created_at', '1900-01-01')

          if (err2) {
            log.push(`  ${table}: could not clear (${err2.code}: ${err2.message})`)
          } else {
            log.push(`  ${table}: cleared (via created_at)`)
          }
        } else if (error.message?.includes('violates foreign key')) {
          log.push(`  ${table}: FK violation, will retry after other tables`)
        } else {
          log.push(`  ${table}: error (${error.code}: ${error.message})`)
        }
      } else {
        log.push(`  ${table}: cleared`)
      }
    } catch (err: any) {
      log.push(`  ${table}: exception (${err.message})`)
    }
  }

  // Retry tables that had FK violations (now their children should be gone)
  for (const table of TABLES_TO_CLEAR) {
    try {
      const { count } = await adminClient
        .from(table)
        .select('*', { count: 'exact', head: true })

      if (count && count > 0) {
        const { error } = await adminClient
          .from(table)
          .delete()
          .not('id', 'is', null)

        if (!error) {
          log.push(`  ${table}: cleared on retry`)
        }
      }
    } catch {
      // Ignore — table might not exist
    }
  }

  // ── Step 2: Delete all Supabase auth users ─────────────────
  log.push('')
  log.push('=== Step 2: Deleting auth users ===')

  let deletedAuthCount = 0
  try {
    let page = 1
    let hasMore = true

    while (hasMore) {
      const { data: listData, error: listError } = await adminClient.auth.admin.listUsers({
        page,
        perPage: 100,
      })

      if (listError || !listData?.users?.length) {
        hasMore = false
        if (listError) log.push(`  Error listing users: ${listError.message}`)
        break
      }

      for (const user of listData.users) {
        try {
          const { error: delError } = await adminClient.auth.admin.deleteUser(user.id)
          if (!delError) {
            deletedAuthCount++
          } else {
            log.push(`  Could not delete ${user.email}: ${delError.message}`)
          }
        } catch (err: any) {
          log.push(`  Exception deleting ${user.email}: ${err.message}`)
        }
      }

      if (listData.users.length < 100) {
        hasMore = false
      } else {
        page++
      }
    }
  } catch (err: any) {
    log.push(`  Exception during auth user deletion: ${err.message}`)
  }

  log.push(`  Deleted ${deletedAuthCount} auth users`)

  // ── Step 3: Create fresh seed users ────────────────────────
  log.push('')
  log.push('=== Step 3: Creating fresh users ===')

  const createdUsers: { email: string; role: string; status: string }[] = []

  for (const seedUser of SEED_USERS) {
    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email: seedUser.email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: seedUser.full_name, role: seedUser.role },
    })

    if (authErr) {
      log.push(`  ${seedUser.email}: auth creation failed — ${authErr.message}`)
      createdUsers.push({ email: seedUser.email, role: seedUser.role, status: `failed: ${authErr.message}` })
      continue
    }

    const profileData: Record<string, unknown> = {
      auth_id: authData.user.id,
      email: seedUser.email,
      full_name: seedUser.full_name,
      role: seedUser.role,
      phone: seedUser.phone || null,
      is_active: true,
    }

    if (seedUser.role === 'doctor') {
      profileData.specialty = (seedUser as any).specialty || null
      profileData.med_reg_no = (seedUser as any).med_reg_no || null
    }

    const { error: profileErr } = await adminClient
      .from('clinic_users')
      .insert(profileData)

    if (profileErr) {
      await adminClient.auth.admin.deleteUser(authData.user.id)
      log.push(`  ${seedUser.email}: profile creation failed — ${profileErr.message}`)
      createdUsers.push({ email: seedUser.email, role: seedUser.role, status: `profile failed: ${profileErr.message}` })
      continue
    }

    log.push(`  ${seedUser.email} (${seedUser.role}): created successfully`)
    createdUsers.push({ email: seedUser.email, role: seedUser.role, status: 'created' })
  }

  const successCount = createdUsers.filter(u => u.status === 'created').length

  return {
    success: successCount > 0,
    message: successCount === SEED_USERS.length
      ? 'All users created successfully! You can now login.'
      : `${successCount}/${SEED_USERS.length} users created. Check the log for errors.`,
    deletedAuthUsers: deletedAuthCount,
    createdUsers,
    log,
    loginCredentials: {
      password: DEFAULT_PASSWORD,
      loginUrl: '/login',
      note: 'All users share this password. They can also login via email OTP. Use password login method.',
      users: SEED_USERS.map(u => ({ email: u.email, role: u.role, name: u.full_name })),
    },
  }
}

/**
 * GET — Easy browser-based reset.
 *
 * Visit: /api/reset-seed?confirm=yes-delete-everything
 *
 * Without the confirm param, shows diagnostics and instructions.
 */
export async function GET(req: NextRequest) {
  const confirm = req.nextUrl.searchParams.get('confirm')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // ── No confirm param → show diagnostics ────────────────────
  if (confirm !== 'yes-delete-everything') {
    const diagnostics: Record<string, string> = {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl ? '✅ Set' : '❌ Missing',
      SUPABASE_SERVICE_ROLE_KEY: serviceKey ? `✅ Set (starts with ${serviceKey.substring(0, 10)}...)` : '❌ Missing',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing',
    }

    let tableCheck = 'Not tested'
    if (supabaseUrl && serviceKey) {
      try {
        const testClient = createClient(supabaseUrl, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
        const { count, error } = await testClient
          .from('clinic_users')
          .select('id', { count: 'exact', head: true })

        if (error) {
          tableCheck = `❌ Error: ${error.message} (code: ${error.code})`
        } else {
          tableCheck = `✅ Table exists, ${count ?? 0} rows`
        }
      } catch (err: any) {
        tableCheck = `❌ Connection failed: ${err.message}`
      }
    }

    return NextResponse.json({
      endpoint: '/api/reset-seed',
      status: 'Ready — awaiting confirmation',
      howToRun: 'Visit /api/reset-seed?confirm=yes-delete-everything in your browser',
      warning: '⚠️ THIS WILL DELETE ALL DATA IN YOUR DATABASE',
      diagnostics: {
        envVars: diagnostics,
        clinicUsersTable: tableCheck,
      },
      afterReset: {
        password: DEFAULT_PASSWORD,
        loginMethod: 'Use "Sign in with password" option on login page',
        users: SEED_USERS.map(u => ({ email: u.email, role: u.role, name: u.full_name })),
      },
    })
  }

  // ── Run the reset ──────────────────────────────────────────
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      {
        error: 'Server configuration incomplete',
        missing: [
          ...(!supabaseUrl ? ['NEXT_PUBLIC_SUPABASE_URL'] : []),
          ...(!serviceKey ? ['SUPABASE_SERVICE_ROLE_KEY'] : []),
        ],
        fix: 'Add these to your Vercel Environment Variables (Settings → Environment Variables)',
      },
      { status: 500 }
    )
  }

  try {
    const result = await runReset(supabaseUrl, serviceKey)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[reset-seed] Fatal error:', err.message, err.stack)
    return NextResponse.json(
      { error: 'Reset failed', details: err.message },
      { status: 500 }
    )
  }
}

/**
 * POST — Programmatic reset (same logic, requires confirmation header)
 */
export async function POST(req: NextRequest) {
  const confirmHeader = req.headers.get('x-confirm-reset')
  if (confirmHeader !== 'yes-delete-everything') {
    return NextResponse.json(
      {
        error: 'Missing confirmation header',
        hint: 'Add header: X-Confirm-Reset: yes-delete-everything',
      },
      { status: 400 }
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'Server configuration incomplete' },
      { status: 500 }
    )
  }

  try {
    const result = await runReset(supabaseUrl, serviceKey)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[reset-seed] Fatal error:', err.message)
    return NextResponse.json(
      { error: 'Reset failed', details: err.message },
      { status: 500 }
    )
  }
}