/**
 * src/app/api/billing/mark-failed/route.ts
 *
 * Manual payment failure marking endpoint.
 *
 * FIX: UPI payment failure handling.
 * When a UPI payment times out, network drops, or wrong amount is entered,
 * admin/staff can now manually mark the payment as failed instead of
 * leaving the bill stuck in "pending" forever.
 *
 * Also handles:
 *   - "Mark as Cancelled" for disputed bills
 *   - Audit trail (who rejected, when, why)
 *   - Payment attempt tracking
 *
 * Usage:
 *   POST /api/billing/mark-failed
 *   Body: { bill_id: "uuid", reason: "Patient UPI timeout", action: "failed" | "cancelled" }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

interface MarkFailedBody {
  bill_id: string
  reason: string
  action: 'failed' | 'cancelled' | 'refunded'
}

export async function POST(req: NextRequest) {
  // ── Authentication — admin or staff only ──────────────────
  const auth = await requireRole(req, ['admin', 'staff'])
  if (auth instanceof Response) return auth

  // ── Parse body ────────────────────────────────────────────
  let body: MarkFailedBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { bill_id, reason, action } = body

  if (!bill_id) {
    return NextResponse.json({ error: 'bill_id is required' }, { status: 400 })
  }
  if (!reason || reason.trim().length < 3) {
    return NextResponse.json({ error: 'reason is required (min 3 characters)' }, { status: 400 })
  }
  if (!['failed', 'cancelled', 'refunded'].includes(action)) {
    return NextResponse.json({ error: 'action must be: failed, cancelled, or refunded' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // ── Verify bill exists and is in a valid state ────────────
  const { data: bill, error: fetchError } = await supabase
    .from('bills')
    .select('id, status, patientid, net_amount, razorpay_payment_id')
    .eq('id', bill_id)
    .single()

  if (fetchError || !bill) {
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  }

  // Only allow marking as failed if bill is currently pending or partially paid
  const allowedStatuses = ['pending', 'sent', 'partially_paid']
  if (!allowedStatuses.includes(bill.status)) {
    return NextResponse.json(
      { error: `Cannot mark bill as ${action}. Current status: ${bill.status}. Only pending/sent bills can be marked as failed.` },
      { status: 409 }
    )
  }

  // ── Update bill status ────────────────────────────────────
  const newStatus = action === 'failed' ? 'failed' : action === 'cancelled' ? 'cancelled' : 'refunded'

  const { error: updateError } = await supabase
    .from('bills')
    .update({
      status: newStatus,
      modified_by: auth.clinicUserId,
      modified_at: new Date().toISOString(),
      modification_reason: reason.trim(),
    })
    .eq('id', bill_id)

  if (updateError) {
    console.error('[billing/mark-failed] Update error:', updateError.message)
    return NextResponse.json({ error: 'Failed to update bill status' }, { status: 500 })
  }

  // ── Record payment attempt (for tracking history) ─────────
  try {
    await supabase.from('payment_attempts').insert({
      bill_id,
      patient_id: bill.patientid,
      amount: bill.net_amount,
      status: newStatus,
      failure_reason: reason.trim(),
      marked_by: auth.clinicUserId,
      marked_by_name: auth.fullName,
      payment_method: 'manual_mark',
      razorpay_payment_id: bill.razorpay_payment_id || null,
    })
  } catch (e) {
    // Non-fatal - bill status already updated
    console.warn('[billing/mark-failed] Failed to record payment attempt:', e)
  }

  // ── Audit log entry ───────────────────────────────────────
  try {
    await supabase.rpc('insert_audit_entry', {
      p_user_id: auth.userId,
      p_user_email: auth.email,
      p_user_role: auth.role,
      p_action: `bill_marked_${newStatus}`,
      p_entity_type: 'bill',
      p_entity_id: bill_id,
      p_entity_label: `Bill #${bill_id.slice(0, 8)}`,
      p_changes: JSON.stringify({
        previous_status: bill.status,
        new_status: newStatus,
        reason: reason.trim(),
        amount: bill.net_amount,
      }),
    })
  } catch (e) {
    // Non-fatal
    console.warn('[billing/mark-failed] Audit log failed:', e)
  }

  return NextResponse.json({
    ok: true,
    bill_id,
    previous_status: bill.status,
    new_status: newStatus,
    marked_by: auth.fullName,
    reason: reason.trim(),
  })
}
