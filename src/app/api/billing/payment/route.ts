/**
 * src/app/api/billing/payment/route.ts
 *
 * Partial Payment API
 *
 * GET  /api/billing/payment?billId=xxx  → payment history for a bill
 * POST /api/billing/payment             → record a payment
 *
 * Uses ACTUAL bills schema: total, paid, due (NOT net_amount/gross_amount)
 * The DB trigger update_bill_after_payment() auto-updates paid/due/status.
 *
 * ─── HARDENING (May 2026) ────────────────────────────────────────────
 *  - Auth: every call must come from an authenticated, active clinic
 *    user with role admin / doctor / receptionist / staff.
 *  - Service-role client is now lazy & memoized via @/lib/supabase-admin
 *    so `next build` no longer fails when env vars are absent at build
 *    time, and we never silently fall back to the anon key for writes.
 *  - Money comparison is done in INTEGER PAISE so float fudge factors
 *    like `due + 0.01` are no longer required (and no longer mask
 *    reconciliation bugs).
 *  - `receivedBy` is derived from the authenticated session and is
 *    NOT trusted from the request body (prevents receiver forgery).
 *  - Optional `Idempotency-Key` header lets clients safely retry the
 *    same request without creating duplicate payment rows.
 *  - DB and trigger contracts are unchanged.  No migration required.
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
  // Log only opaque IDs / error class — never PHI (no patient name/phone/etc.).
  const code = (err as { code?: string })?.code ?? 'unknown'
  const msg = (err as { message?: string })?.message ?? String(err)
  // eslint-disable-next-line no-console
  console.error(`[billing/payment][${scope}] billId=${billId ?? '-'} code=${code} msg=${msg}`)
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

  const { data: payments, error } = await sb
    .from('bill_payments')
    .select('*')
    .eq('billid', billId)
    .order('createdat', { ascending: false })

  if (error) {
    safeErrorLog('GET.select', billId, error)
    return NextResponse.json(
      { error: 'Failed to fetch payment history.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ payments: payments || [] })
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

  const { billId, amount, paymentMode, reference, notes } = body ?? {}

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
    const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString()
    const { data: existing } = await sb
      .from('bill_payments')
      .select('*')
      .eq('billid', billId)
      .eq('reference', `idem:${idempotencyKey}`)
      .gte('createdat', since)
      .limit(1)
      .maybeSingle()

    if (existing) {
      const { data: existingBill } = await sb
        .from('bills')
        .select('id, total, paid, due, status')
        .eq('id', billId)
        .single()

      const isPaid = existingBill?.status === 'paid'
      return NextResponse.json({
        success: true,
        payment: existing,
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

  // ── Insert payment — DB trigger updates bill paid/due/status ───
  // `receivedby` comes from the authenticated session (NOT the body) so
  // it cannot be forged.  If the caller passed an Idempotency-Key, we
  // stash it in `reference` so retries match the row above.
  const { data: payment, error: payErr } = await sb
    .from('bill_payments')
    .insert({
      billid:      billId,
      patientid:   bill.patientid,
      amount:      paiseToRupees(amountPaise), // re-quantize to clean rupees
      paymentmode: mode,
      reference:   idempotencyKey ? `idem:${idempotencyKey}` : refClean,
      receivedby:  auth.clinicUserId, // forced server-side
      notes:       notesClean,
    })
    .select()
    .single()

  if (payErr) {
    safeErrorLog('POST.insert', billId, payErr)
    return NextResponse.json(
      { error: 'Failed to record payment.' },
      { status: 500 }
    )
  }

  // ── Fetch updated bill after trigger runs ──────────────────────
  const { data: updatedBill } = await sb
    .from('bills')
    .select('id, total, paid, due, status')
    .eq('id', billId)
    .single()

  const isPaid = updatedBill?.status === 'paid'

  return NextResponse.json({
    success: true,
    payment,
    bill:    updatedBill,
    message: isPaid
      ? `✅ Bill fully paid! ₹${amountNum} received.`
      : `₹${amountNum} recorded. Remaining due: ₹${updatedBill?.due || 0}`,
  })
}
