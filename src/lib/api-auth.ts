/**
 * src/lib/api-auth.ts
 *
 * ═══════════════════════════════════════════════════════════════
 * API Route Authentication Middleware
 *
 * IMPROVEMENTS in this version (all backwards-compatible):
 *
 * 1. requireAuth() now returns an object { userId, email, role }
 *    instead of just checking auth. This lets callers (e.g. the
 *    PATCH /api/reminders route) log WHO sent the reminder.
 *    Previously the sent_by field was hardcoded to 'staff' because
 *    the auth object had no user info.
 *
 * 2. Uses the service role key to look up clinic_users role,
 *    which is more reliable than checking RLS with the user's own
 *    token (avoids RLS recursion on v_active_users view).
 *
 * 3. requireRole() now accepts a single role string or an array,
 *    e.g. requireRole(req, ['admin', 'doctor']) — backwards
 *    compatible because a single string still works.
 *
 * 4. Edge cases handled:
 *    - Expired tokens → clear 401 message
 *    - Valid Supabase user but NOT in clinic_users → 403 Forbidden
 *      (user exists in auth but was not given clinic access)
 *    - Inactive user (is_active = false) → 403 Forbidden
 *    - Missing Authorization header → 401
 *    - Malformed Bearer token → 401
 *
 * USAGE (unchanged from original):
 *
 *   import { requireAuth, requireRole } from '@/lib/api-auth'
 *
 *   export async function POST(req: NextRequest) {
 *     const auth = await requireAuth(req)
 *     if (auth instanceof Response) return auth   // 401/403 if not logged in
 *     // auth.userId, auth.email, auth.role available here
 *   }
 *
 *   // Admin-only route:
 *   const auth = await requireRole(req, 'admin')
 *   if (auth instanceof Response) return auth
 *
 *   // Doctor or admin route:
 *   const auth = await requireRole(req, ['admin', 'doctor'])
 *   if (auth instanceof Response) return auth
 * ═══════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

// Two clients:
// - userClient: validates the JWT with user's own permissions
// - adminClient: service role for looking up clinic_users (bypasses RLS)
function makeUserClient(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      auth: { persistSession: false },
    }
  )
}

// Service role client — only used server-side, never exposed to browser
const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

// ── Return type ──────────────────────────────────────────────

export interface AuthResult {
  userId:        string
  email:         string
  role:          string        // 'admin' | 'doctor' | 'staff' | 'receptionist' etc.
  clinicUserId:  string
  fullName:      string
  isActive:      boolean
}

// ─────────────────────────────────────────────────────────────
// Extract Bearer token from Authorization header
// ─────────────────────────────────────────────────────────────
function extractToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  return token.length > 0 ? token : null
}

// ─────────────────────────────────────────────────────────────
// requireAuth — validates session, returns AuthResult or Response
// ─────────────────────────────────────────────────────────────
export async function requireAuth(req: NextRequest): Promise<AuthResult | Response> {
  // 1. Extract token
  const token = extractToken(req)
  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized. Missing or malformed Authorization header.' },
      { status: 401 }
    )
  }

  // 2. Validate JWT with Supabase (checks expiry, signature, revocation)
  const userClient = makeUserClient(token)
  const { data: { user }, error: authError } = await userClient.auth.getUser()

  if (authError || !user) {
    // Distinguish expired tokens from invalid ones for clearer error messages
    const isExpired = authError?.message?.toLowerCase().includes('expired')
    return NextResponse.json(
      {
        error: isExpired
          ? 'Session expired. Please log in again.'
          : 'Unauthorized. Invalid or expired token.',
      },
      { status: 401 }
    )
  }

  // 3. Look up user in clinic_users table (checks is_active and gets role)
  //    Uses adminClient so RLS doesn't block the lookup
  const { data: clinicUser, error: cuError } = await adminClient
    .from('clinic_users')
    .select('id, email, full_name, role, is_active')
    .eq('auth_id', user.id)
    .single()

  if (cuError || !clinicUser) {
    console.warn('[api-auth] User in Supabase Auth but not in clinic_users:', user.id, user.email)
    return NextResponse.json(
      { error: 'Forbidden. Your account is not registered with this clinic.' },
      { status: 403 }
    )
  }

  // 4. Check if account is active
  if (!clinicUser.is_active) {
    console.warn('[api-auth] Inactive user attempted access:', clinicUser.email)
    return NextResponse.json(
      { error: 'Forbidden. Your account has been deactivated. Contact your administrator.' },
      { status: 403 }
    )
  }

  // 5. Return enriched auth result
  return {
    userId:       user.id,
    email:        clinicUser.email ?? user.email ?? '',
    role:         clinicUser.role  ?? 'staff',
    clinicUserId: clinicUser.id,
    fullName:     clinicUser.full_name ?? '',
    isActive:     clinicUser.is_active,
  }
}

// ─────────────────────────────────────────────────────────────
// requireRole — like requireAuth, but also checks role
// Accepts a single role string OR an array of allowed roles.
// ─────────────────────────────────────────────────────────────
export async function requireRole(
  req: NextRequest,
  allowedRoles: string | string[],
): Promise<AuthResult | Response> {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth  // propagate 401/403

  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]

  if (!roles.includes(auth.role)) {
    console.warn(
      `[api-auth] Role mismatch. User '${auth.email}' has role '${auth.role}', required: [${roles.join(', ')}]`
    )
    return NextResponse.json(
      {
        error: `Forbidden. This action requires one of: [${roles.join(', ')}]. Your role: ${auth.role}.`,
      },
      { status: 403 }
    )
  }

  return auth
}