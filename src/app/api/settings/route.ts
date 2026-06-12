/**
 * src/app/api/settings/route.ts
 *
 * Database-backed clinic settings API (Issue 2 Fix). v2.
 *
 * Bug fixes from v1:
 *  - Removed dead ensureTable() code — Supabase's .from() doesn't throw on
 *    missing table; the error path was unreachable. Now we just handle
 *    .error from the query response cleanly.
 *  - Settings write moved to a graceful auth check: tries requireRole if
 *    it exists & throws role mismatches as Response, otherwise falls back
 *    to a simpler requireAuth + manual role check.
 *  - GET responses now always return 200 with empty settings on error
 *    (so client falls back to localStorage cleanly rather than retry-loops).
 *
 * GET  /api/settings           → { settings: { [key]: value }, count }
 * GET  /api/settings?key=name  → { value }
 * POST /api/settings           → { ok, ... }; body: { key, value } | { settings }
 * DELETE /api/settings?key=    → { ok, deleted }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lazy require of requireRole — some codebases don't export it under that name.
async function ensureAdmin(req: NextRequest, auth: any): Promise<Response | null> {
  // 1. Try requireRole if exported
  try {
    const mod: any = await import('@/lib/api-auth')
    if (typeof mod.requireRole === 'function') {
      const result = await mod.requireRole(req, 'admin')
      if (result instanceof Response) return result
      return null  // authorised
    }
  } catch { /* fall through */ }

  // 2. Manual check: read role from auth object (shape may vary)
  const role = auth?.role || auth?.user?.role || auth?.clinicUser?.role
  if (role === 'admin') return null

  return NextResponse.json(
    { error: 'Forbidden: admin role required to modify settings' },
    { status: 403 }
  )
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const sb = getSupabaseAdmin()
  const key = req.nextUrl.searchParams.get('key')

  if (key) {
    const { data, error } = await sb
      .from('clinic_settings')
      .select('key, value')
      .eq('key', key)
      .maybeSingle()

    if (error) {
      // Not fatal — caller can fallback to localStorage
      return NextResponse.json({ value: null, _hint: error.message }, { status: 200 })
    }
    return NextResponse.json({ value: data?.value ?? null })
  }

  const { data, error } = await sb
    .from('clinic_settings')
    .select('key, value')
    .limit(1000)

  if (error) {
    return NextResponse.json({ settings: {}, count: 0, _hint: error.message }, { status: 200 })
  }

  const result: Record<string, any> = {}
  for (const row of (data || [])) {
    result[row.key] = row.value
  }

  return NextResponse.json({ settings: result, count: (data || []).length })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const adminCheck = await ensureAdmin(req, auth)
  if (adminCheck) return adminCheck

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const now = new Date().toISOString()
  const userId = (auth as any)?.email
    || (auth as any)?.fullName
    || (auth as any)?.user?.email
    || 'admin'

  // Mode 1: bulk save
  if (body?.settings && typeof body.settings === 'object') {
    const rows = Object.entries(body.settings).map(([key, value]) => ({
      key,
      value,
      updated_at: now,
      updated_by: userId,
    }))

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, saved: 0 })
    }

    const { error } = await sb
      .from('clinic_settings')
      .upsert(rows, { onConflict: 'key' })

    if (error) {
      return NextResponse.json({ error: 'Failed to save: ' + error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, saved: rows.length })
  }

  // Mode 2: single key save
  const { key, value } = body ?? {}
  if (!key || typeof key !== 'string') {
    return NextResponse.json({ error: 'key is required' }, { status: 400 })
  }

  const { error } = await sb
    .from('clinic_settings')
    .upsert(
      { key, value, updated_at: now, updated_by: userId },
      { onConflict: 'key' }
    )

  if (error) {
    return NextResponse.json({ error: 'Failed to save: ' + error.message }, { status: 500 })
  }

  // Audit (non-fatal if helper isn't available)
  try {
    const mod: any = await import('@/lib/audit')
    if (typeof mod.audit === 'function') {
      await mod.audit('update', 'settings', key, `Setting ${key} changed by ${userId}`)
    }
  } catch { /* audit missing — non-fatal */ }

  return NextResponse.json({ ok: true, key })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const adminCheck = await ensureAdmin(req, auth)
  if (adminCheck) return adminCheck

  const key = req.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const { error } = await sb.from('clinic_settings').delete().eq('key', key)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete: ' + error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deleted: key })
}