/**
 * src/app/api/billing/discount-authorization/route.ts
 *
 * Discount Authorization & Approval API
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS:
 *   In Indian clinics, discounts are given daily — for regular patients,
 *   staff relatives, financial hardship, package deals, etc. Without
 *   authorization controls:
 *     - Reception gives arbitrary discounts (revenue leakage)
 *     - No audit trail for who approved what
 *     - Doctors don't know what discounts staff gave
 *     - No caps per role (receptionist shouldn't give 50% off)
 *
 *   This route enforces:
 *     1. Role-based discount limits (staff ≤10%, doctor ≤25%, admin ≤100%)
 *     2. Mandatory reason for every discount
 *     3. Approval workflow for discounts exceeding the user's limit
 *     4. Full audit trail
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ENDPOINTS:
 *
 *   POST /api/billing/discount-authorization
 *     Apply or request approval for a discount on a bill.
 *     Body: {
 *       bill_id:          string   (UUID — required)
 *       discount_amount:  number   (₹ amount — required; OR use discount_percent)
 *       discount_percent: number   (% of bill total — alternative to discount_amount)
 *       reason:           string   (required, min 3 chars)
 *       category:         string   (regular_patient | staff_relative | financial_hardship |
 *                                   senior_citizen | package_deal | festival | other)
 *     }
 *
 *   GET /api/billing/discount-authorization?billId=xxx
 *     Get discount history for a bill.
 *
 *   GET /api/billing/discount-authorization?pending=true
 *     List all pending discount approval requests (admin/doctor view).
 *
 *   PUT /api/billing/discount-authorization
 *     Approve or reject a pending discount request.
 *     Body: {
 *       request_id:  string   (UUID of the discount request)
 *       action:      'approve' | 'reject'
 *       notes:       string   (optional)
 *     }
 *
 * Auth: All authenticated users can request. Approve = admin/doctor only.
 *
 * ─── ADDITIVE ────────────────────────────────────────────────────────
 * New route. Does not modify any existing billing routes.
 * Existing bill creation/editing continues to work unchanged.
 * This adds an authorization layer ON TOP of existing discount fields.
 *
 * STORAGE: Uses the existing bills table columns (discount, discount_reason,
 * discount_approved_by) added by migration 030. For pending requests,
 * uses a lightweight in-bill approach (no extra table needed).
 * ─────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Role-based discount limits ───────────────────────────────────────
// These define the MAX discount % each role can auto-approve.
// Discounts above this limit require approval from a higher role.
//
// Customize these for your clinic — these are sensible defaults for
// a mid-size Indian gynaecology practice.

const DISCOUNT_LIMITS: Record<string, number> = {
  staff:       10,   // Reception/staff: up to 10% auto-approved
  nurse:       10,   // Nurses: up to 10%
  doctor:      25,   // Doctors: up to 25%
  admin:       100,  // Admin: unlimited (up to 100%)
  superadmin:  100,  // Superadmin: unlimited
}

const VALID_CATEGORIES = [
  'regular_patient',
  'staff_relative',
  'financial_hardship',
  'senior_citizen',
  'package_deal',
  'festival',
  'referral',
  'insurance_copay',
  'other',
]

const CATEGORY_LABELS: Record<string, string> = {
  regular_patient:    'Regular Patient',
  staff_relative:     'Staff / Relative',
  financial_hardship: 'Financial Hardship',
  senior_citizen:     'Senior Citizen',
  package_deal:       'Package Deal',
  festival:           'Festival / Special Occasion',
  referral:           'Referral Discount',
  insurance_copay:    'Insurance Co-pay Adjustment',
  other:              'Other',
}


// ─────────────────────────────────────────────────────────────────────
// POST — Apply discount or request approval
// ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { bill_id, discount_amount, discount_percent, reason, category } = body ?? {}

  // ── Validate ───────────────────────────────────────────────────
  if (!bill_id || typeof bill_id !== 'string') {
    return NextResponse.json({ error: 'bill_id is required' }, { status: 400 })
  }
  if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
    return NextResponse.json({ error: 'reason is required (min 3 characters)' }, { status: 400 })
  }

  const cat = category || 'other'
  if (!VALID_CATEGORIES.includes(cat)) {
    return NextResponse.json({
      error: `category must be one of: ${VALID_CATEGORIES.join(', ')}`,
    }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  // ── Load bill ──────────────────────────────────────────────────
  const { data: bill, error: billErr } = await sb
    .from('bills')
    .select('*')
    .eq('id', bill_id)
    .single()

  if (billErr || !bill) {
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  }

  if (bill.is_deleted || bill.status === 'cancelled' || bill.status === 'refunded') {
    return NextResponse.json({ error: `Cannot discount a ${bill.status || 'deleted'} bill` }, { status: 400 })
  }

  const billTotal = Number(bill.net_amount || bill.total || 0)
  if (billTotal <= 0) {
    return NextResponse.json({ error: 'Bill has zero total — nothing to discount' }, { status: 400 })
  }

  // ── Calculate discount amount ──────────────────────────────────
  let discountAmt: number
  let discountPct: number

  if (discount_percent !== undefined && discount_percent !== null) {
    discountPct = Number(discount_percent)
    if (!Number.isFinite(discountPct) || discountPct <= 0 || discountPct > 100) {
      return NextResponse.json({ error: 'discount_percent must be between 0.01 and 100' }, { status: 400 })
    }
    discountAmt = round2((billTotal * discountPct) / 100)
  } else if (discount_amount !== undefined && discount_amount !== null) {
    discountAmt = Number(discount_amount)
    if (!Number.isFinite(discountAmt) || discountAmt <= 0) {
      return NextResponse.json({ error: 'discount_amount must be > 0' }, { status: 400 })
    }
    discountPct = round2((discountAmt / billTotal) * 100)
  } else {
    return NextResponse.json({
      error: 'Either discount_amount or discount_percent is required',
    }, { status: 400 })
  }

  if (discountAmt > billTotal) {
    return NextResponse.json({
      error: `Discount ₹${discountAmt} exceeds bill total ₹${billTotal}`,
    }, { status: 400 })
  }

  // Check against existing discount
  const existingDiscount = Number(bill.discount || 0)
  if (existingDiscount > 0) {
    return NextResponse.json({
      error: `Bill already has a discount of ₹${existingDiscount}. Remove existing discount first.`,
      existing_discount: existingDiscount,
    }, { status: 409 })
  }

  // ── Check role-based limit ─────────────────────────────────────
  const userRole = (auth.role || 'staff').toLowerCase()
  const maxAllowed = DISCOUNT_LIMITS[userRole] ?? DISCOUNT_LIMITS['staff'] ?? 10
  const withinLimit = discountPct <= maxAllowed
  const userName = auth.fullName || auth.email || 'unknown'

  if (withinLimit) {
    // ── Auto-approve: apply discount directly ────────────────────
    const newNetAmount = round2(billTotal - discountAmt)
    const newDue = round2(Math.max(0, newNetAmount - Number(bill.paid || 0)))
    const newStatus = Number(bill.paid || 0) >= newNetAmount ? 'paid' : (bill.status || 'pending')

    const updatePayload: Record<string, any> = {
      discount: discountAmt,
      net_amount: newNetAmount,
      due: newDue,
      status: newStatus,
      updated_at: new Date().toISOString(),
    }

    // Set Phase 1 columns if they exist (non-fatal if they don't)
    try {
      updatePayload.discount_reason = `[${CATEGORY_LABELS[cat] || cat}] ${reason.trim()}`
      updatePayload.discount_approved_by = userName
    } catch { /* columns may not exist */ }

    const { error: updErr } = await sb
      .from('bills')
      .update(updatePayload)
      .eq('id', bill_id)

    if (updErr) {
      // Retry without Phase 1 columns
      const minUpdate = {
        discount: discountAmt,
        net_amount: newNetAmount,
        due: newDue,
        status: newStatus,
        updated_at: new Date().toISOString(),
      }
      const { error: retryErr } = await sb.from('bills').update(minUpdate).eq('id', bill_id)
      if (retryErr) {
        return NextResponse.json({ error: 'Failed to apply discount: ' + retryErr.message }, { status: 500 })
      }
    }

    // Audit
    try {
      const { audit } = await import('@/lib/audit')
      await audit(
        'update',
        'billing' as any,
        bill_id,
        `[DISCOUNT APPLIED] ₹${discountAmt} (${discountPct}%) on bill ${bill.invoice_number || bill_id.slice(0, 8)} | ` +
        `Category: ${CATEGORY_LABELS[cat] || cat} | Reason: ${reason.trim()} | ` +
        `Auto-approved (${userRole} limit: ${maxAllowed}%) | By: ${userName}`
      )
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      status: 'approved',
      auto_approved: true,
      discount: {
        amount: discountAmt,
        percent: discountPct,
        category: cat,
        reason: reason.trim(),
        approved_by: userName,
      },
      bill: {
        id: bill_id,
        previous_net: billTotal,
        new_net: newNetAmount,
        new_due: newDue,
        new_status: newStatus,
      },
      role_limit: { role: userRole, max_percent: maxAllowed },
    })

  } else {
    // ── Needs approval: store as pending ──────────────────────────
    // Store pending request in bill's metadata (no extra table needed)
    // We use the discount_reason field with a [PENDING] prefix

    const pendingMeta = JSON.stringify({
      requested_by: userName,
      requested_role: userRole,
      requested_at: new Date().toISOString(),
      discount_amount: discountAmt,
      discount_percent: discountPct,
      category: cat,
      reason: reason.trim(),
      status: 'pending',
    })

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    try {
      updatePayload.discount_reason = `[PENDING APPROVAL] ${pendingMeta}`
      updatePayload.discount_approved_by = null
    } catch { /* columns may not exist */ }

    await sb.from('bills').update(updatePayload).eq('id', bill_id)

    // Audit
    try {
      const { audit } = await import('@/lib/audit')
      await audit(
        'update',
        'billing' as any,
        bill_id,
        `[DISCOUNT REQUESTED] ₹${discountAmt} (${discountPct}%) — NEEDS APPROVAL | ` +
        `${userRole} limit is ${maxAllowed}% | Bill: ${bill.invoice_number || bill_id.slice(0, 8)} | ` +
        `Category: ${CATEGORY_LABELS[cat] || cat} | By: ${userName}`
      )
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      status: 'pending_approval',
      auto_approved: false,
      message: `Discount of ${discountPct}% exceeds your role limit of ${maxAllowed}%. Sent for admin/doctor approval.`,
      discount: {
        amount: discountAmt,
        percent: discountPct,
        category: cat,
        reason: reason.trim(),
        requested_by: userName,
      },
      role_limit: { role: userRole, max_percent: maxAllowed },
      requires_role: discountPct <= 25 ? 'doctor' : 'admin',
    })
  }
}


// ─────────────────────────────────────────────────────────────────────
// GET — List discount history or pending approvals
// ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const params = req.nextUrl.searchParams
  const billId = params.get('billId')
  const pending = params.get('pending')
  const fromDate = params.get('from')
  const toDate = params.get('to')

  const sb = getSupabaseAdmin()

  if (billId) {
    // ── Single bill discount info ────────────────────────────────
    const { data: bill, error } = await sb
      .from('bills')
      .select('id, invoice_number, net_amount, total, discount, discount_reason, discount_approved_by, status')
      .eq('id', billId)
      .single()

    if (error || !bill) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
    }

    const discount = Number(bill.discount || 0)
    const reason = bill.discount_reason || ''
    const isPending = reason.startsWith('[PENDING APPROVAL]')
    let pendingData = null

    if (isPending) {
      try {
        const jsonStr = reason.replace('[PENDING APPROVAL] ', '')
        pendingData = JSON.parse(jsonStr)
      } catch { /* malformed */ }
    }

    return NextResponse.json({
      bill_id: billId,
      invoice_number: bill.invoice_number,
      has_discount: discount > 0,
      discount_amount: discount,
      discount_reason: isPending ? pendingData?.reason : reason,
      discount_approved_by: bill.discount_approved_by,
      is_pending_approval: isPending,
      pending_request: pendingData,
    })
  }

  if (pending === 'true') {
    // ── List all bills with pending discount approvals ────────────
    let query = sb
      .from('bills')
      .select('id, invoice_number, invoicenumber, patient_id, patientid, net_amount, total, discount_reason, created_at, status')
      .like('discount_reason', '[PENDING APPROVAL]%')
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
      .limit(50)

    if (fromDate) query = query.gte('created_at', fromDate + 'T00:00:00+05:30')
    if (toDate) query = query.lte('created_at', toDate + 'T23:59:59+05:30')

    const { data: bills, error: fetchErr } = await query

    if (fetchErr) {
      return NextResponse.json({ error: 'Failed to load pending discounts: ' + fetchErr.message }, { status: 500 })
    }

    // Parse pending data from each bill
    const pendingRequests = (bills || []).map((b: any) => {
      let pendingData: any = null
      try {
        const jsonStr = (b.discount_reason || '').replace('[PENDING APPROVAL] ', '')
        pendingData = JSON.parse(jsonStr)
      } catch { /* malformed */ }

      return {
        bill_id: b.id,
        invoice_number: b.invoice_number || b.invoicenumber,
        patient_id: b.patient_id || b.patientid,
        bill_total: Number(b.net_amount || b.total || 0),
        bill_status: b.status,
        bill_date: b.created_at,
        request: pendingData,
      }
    }).filter((r: any) => r.request !== null)

    return NextResponse.json({
      pending_count: pendingRequests.length,
      requests: pendingRequests,
    })
  }

  return NextResponse.json({ error: 'Provide billId or pending=true' }, { status: 400 })
}


// ─────────────────────────────────────────────────────────────────────
// PUT — Approve or reject a pending discount request
// ─────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  // Only admin or doctor can approve
  const userRole = (auth.role || 'staff').toLowerCase()
  if (!['admin', 'superadmin', 'doctor'].includes(userRole)) {
    return NextResponse.json({
      error: 'Only admin or doctor can approve/reject discount requests',
    }, { status: 403 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { bill_id, action, notes } = body ?? {}

  if (!bill_id) {
    return NextResponse.json({ error: 'bill_id is required' }, { status: 400 })
  }
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  // Load bill
  const { data: bill, error: billErr } = await sb
    .from('bills')
    .select('*')
    .eq('id', bill_id)
    .single()

  if (billErr || !bill) {
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  }

  const discountReason = bill.discount_reason || ''
  if (!discountReason.startsWith('[PENDING APPROVAL]')) {
    return NextResponse.json({ error: 'This bill has no pending discount request' }, { status: 400 })
  }

  // Parse pending request
  let pendingData: any
  try {
    const jsonStr = discountReason.replace('[PENDING APPROVAL] ', '')
    pendingData = JSON.parse(jsonStr)
  } catch {
    return NextResponse.json({ error: 'Malformed pending request data' }, { status: 500 })
  }

  const discountAmt = Number(pendingData.discount_amount || 0)
  const discountPct = Number(pendingData.discount_percent || 0)
  const userName = auth.fullName || auth.email || 'unknown'
  const billTotal = Number(bill.net_amount || bill.total || 0)
  const now = new Date().toISOString()

  // Check approver's own limit
  const approverMax = DISCOUNT_LIMITS[userRole] ?? 10
  if (action === 'approve' && discountPct > approverMax) {
    return NextResponse.json({
      error: `Your role (${userRole}) can only approve up to ${approverMax}%. This discount is ${discountPct}%.`,
    }, { status: 403 })
  }

  if (action === 'approve') {
    // Apply the discount
    const newNetAmount = round2(billTotal - discountAmt)
    const newDue = round2(Math.max(0, newNetAmount - Number(bill.paid || 0)))
    const newStatus = Number(bill.paid || 0) >= newNetAmount ? 'paid' : (bill.status || 'pending')
    const categoryLabel = CATEGORY_LABELS[pendingData.category] || pendingData.category || ''

    const updatePayload: Record<string, any> = {
      discount: discountAmt,
      net_amount: newNetAmount,
      due: newDue,
      status: newStatus,
      discount_reason: `[${categoryLabel}] ${pendingData.reason}${notes ? ' | Approver note: ' + notes : ''}`,
      discount_approved_by: userName,
      updated_at: now,
    }

    const { error: updErr } = await sb.from('bills').update(updatePayload).eq('id', bill_id)

    if (updErr) {
      // Retry without Phase 1 columns
      const minUpdate = { discount: discountAmt, net_amount: newNetAmount, due: newDue, status: newStatus, updated_at: now }
      const { error: retryErr } = await sb.from('bills').update(minUpdate).eq('id', bill_id)
      if (retryErr) {
        return NextResponse.json({ error: 'Failed to apply discount: ' + retryErr.message }, { status: 500 })
      }
    }

    // Audit
    try {
      const { audit } = await import('@/lib/audit')
      await audit(
        'update',
        'billing' as any,
        bill_id,
        `[DISCOUNT APPROVED] ₹${discountAmt} (${discountPct}%) | ` +
        `Originally requested by ${pendingData.requested_by} (${pendingData.requested_role}) | ` +
        `Approved by: ${userName} (${userRole}) | Bill: ${bill.invoice_number || bill_id.slice(0, 8)}`
      )
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      action: 'approved',
      discount: { amount: discountAmt, percent: discountPct },
      approved_by: userName,
      bill: { id: bill_id, new_net: newNetAmount, new_due: newDue, new_status: newStatus },
    })

  } else {
    // Reject — clear the pending request
    const { error: updErr } = await sb
      .from('bills')
      .update({
        discount_reason: `[REJECTED] ${pendingData.reason} — Rejected by ${userName}${notes ? ': ' + notes : ''}`,
        discount_approved_by: null,
        updated_at: now,
      })
      .eq('id', bill_id)

    if (updErr) {
      // Minimal fallback
      await sb.from('bills').update({ discount_reason: null, updated_at: now }).eq('id', bill_id)
    }

    // Audit
    try {
      const { audit } = await import('@/lib/audit')
      await audit(
        'update',
        'billing' as any,
        bill_id,
        `[DISCOUNT REJECTED] ₹${discountAmt} (${discountPct}%) request rejected | ` +
        `Requested by ${pendingData.requested_by} | Rejected by: ${userName}${notes ? ' | Reason: ' + notes : ''}`
      )
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      action: 'rejected',
      rejected_by: userName,
      notes: notes || null,
    })
  }
}


// ── Utility ──────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}