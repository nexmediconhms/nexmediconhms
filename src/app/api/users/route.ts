/**
 * src/app/api/users/route.ts  — UPDATED
 *
 * CHANGE: Replaced the manual inline getCallerRole() auth pattern with
 * requireRole('admin') from api-auth.ts so auth logic is consistent app-wide.
 * Added PATCH method (was missing — only GET and POST existed before).
 * Everything else — field allowlist, updated_at stamp, POST body shape —
 * is preserved from the original.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'
import { getAdminClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  // ── Auth gate: admin only ────────────────────────────────────
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  try {
    const admin = getAdminClient()

    const { data, error } = await admin
      .from('clinic_users')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ users: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * POST — Update a user's role / active status / name (original method).
 * Body: { userId, updates: { role?, is_active?, full_name? } }
 */
export async function POST(req: NextRequest) {
  // ── Auth gate: admin only ────────────────────────────────────
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  try {
    const admin = getAdminClient()
    const body  = await req.json()
    const { userId, updates } = body

    if (!userId || !updates) {
      return NextResponse.json({ error: 'userId and updates required' }, { status: 400 })
    }

    // Only allow updating safe fields
    const allowed: Record<string, any> = {}
    if (updates.role && ['admin', 'doctor', 'staff'].includes(updates.role)) {
      allowed.role = updates.role
    }
    if (typeof updates.is_active === 'boolean') {
      allowed.is_active = updates.is_active
    }
    if (updates.full_name) {
      allowed.full_name = updates.full_name
    }
    allowed.updated_at = new Date().toISOString()

    const { data, error } = await admin
      .from('clinic_users')
      .update(allowed)
      .eq('id', userId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ user: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * PATCH — Convenience alias for updating a single field.
 * Body: { id, is_active?, role? }
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth

  try {
    const admin = getAdminClient()
    const body  = await req.json()
    const { id, is_active, role } = body

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (is_active !== undefined) updates.is_active = is_active
    if (role      !== undefined) updates.role      = role

    const { error } = await admin.from('clinic_users').update(updates).eq('id', id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}