/**
 * src/app/api/notifications/route.ts
 *
 * In-App Notification Center API
 *
 * GET  /api/notifications          — Fetch unread + recent notifications for the logged-in user
 * POST /api/notifications          — Create a new notification (system/internal use)
 * PATCH /api/notifications         — Mark notification(s) as read
 *
 * Notifications are role-targeted: a lab report upload creates a notification
 * visible to staff + doctor roles. Insurance updates go to admin + staff.
 *
 * This solves the "how will staff know when lab partner uploads report?" problem.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * BUG FIX C1: Added authentication to all endpoints (was completely open before)
 * BUG FIX C2: Replaced top-level createClient with lazy getSupabaseAdmin()
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET: Fetch notifications ──────────────────────────────────
export async function GET(req: NextRequest) {
  // BUG FIX C1: Require authentication — only logged-in clinic users can read notifications
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  try {
    const supabase = getSupabaseAdmin()

    // BUG FIX C1: Use the authenticated user's role instead of trusting query param
    const role = auth.role || 'staff'
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '30', 10)
    const unreadOnly = req.nextUrl.searchParams.get('unread') === 'true'

    let query = supabase
      .from('clinic_notifications')
      .select('*')
      .contains('target_roles', [role])
      .order('created_at', { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.eq('is_read', false)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Also get unread count
    const { count: unreadCount } = await supabase
      .from('clinic_notifications')
      .select('id', { count: 'exact', head: true })
      .contains('target_roles', [role])
      .eq('is_read', false)

    return NextResponse.json({
      notifications: data || [],
      unread_count: unreadCount || 0,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST: Create notification ─────────────────────────────────
export async function POST(req: NextRequest) {
  // BUG FIX C1: Require authentication — only logged-in clinic users can create notifications
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  try {
    const supabase = getSupabaseAdmin()

    const body = await req.json()
    const {
      title,
      message,
      type = 'info',
      severity = 'normal',
      source,
      entity_type,
      entity_id,
      patient_id,
      patient_name,
      mrn,
      target_roles = ['admin', 'doctor', 'staff'],
      metadata,
    } = body

    if (!title || !message) {
      return NextResponse.json({ error: 'title and message are required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('clinic_notifications')
      .insert({
        title,
        message,
        type,
        severity,
        source,
        entity_type,
        entity_id,
        patient_id: patient_id || null,
        patient_name: patient_name || null,
        mrn: mrn || null,
        target_roles,
        metadata: metadata ? JSON.stringify(metadata) : null,
        
      })
      .select('id')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id: data.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── PATCH: Mark notifications as read ─────────────────────────
export async function PATCH(req: NextRequest) {
  // BUG FIX C1: Require authentication — only logged-in clinic users can mark as read
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  try {
    const supabase = getSupabaseAdmin()

    const body = await req.json()
    const { ids, mark_all } = body

    if (mark_all) {
      // BUG FIX C1: Use authenticated user's role, not client-supplied role
      const role = auth.role
      // Mark all unread for this role as read
      const { error } = await supabase
        .from('clinic_notifications')
        .update({
          is_read: true,
          
          
        })
        .contains('target_roles', [role])
        .eq('is_read', false)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, message: 'All notifications marked as read' })
    }

    if (ids && Array.isArray(ids) && ids.length > 0) {
      const { error } = await supabase
        .from('clinic_notifications')
        .update({
          is_read: true,
          
          
        })
        .in('id', ids)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, marked: ids.length })
    }

    return NextResponse.json({ error: 'Provide ids[] or mark_all=true' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}