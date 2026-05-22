/**
 * src/app/api/billing/payment-failure/route.ts
 *
 * Payment Failure Handling
 *
 * Allows staff to:
 * 1. Mark a payment as failed (UPI timeout, wrong amount, network drop)
 * 2. Record the failure reason for audit trail
 * 3. Revert bill status back to 'unpaid' or 'partial'
 *
 * POST /api/billing/payment-failure
 * Body: { bill_id, payment_id?, reason, action: 'mark_failed' | 'manual_reject' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const { bill_id, payment_id, reason, action } = body

    if (!bill_id) {
      return NextResponse.json({ error: 'bill_id is required' }, { status: 400 })
    }
    if (!reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 })
    }
    if (!action || !['mark_failed', 'manual_reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be mark_failed or manual_reject' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    // Get current bill
    const { data: bill, error: billErr } = await supabase
      .from('bills')
      .select('id, total, paid, due, status, patient_name, mrn')
      .eq('id', bill_id)
      .single()

    if (billErr || !bill) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    // If a specific payment is being marked as failed
    if (payment_id) {
      const { data: payment, error: payErr } = await supabase
        .from('bill_payments')
        .select('id, amount, status')
        .eq('id', payment_id)
        .single()

      if (payErr || !payment) {
        return NextResponse.json({ error: 'Payment record not found' }, { status: 404 })
      }

      // Mark payment as failed
      await supabase
        .from('bill_payments')
        .update({
          status: 'failed',
          failure_reason: reason,
          marked_failed_by: auth.email,
          marked_failed_at: now,
        })
        .eq('id', payment_id)

      // Recalculate bill paid/due amounts (subtract the failed payment)
      const newPaid = Math.max(0, (bill.paid || 0) - (payment.amount || 0))
      const newDue = (bill.total || 0) - newPaid
      const newStatus = newPaid <= 0 ? 'unpaid' : newPaid < (bill.total || 0) ? 'partial' : 'paid'

      await supabase
        .from('bills')
        .update({
          paid: newPaid,
          due: newDue,
          status: newStatus,
          payment_failure_reason: reason,
          payment_failed_at: now,
          modified_by: auth.email,
          modification_reason: `Payment #${payment_id} marked failed: ${reason}`,
        })
        .eq('id', bill_id)
    } else {
      // Mark the entire bill payment attempt as failed
      await supabase
        .from('bills')
        .update({
          status: bill.paid > 0 ? 'partial' : 'unpaid',
          payment_failure_reason: reason,
          payment_failed_at: now,
          payment_retry_count: (bill as any).payment_retry_count ? (bill as any).payment_retry_count + 1 : 1,
          modified_by: auth.email,
          modification_reason: `${action === 'manual_reject' ? 'Manually rejected' : 'Payment failed'}: ${reason}`,
        })
        .eq('id', bill_id)
    }

    // Audit log
    await supabase.from('audit_log').insert({
      action: action === 'manual_reject' ? 'payment_manually_rejected' : 'payment_marked_failed',
      entity_type: 'bill',
      entity_id: bill_id,
      entity_label: `${bill.patient_name} (${bill.mrn})`,
      changes: JSON.stringify({ reason, payment_id, action }),
      user_id: auth.userId,
      user_email: auth.email,
      user_role: auth.role,
    })

    return NextResponse.json({
      success: true,
      message: `Payment ${action === 'manual_reject' ? 'rejected' : 'marked as failed'} successfully.`,
    })
  } catch (err: any) {
    console.error('[payment-failure] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
