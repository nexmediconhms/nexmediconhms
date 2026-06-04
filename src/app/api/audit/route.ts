/**
 * src/app/api/audit/route.ts
 *
 * Audit Log API — server-side hash-chain insertion.
 *
 * POST /api/audit — Insert an audit log entry
 * GET  /api/audit — Fetch audit log entries (admin only)
 *
 * 2026-06-04 audit fixes (§7.1, §7.2):
 *
 *   §7.1  POST is now AUTHENTICATED. Identity (user_id, user_email,
 *         user_role) is derived from the session-validated clinic_users
 *         row — the client-supplied values are IGNORED. The previous
 *         endpoint accepted unsigned identity claims, allowing anyone
 *         on the internet to forge audit entries attributing actions
 *         to any user. Non-repudiation is now intact.
 *
 *   §7.2  No more fake "api-" + Date.now() hashes on direct inserts.
 *         The RPC `insert_audit_entry` (defined in
 *         migrations/fresh-install/02_audit_chain.sql) is the canonical
 *         writer. If it's somehow not installed, we DO NOT silently
 *         insert a row with a bogus hash — we now return 503 so the
 *         caller knows the audit subsystem isn't ready, and the missing
 *         migration gets noticed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireRole } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

// ── POST: Insert audit entry ──────────────────────────────────
export async function POST(req: NextRequest) {
  // 2026-06-04 audit fix (§7.1): authenticate the caller. Identity in
  // the audit row is derived from the session, NOT from the request body.
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const {
      // 2026-06-04 audit fix (§7.1): we INTENTIONALLY ignore the
      // user_id/user_email/user_role fields from the client body.
      // They are kept in the destructure only to make it explicit
      // that they are received-and-discarded for back-compat with
      // any client that still sends them.
      user_id: _ignoredUserId,
      user_email: _ignoredUserEmail,
      user_role: _ignoredUserRole,
      action,
      entity_type,
      entity_id,
      entity_label,
      changes,
    } = body
    // Touch the discarded variables so eslint/no-unused-vars doesn't
    // complain in some configurations:
    void _ignoredUserId; void _ignoredUserEmail; void _ignoredUserRole;

    if (!action || !entity_type) {
      return NextResponse.json({ error: 'action and entity_type are required' }, { status: 400 })
    }

    // §7.2: try the canonical RPC. It's atomic and computes the SHA-256
    // hash chain via an advisory lock — content-bound, tamper-evident.
    const { error: rpcError } = await supabase.rpc('insert_audit_entry', {
      p_user_id:      auth.clinicUserId,        // ← from session, not body
      p_user_email:   auth.email,               // ← from session, not body
      p_user_role:    auth.role,                // ← from session, not body
      p_action:       action,
      p_entity_type:  entity_type,
      p_entity_id:    entity_id || null,
      p_entity_label: entity_label || null,
      p_changes:      changes ? JSON.stringify(changes) : null,
    })

    if (rpcError) {
      // 2026-06-04 audit fix (§7.2): do NOT silently fall back to a
      // direct INSERT with a fake `api-${Date.now()}` hash. That would
      // silently corrupt the chain in any deployment whose RPC isn't
      // installed. Instead we surface a 503 so the operator notices
      // and runs the missing migration (fresh-install/02_audit_chain.sql).
      const msg = rpcError.message?.toLowerCase() || ''
      const code = (rpcError as any).code || ''
      const isRpcMissing =
        code === '42883' || msg.includes('does not exist') || msg.includes('not found')

      if (isRpcMissing) {
        console.error(
          '[Audit API] insert_audit_entry RPC is not installed. ' +
          'Run migrations/fresh-install/02_audit_chain.sql or the ' +
          'critical-security-fixes.patch SQL on this database.',
        )
        return NextResponse.json(
          {
            error:
              'Audit subsystem not initialised. Database is missing the ' +
              'insert_audit_entry RPC. Apply migrations/fresh-install/02_audit_chain.sql.',
            code: 'AUDIT_RPC_MISSING',
          },
          { status: 503 },
        )
      }

      console.warn('[Audit API] RPC failed:', rpcError.message)
      return NextResponse.json({ error: rpcError.message }, { status: 500 })
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