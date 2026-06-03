/**
 * src/app/api/audit/route.ts
 *
 * Audit Log API — Server-side insertion with service role key.
 *
 * POST /api/audit — Insert an audit log entry
 * GET  /api/audit — Fetch audit log entries (admin only)
 *
 * This bypasses RLS issues that prevent client-side audit inserts.
 * The client-side audit() function calls this API instead of
 * directly inserting into the audit_log table.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

// ── POST: Insert audit entry ──────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      user_id,
      user_email,
      user_role,
      action,
      entity_type,
      entity_id,
      entity_label,
      changes,
    } = body

    if (!action || !entity_type) {
      return NextResponse.json({ error: 'action and entity_type are required' }, { status: 400 })
    }

    // Try atomic RPC first
    const { error: rpcError } = await supabase.rpc('insert_audit_entry', {
      p_user_id: user_id || null,
      p_user_email: user_email || null,
      p_user_role: user_role || null,
      p_action: action,
      p_entity_type: entity_type,
      p_entity_id: entity_id || null,
      p_entity_label: entity_label || null,
      p_changes: changes ? JSON.stringify(changes) : null,
    })

    if (rpcError) {
      // RPC doesn't exist — fallback to direct insert
      const msg = rpcError.message?.toLowerCase() || ''
      const code = (rpcError as any).code || ''
      const isUnavailable = code === '42883' || msg.includes('does not exist') || msg.includes('function')

      if (isUnavailable) {
        // Direct insert fallback
        const { error: insertError } = await supabase.from('audit_log').insert({
          user_id: user_id || null,
          user_email: user_email || null,
          user_role: user_role || null,
          action,
          entity_type,
          entity_id: entity_id || null,
          entity_label: entity_label || null,
          changes: changes || null,
          entry_hash: `api-${Date.now()}`,
          prev_hash: null,
        })

        if (insertError) {
          console.warn('[Audit API] Direct insert failed:', insertError.message)
          return NextResponse.json({ error: insertError.message }, { status: 500 })
        }
      } else {
        console.warn('[Audit API] RPC failed:', rpcError.message)
        return NextResponse.json({ error: rpcError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[Audit API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── GET: Fetch audit log entries (for admin page) ─────────────
export async function GET(req: NextRequest) {
  // SECURITY FIX: Admin-only access to audit logs (sensitive data)
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth

  try {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10)
    const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10)
    const action = req.nextUrl.searchParams.get('action') || ''
    const entity_type = req.nextUrl.searchParams.get('entity_type') || ''

    let query = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (action) query = query.eq('action', action)
    if (entity_type) query = query.eq('entity_type', entity_type)

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get total count
    let countQuery = supabase
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
    if (action) countQuery = countQuery.eq('action', action)
    if (entity_type) countQuery = countQuery.eq('entity_type', entity_type)
    const { count } = await countQuery

    return NextResponse.json({
      entries: data || [],
      total: count || 0,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
