/**
 * src/lib/api-auth.ts
 *
 * F. API Route Auth Middleware
 *
 * Validates the Supabase JWT on every protected API route and
 * checks the caller's role in clinic_users.
 *
 * Usage in any API route:
 *
 *   import { requireAuth, requireRole } from '@/lib/api-auth'
 *
 *   // Allow any authenticated user:
 *   export async function POST(req: NextRequest) {
 *     const auth = await requireAuth(req)
 *     if (auth instanceof Response) return auth   // 401 / 403
 *     const { user, clinicUser } = auth
 *     // ... rest of handler
 *   }
 *
 *   // Restrict to admin only:
 *   export async function DELETE(req: NextRequest) {
 *     const auth = await requireRole(req, 'admin')
 *     if (auth instanceof Response) return auth
 *     // ... admin-only logic
 *   }
 *
 *   // Allow doctor or admin:
 *   export async function PUT(req: NextRequest) {
 *     const auth = await requireRole(req, ['admin', 'doctor'])
 *     if (auth instanceof Response) return auth
 *     // ...
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!

/** Build a server-side Supabase client that validates the caller's JWT. */
function serverClient(accessToken: string) {
  return createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth:   { persistSession: false },
  })
}

export type ClinicRole = 'admin' | 'doctor' | 'staff'

export interface AuthResult {
  user:       { id: string; email: string }
  clinicUser: { id: string; role: ClinicRole; full_name: string }
  token:      string
}

/**
 * Extract the Bearer token from the Authorization header.
 * Returns null if missing or malformed.
 */
function extractToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || ''
  const [scheme, token] = header.split(' ')
  return scheme === 'Bearer' && token ? token : null
}

/** Unauthenticated response */
const unauthorized = (msg = 'Unauthorized') =>
  NextResponse.json({ error: msg }, { status: 401 })

/** Forbidden response */
const forbidden = (msg = 'Forbidden — insufficient role') =>
  NextResponse.json({ error: msg }, { status: 403 })

/**
 * Validate the request JWT and return the authenticated user + clinic profile.
 * Returns a 401 Response if the token is missing/invalid.
 */
export async function requireAuth(req: NextRequest): Promise<AuthResult | Response> {
  const token = extractToken(req)
  if (!token) return unauthorized('Missing Authorization header')

  // Use service-role client so we can look up clinic_users regardless of RLS
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Validate JWT
  const { data: { user }, error: authError } = await admin.auth.getUser(token)
  if (authError || !user) return unauthorized('Invalid or expired token')

  // Look up clinic profile
  const { data: clinicUser, error: cuError } = await admin
    .from('clinic_users')
    .select('id, role, full_name, is_active')
    .eq('auth_id', user.id)
    .single()

  if (cuError || !clinicUser) return forbidden('No clinic profile found. Contact your admin.')
  if (!clinicUser.is_active)  return forbidden('Account is deactivated.')

  return {
    user:       { id: user.id, email: user.email ?? '' },
    clinicUser: { id: clinicUser.id, role: clinicUser.role as ClinicRole, full_name: clinicUser.full_name },
    token,
  }
}

/**
 * Like requireAuth, but also enforces that the caller has one of the allowed roles.
 *
 * @param req     - Incoming NextRequest
 * @param roles   - A single role string or an array of allowed roles
 */
export async function requireRole(
  req:   NextRequest,
  roles: ClinicRole | ClinicRole[],
): Promise<AuthResult | Response> {
  const result = await requireAuth(req)
  if (result instanceof Response) return result

  const allowed = Array.isArray(roles) ? roles : [roles]
  if (!allowed.includes(result.clinicUser.role)) {
    return forbidden(
      `This action requires one of: [${allowed.join(', ')}]. Your role is: ${result.clinicUser.role}`
    )
  }

  return result
}

/**
 * Lightweight check: does the request have a valid auth token?
 * Does NOT look up clinic_users — use for public-ish routes that
 * only need Supabase auth without role enforcement.
 */
export async function isAuthenticated(req: NextRequest): Promise<boolean> {
  const token = extractToken(req)
  if (!token) return false
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: { user } } = await admin.auth.getUser(token)
  return !!user
}
