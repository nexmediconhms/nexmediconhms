/**
 * src/app/api/billing/procedure-templates/route.ts
 *
 * Billing Templates API — Reusable charge templates for procedures/packages.
 *
 * GET /api/billing/procedure-templates
 *   List all active templates. ?category=procedure&module=OPD for filtering.
 *
 * POST /api/billing/procedure-templates
 *   Create a new template.
 *   Body: {
 *     name: string, category: string, description?: string,
 *     items: { label: string, amount: number, category?: string }[],
 *     gst_percent?: number, module?: string
 *   }
 *
 * PUT /api/billing/procedure-templates
 *   Update an existing template.
 *   Body: { id: string, ...same fields as POST }
 *
 * DELETE /api/billing/procedure-templates?id=xxx
 *   Soft-delete a template.
 *
 * ADDITIVE — new route. Uses billing_templates table from migration 031.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const category = req.nextUrl.searchParams.get('category')
  const module = req.nextUrl.searchParams.get('module')

  const sb = getSupabaseAdmin()
  let query = sb
    .from('billing_templates')
    .select('*')
    .eq('is_active', true)
    .eq('is_deleted', false)
    .order('category')
    .order('name')

  if (category) query = query.eq('category', category)
  if (module) query = query.eq('module', module)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({
      error: 'Failed to load templates: ' + error.message,
      hint: 'Ensure billing_templates table exists. Run migration 031.',
    }, { status: 500 })
  }

  // Group by category
  const grouped: Record<string, any[]> = {}
  for (const t of (data || [])) {
    const cat = t.category || 'other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(t)
  }

  return NextResponse.json({
    templates: data || [],
    grouped,
    count: (data || []).length,
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, category, description, items, gst_percent, module } = body ?? {}

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return NextResponse.json({ error: 'name is required (min 2 chars)' }, { status: 400 })
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array is required (at least one item)' }, { status: 400 })
  }

  const total = items.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0)

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('billing_templates')
    .insert({
      name: name.trim(),
      category: category || 'procedure',
      description: description || null,
      items,
      total,
      gst_percent: Number(gst_percent) || 0,
      module: module || 'OPD',
      is_active: true,
      created_by: auth.fullName || auth.email || 'admin',
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to create template: ' + error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, template: data })
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { id, name, category, description, items, gst_percent, module, is_active } = body ?? {}

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const update: Record<string, any> = { updated_at: new Date().toISOString() }

  if (name !== undefined) update.name = name.trim()
  if (category !== undefined) update.category = category
  if (description !== undefined) update.description = description
  if (items !== undefined) {
    update.items = items
    update.total = items.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0)
  }
  if (gst_percent !== undefined) update.gst_percent = Number(gst_percent) || 0
  if (module !== undefined) update.module = module
  if (is_active !== undefined) update.is_active = is_active

  const { data, error } = await sb
    .from('billing_templates')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to update: ' + error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, template: data })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const sb = getSupabaseAdmin()
  await sb.from('billing_templates').update({ is_deleted: true, is_active: false }).eq('id', id)

  return NextResponse.json({ ok: true, deleted: id })
}