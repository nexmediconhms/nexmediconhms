/**
 * src/app/api/billing/payment/route.ts
 *
 * Partial Payment API
 *
 * GET  /api/billing/payment?billId=xxx  → payment history for a bill
 * POST /api/billing/payment             → record a payment
 *
 * Uses ACTUAL bills schema: total, paid, due (NOT net_amount/gross_amount)
 *
 * ─── HARDENING (Jun 2026) ────────────────────────────────────────────
 * - Auth: every call must come from an authenticated, active clinic
 * user with role admin / doctor / receptionist / staff.
 * - Service-role client is lazy & memoized via @/lib/supabase-admin.
 * - Money comparison is done in INTEGER PAISE.
 * - `receivedBy` is derived from the authenticated session and is
 * NOT trusted from the request body.
 * - Optional `Idempotency-Key` header lets clients safely retry.
 *
 * - SELF-HEALING INSERT: the bill_payments table is snake_case
 * (bill_id / patient_id / payment_mode / received_by) on the
 * canonical schema, but some installs carry legacy no-underscore
 * columns. We try snake_case first and automatically retry with the
 * legacy names if (and only if) the DB reports a missing-column
 * error, so this endpoint works on EITHER schema variant.
 * - SELF-DIAGNOSING: if the insert still fails, the REAL Postgres
 * message/code is returned in `error` so it is visible in the UI
 * instead of a generic string.
 * - NO-TRIGGER SYNC: this install has no DB trigger to recalculate the
 * parent bill after a payment, so the route recomputes paid/due/status
 * itself. Every module (IPD / OPD / Finance / Patient Profile) reads
 * bills.paid/due/status, so the payment propagates everywhere.
 * - The route accepts BOTH camelCase (billId/paymentMode) and
 * snake_case (bill_id/payment_mode) body keys, so the discharge page,
 * the IPD bill page, and any other module all work against it.
 * ─────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

// Routes that use the admin client must opt out of static prerendering.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── Constants ────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['admin', 'doctor', 'receptionist', 'staff'] as const

const VALID_MODES = [
  'cash',
  'upi',
  'card',
  'cheque',
  'insurance',
  'advance',
  'other',
] as const
type PaymentMode = typeof VALID_MODES[number]

// Defensive caps — guard against pathological inputs.
const MAX_AMOUNT_RUPEES = 10_000_000   // ₹1 crore
const MAX_REF_LENGTH = 120
const MAX_NOTES_LENGTH = 1000
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

// Postgres / PostgREST "column does not exist" error codes.
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204'])

// ── Helpers ──────────────────────────────────────────────────────────
function rupeesToPaise(rupees: number): number {
  // Always round to the nearest paisa to eliminate float drift.
  return Math.round(rupees * 100)
}

function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100
}

function trimToLen(value: unknown, maxLen: number): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (s.length === 0) return null
  return s.length > maxLen ? s.slice(0, maxLen) : s
}

function safeErrorLog(scope: string, billId: string | null, err: unknown) {
  // Log only opaque IDs / error class — never PHI.
  const code = (err as { code?: string })?.code ?? 'unknown'
  const msg = (err as { message?: string })?.message ?? String(err)
  // eslint-disable-next-line no-console
  console.error(`[billing/payment][${scope}] billId=${billId ?? '-'} code=${code} msg=${msg}`)
}

/**
 * Insert a payment row, trying the canonical snake_case columns first and
 * automatically retrying with legacy no-underscore columns if (and only if)
 * the DB reports a missing-column error. Returns the supabase result.
 */
async function insertPaymentRow(
  sb: any,
  fields: {
    billId: string
    patientId: string | null
    amount: number
    mode: string
    reference: string | null
    receivedBy: string | null
    notes: string | null
  },
) {
  const snake: Record<string, unknown> = {
    bill_id:      fields.billId,
    patient_id:   fields.patientId,
    amount:       fields.amount,
    payment_mode: fields.mode,
    reference:    fields.reference,
    received_by:  fields.receivedBy,
    notes:        fields.notes,
  }

  let res = await sb.from('bill_payments').insert(snake).select().single()
  if (!res.error) return res

  // Retry with legacy column names ONLY on a missing-column error.
  const code = (res.error as { code?: string })?.code
  if (code && MISSING_COLUMN_CODES.has(code)) {
    const legacy: Record<string, unknown> = {
      billid:      fields.billId,
      patientid:   fields.patientId,
      amount:      fields.amount,
      paymentmode: fields.mode,
      reference:   fields.reference,
      receivedby:  fields.receivedBy,
      notes:       fields.notes,
    }
    const retry = await sb.from('bill_payments').insert(legacy).select().single()
    if (!retry.error) return retry
    // Surface whichever error is more informative.
    return retry
  }

  return res
}

/**
 * Recalculate and persist the parent bill's paid/due/status after a payment.
 * (No DB trigger exists for this on the current install.) Non-fatal: the
 * payment row is already recorded if this throws.
 */
async function recalcBill(sb: any, billId: string, billTotal: number) {
  try {
    // Sum all payments for this bill (try snake_case, fall back to legacy).
    let paysRes = await sb.from('bill_payments').select('amount').eq('bill_id', billId)
    if (paysRes.error) {
      const code = (paysRes.error as { code?: string })?.code
      if (code && MISSING_COLUMN_CODES.has(code)) {
        paysRes = await sb.from('bill_payments').select('amount').eq('billid', billId)
      }
    }
    const paidSum = (paysRes.data || []).reduce(
      (s: number, p: any) => s + Number(p.amount || 0), 0,
    )
    const total = Number(billTotal || 0)
    const newDue = Math.max(0, total - paidSum)
    const newStatus = paidSum <= 0 ? 'unpaid' : newDue <= 0 ? 'paid' : 'partial'

    await sb
      .from('bills')
      .update({ paid: paidSum, due: newDue, status: newStatus })
      .eq('id', billId)

    return { paid: paidSum, due: newDue, status: newStatus }
  } catch (err) {
    safeErrorLog('recalcBill', billId, err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────
// GET — fetch payment history for a bill
// ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  const billId = req.nextUrl.searchParams.get('billId')
  if (!billId) {
    return NextResponse.json({ error: 'billId is required' }, { status: 400 })
  }

  let sb
  try {
    sb = getSupabaseAdmin()
  } catch (err) {
    safeErrorLog('getAdmin', billId, err)
    return NextResponse.json(
      { error: 'Server is misconfigured. Please contact your administrator.' },
      { status: 500 }
    )
  }

  // Try snake_case, fall back to legacy column on a missing-column error.
  let result = await sb
    .from('bill_payments')
    .select('*')
    .eq('bill_id', billId)
    .order('created_at', { ascending: false })

  if (result.error) {
    const code = (result.error as { code?: string })?.code
    if (code && MISSING_COLUMN_CODES.has(code)) {
      result = await sb
        .from('bill_payments')
        .select('*')
        .eq('billid', billId)
        .order('created_at', { ascending: false })
    }
  }

  if (result.error) {
    safeErrorLog('GET.select', billId, result.error)
    return NextResponse.json(
      { error: 'Failed to fetch payment history.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ payments: result.data || [] })
}

// ─────────────────────────────────────────────────────────────────────
// POST — record a new payment
// ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Accept BOTH camelCase and snake_case keys so every billing module works.
  const { amount, reference, notes } = body ?? {}
  const billId = body?.billId ?? body?.bill_id ?? undefined
  const paymentMode = body?.paymentMode ?? body?.payment_mode ?? undefined

  // ── Validation ─────────────────────────────────────────────────
  if (!billId || typeof billId !== 'string') {
    return NextResponse.json({ error: 'billId is required' }, { status: 400 })
  }

  const amountNum = typeof amount === 'string' ? parseFloat(amount) : Number(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  }
  if (amountNum > MAX_AMOUNT_RUPEES) {
    return NextResponse.json({ error: 'amount exceeds maximum allowed' }, { status: 400 })
  }

  if (!paymentMode || typeof paymentMode !== 'string') {
    return NextResponse.json({ error: 'paymentMode is required' }, { status: 400 })
  }
  const mode = paymentMode.trim().toLowerCase() as PaymentMode
  if (!(VALID_MODES as readonly string[]).includes(mode)) {
    return NextResponse.json(
      { error: `Invalid paymentMode. Use one of: ${VALID_MODES.join(', ')}` },
      { status: 400 }
    )
  }

  const refClean = trimToLen(reference, MAX_REF_LENGTH)
  const notesClean = trimToLen(notes, MAX_NOTES_LENGTH)

  // ── Get admin client ───────────────────────────────────────────
  let sb
  try {
    sb = getSupabaseAdmin()
  } catch (err) {
    safeErrorLog('getAdmin', billId, err)
    return NextResponse.json(
      { error: 'Server is misconfigured. Please contact your administrator.' },
      { status: 500 }
    )
  }

  // ── Idempotency check (optional) ───────────────────────────────
  const idempotencyKey = req.headers.get('idempotency-key')?.trim() || null
  if (idempotencyKey) {
    let existingRes = await sb
      .from('bill_payments')
      .select('*')
      .eq('bill_id', billId)
      .eq('reference', `idem:${idempotencyKey}`)
      .gte('created_at', new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString())
      .limit(1)
      .maybeSingle()

    if (existingRes.error) {
      const code = (existingRes.error as { code?: string })?.code
      if (code && MISSING_COLUMN_CODES.has(code)) {
        existingRes = await sb
          .from('bill_payments')
          .select('*')
          .eq('billid', billId)
          .eq('reference', `idem:${idempotencyKey}`)
          .gte('created_at', new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString())
          .limit(1)
          .maybeSingle()
      }
    }

    if (existingRes.data) {
      const { data: existingBill } = await sb
        .from('bills')
        .select('id, total, paid, due, status')
        .eq('id', billId)
        .single()

      const isPaid = existingBill?.status === 'paid'
      return NextResponse.json({
        success: true,
        payment: existingRes.data,
        bill: existingBill,
        message: isPaid
          ? `✅ Bill fully paid! ₹${amountNum} received.`
          : `₹${amountNum} recorded. Remaining due: ₹${existingBill?.due || 0}`,
        idempotent: true,
      })
    }
  }

  // ── Fetch the bill ─────────────────────────────────────────────
  const { data: bill, error: billErr } = await sb
    .from('bills')
    .select('id, patientid, total, paid, due, status')
    .eq('id', billId)
    .single()

  if (billErr || !bill) {
    if (billErr) safeErrorLog('POST.fetchBill', billId, billErr)
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  }
  if (bill.status === 'paid') {
    return NextResponse.json({ error: 'Bill is already fully paid' }, { status: 400 })
  }
  if (bill.status === 'refunded' || bill.status === 'waived') {
    return NextResponse.json(
      { error: `Cannot add payment to a ${bill.status} bill` },
      { status: 400 }
    )
  }

  // ── Integer-paise comparison (no float fudge) ──────────────────
  const duePaise = rupeesToPaise(Number(bill.due || 0))
  const amountPaise = rupeesToPaise(amountNum)
  if (amountPaise > duePaise) {
    return NextResponse.json(
      {
        error: `Payment ₹${amountNum} exceeds outstanding due ₹${paiseToRupees(duePaise).toFixed(2)}`,
        due: paiseToRupees(duePaise),
      },
      { status: 400 }
    )
  }

  // ── Insert payment (self-healing across schema variants) ───────
  // `receivedBy` comes from the authenticated session (NOT the body).
  // patient_id is taken from the parent bill (dual-named: patient_id ?? patientid).
  const resolvedPatientId =
    (bill as any).patient_id ?? (bill as any).patientid ?? null
  const resolvedReceivedBy =
    (auth as any)?.clinicUserId ??
    (auth as any)?.userId ??
    (auth as any)?.id ??
    null

  const { data: payment, error: payErr } = await insertPaymentRow(sb, {
    billId,
    patientId: resolvedPatientId,
    amount: paiseToRupees(amountPaise), // re-quantize to clean rupees
    mode,
    reference: idempotencyKey ? `idem:${idempotencyKey}` : refClean,
    receivedBy: resolvedReceivedBy,
    notes: notesClean,
  })

  if (payErr) {
    safeErrorLog('POST.insert', billId, payErr)
    const pgMsg =
      (payErr as any)?.message ||
      (payErr as any)?.details ||
      (payErr as any)?.hint ||
      'Unknown database error'
    const pgCode = (payErr as any)?.code || null
    // Surface the REAL reason so it is visible in the UI banner.
    return NextResponse.json(
      {
        error: `Failed to record payment: ${pgMsg}${pgCode ? ` (code ${pgCode})` : ''}`,
        detail: pgMsg,
        code: pgCode,
      },
      { status: 500 }
    )
  }

  // ── Recalculate the parent bill (no DB trigger on this install) ─
  const recalculated = await recalcBill(sb, billId, Number(bill.total || 0))

  // ── Fetch updated bill for the response ────────────────────────
  const { data: updatedBill } = await sb
    .from('bills')
    .select('id, total, paid, due, status')
    .eq('id', billId)
    .single()

  const finalBill = updatedBill ||
    (recalculated
      ? { id: billId, total: bill.total, ...recalculated }
      : bill)

  const isPaid = finalBill?.status === 'paid'

  return NextResponse.json({
    success: true,
    payment,
    bill: finalBill,
    message: isPaid
      ? `✅ Bill fully paid! ₹${amountNum} received.`
      : `₹${amountNum} recorded. Remaining due: ₹${finalBill?.due || 0}`,
  })
}