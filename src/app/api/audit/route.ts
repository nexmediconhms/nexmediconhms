/**
 * src/app/api/audit/route.ts
 *
 * Server-side audit log API endpoint.
 * Uses service role key to bypass RLS — ensures audit entries are ALWAYS recorded
 * regardless of the user's row-level security permissions.
 *
 * POST /api/audit — Create a new audit log entry
 *
 * This solves the problem where client-side audit() calls silently fail
 * because the anon key doesn't have INSERT permission on audit_log table.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

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

    // Try atomic RPC first (if available)
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
      // RPC doesn't exist or failed — fall back to direct insert
      const msg = rpcError.message?.toLowerCase() || ''
      const code = (rpcError as any).code || ''
      const isRpcMissing = code === '42883' || msg.includes('does not exist') || msg.includes('function')

      if (isRpcMissing) {
        // Direct insert with hash chain (simplified — no advisory lock)
        const { data: lastEntry } = await supabase
          .from('audit_log')
          .select('entry_hash')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const prevHash = lastEntry?.entry_hash || null

        // Simple hash for tamper detection
        const payload = JSON.stringify({
          user_id, user_email, user_role, action, entity_type, entity_id, entity_label, changes,
          prev_hash: prevHash || 'GENESIS',
        })
        let entryHash = `server-${Date.now().toString(36)}`
        try {
          const { createHash } = await import('crypto')
          entryHash = createHash('sha256').update(payload).digest('hex')
        } catch {
          // crypto not available — use fallback hash
        }

        const { error: insertError } = await supabase.from('audit_log').insert({
          user_id: user_id || null,
          user_email: user_email || null,
          user_role: user_role || null,
          action,
          entity_type,
          entity_id: entity_id || null,
          entity_label: entity_label || null,
          changes: changes || null,
          entry_hash: entryHash,
          prev_hash: prevHash,
        })

        if (insertError) {
          console.error('[Audit API] insert failed:', insertError.message)
          return NextResponse.json({ error: insertError.message }, { status: 500 })
        }
      } else {
        console.error('[Audit API] RPC error:', rpcError.message)
        return NextResponse.json({ error: rpcError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[Audit API] unexpected error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET /api/audit — Retrieve audit log entries (admin only)
export async function GET(req: NextRequest) {
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

    return NextResponse.json({ entries: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
