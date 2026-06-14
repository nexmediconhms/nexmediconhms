/**
 * src/app/api/billing/payment/route.ts
 *
 * Partial Payment API
 *
 * GET  /api/billing/payment?billId=xxx  → payment history for a bill
 * POST /api/billing/payment             → record a payment
 *
 * ─── HARDENING (Jun 2026) ────────────────────────────────────────────
 * - Auth: admin / doctor / receptionist / staff only.
 * - Service-role client via @/lib/supabase-admin.
 * - Money compared in INTEGER PAISE.
 * - `receivedBy` derived from the session (never trusted from body).
 * - Optional `Idempotency-Key` header for safe retries.
 *
 * - SCHEMA-PROBING INSERT (fixes PGRST204): instead of guessing the
 * column names of bill_payments, the route PROBES the live table for
 * which columns actually resolve in PostgREST's schema cache and
 * inserts ONLY those, mapped to whatever naming the install uses
 * (snake_case / legacy no-underscore). Every column except bill_id
 * and amount has a DB default, so any column the cache doesn't know
 * is simply omitted and the insert still succeeds. A best-effort
 * PostgREST schema-cache reload is attempted first via exec_sql.
 * - SELF-DIAGNOSING: if the insert still fails, the REAL Postgres
 * message/code is returned in `error` so it shows in the UI banner.
 * - NO-TRIGGER SYNC: the route recomputes bills.paid/due/status itself
 * (no DB trigger exists on this install), so IPD / OPD / Finance /
 * Patient Profile all reflect the payment.
 * - Accepts BOTH camelCase (billId/paymentMode) and snake_case
 * (bill_id/payment_mode) body keys.
 * ─────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── Constants ────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['admin', 'doctor', 'receptionist', 'staff'] as const

const VALID_MODES = [
  'cash', 'upi', 'card', 'cheque', 'insurance', 'advance', 'other',
] as const
type PaymentMode = typeof VALID_MODES[number]

const MAX_AMOUNT_RUPEES = 10_000_000   // ₹1 crore
const MAX_REF_LENGTH = 120
const MAX_NOTES_LENGTH = 1000
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204'])

// Candidate column names this codebase has used across migrations.
const BILL_COLS     = ['bill_id', 'billid'] as const
const PATIENT_COLS  = ['patient_id', 'patientid'] as const
const MODE_COLS     = ['payment_mode', 'paymentmode', 'mode'] as const
const RECEIVED_COLS = ['received_by', 'receivedby'] as const

// ── Helpers ──────────────────────────────────────────────────────────
function rupeesToPaise(rupees: number): number { return Math.round(rupees * 100) }
function paiseToRupees(paise: number): number { return Math.round(paise) / 100 }

function trimToLen(value: unknown, maxLen: number): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (s.length === 0) return null
  return s.length > maxLen ? s.slice(0, maxLen) : s
}

function safeErrorLog(scope: string, billId: string | null, err: unknown) {
  const code = (err as { code?: string })?.code ?? 'unknown'
  const msg = (err as { message?: string })?.message ?? String(err)
  // eslint-disable-next-line no-console
  console.error(`[billing/payment][${scope}] billId=${billId ?? '-'} code=${code} msg=${msg}`)
}

/** Best-effort PostgREST schema-cache reload. Safe no-op if exec_sql absent. */
async function reloadSchemaCache(sb: any) {
  try { await sb.rpc('exec_sql', { sql: "NOTIFY pgrst, 'reload schema'" }) } catch { /* ignore */ }
}

/** Probe which of `candidates` actually resolve on bill_payments right now. */
async function detectColumns(sb: any, candidates: readonly string[]): Promise<Set<string>> {
  const present = new Set<string>()
  await Promise.all(candidates.map(async (c) => {
    try {
      const { error } = await sb.from('bill_payments').select(c).limit(1)
      if (!error) present.add(c)
    } catch { /* treat as absent */ }
  }))
  return present
}

/** First candidate from `cands` that exists in `present`, else null. */
function firstPresent(present: Set<string>, cands: readonly string[]): string | null {
  for (const c of cands) if (present.has(c)) return c
  return null
}

/** Insert a payment row using only columns that exist on the live table. */
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
  await reloadSchemaCache(sb)

  const all = [
    ...BILL_COLS, ...PATIENT_COLS, 'amount',
    ...MODE_COLS, 'reference', ...RECEIVED_COLS, 'notes',
  ]
  const present = await detectColumns(sb, all)

  const payload: Record<string, unknown> = {}

  const billCol = firstPresent(present, BILL_COLS)
  if (billCol) payload[billCol] = fields.billId

  if (present.has('amount')) payload.amount = fields.amount

  if (fields.patientId != null) {
    const pCol = firstPresent(present, PATIENT_COLS)
    if (pCol) payload[pCol] = fields.patientId
  }

  const modeCol = firstPresent(present, MODE_COLS)
  if (modeCol) payload[modeCol] = fields.mode

  if (fields.reference != null && present.has('reference')) {
    payload.reference = fields.reference
  }

  if (fields.receivedBy != null) {
    const rCol = firstPresent(present, RECEIVED_COLS)
    if (rCol) payload[rCol] = fields.receivedBy
  }

  if (fields.notes != null && present.has('notes')) {
    payload.notes = fields.notes
  }

  // Safety net (extremely unlikely): ensure the required columns are present.
  if (!billCol) payload.bill_id = fields.billId
  if (!present.has('amount')) payload.amount = fields.amount

  return await sb.from('bill_payments').insert(payload).select().single()
}

/** Recompute & persist bills.paid/due/status after a payment (no DB trigger). */
async function recalcBill(sb: any, billId: string, billTotal: number) {
  try {
    let pays = await sb.from('bill_payments').select('amount').eq('bill_id', billId)
    if (pays.error) {
      const code = (pays.error as { code?: string })?.code
      if (code && MISSING_COLUMN_CODES.has(code)) {
        pays = await sb.from('bill_payments').select('amount').eq('billid', billId)
      }
    }
    const paidSum = (pays.data || []).reduce(
      (s: number, p: any) => s + Number(p.amount || 0), 0,
    )
    const total = Number(billTotal || 0)
    const newDue = Math.max(0, total - paidSum)
    const newStatus = paidSum <= 0 ? 'unpaid' : newDue <= 0 ? 'paid' : 'partial'
    await sb.from('bills').update({ paid: paidSum, due: newDue, status: newStatus }).eq('id', billId)
    return { paid: paidSum, due: newDue, status: newStatus }
  } catch (err) {
    safeErrorLog('recalcBill', billId, err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────
// GET — payment history
// ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  const billId = req.nextUrl.searchParams.get('billId')
  if (!billId) {
    return NextResponse.json({ error: 'billId is required' }, { status: 400 })
  }

  let sb
  try { sb = getSupabaseAdmin() } catch (err) {
    safeErrorLog('getAdmin', billId, err)
    return NextResponse.json(
      { error: 'Server is misconfigured. Please contact your administrator.' },
      { status: 500 },
    )
  }

  let result = await sb
    .from('bill_payments').select('*').eq('bill_id', billId)
    .order('created_at', { ascending: false })

  if (result.error) {
    const code = (result.error as { code?: string })?.code
    if (code && MISSING_COLUMN_CODES.has(code)) {
      result = await sb
        .from('bill_payments').select('*').eq('billid', billId)
        .order('created_at', { ascending: false })
    }
  }

  if (result.error) {
    safeErrorLog('GET.select', billId, result.error)
    return NextResponse.json({ error: 'Failed to fetch payment history.' }, { status: 500 })
  }

  return NextResponse.json({ payments: result.data || [] })
}

// ─────────────────────────────────────────────────────────────────────
// POST — record a payment
// ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Accept BOTH camelCase and snake_case keys.
  const { amount, reference, notes } = body ?? {}
  const billId = body?.billId ?? body?.bill_id ?? undefined
  const paymentMode = body?.paymentMode ?? body?.payment_mode ?? undefined

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
      { status: 400 },
    )
  }

  const refClean = trimToLen(reference, MAX_REF_LENGTH)
  const notesClean = trimToLen(notes, MAX_NOTES_LENGTH)

  let sb
  try { sb = getSupabaseAdmin() } catch (err) {
    safeErrorLog('getAdmin', billId, err)
    return NextResponse.json(
      { error: 'Server is misconfigured. Please contact your administrator.' },
      { status: 500 },
    )
  }

  // ── Idempotency check (optional) ───────────────────────────────
  const idempotencyKey = req.headers.get('idempotency-key')?.trim() || null
  if (idempotencyKey) {
    const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString()
    let existingRes = await sb
      .from('bill_payments').select('*')
      .eq('bill_id', billId).eq('reference', `idem:${idempotencyKey}`)
      .gte('created_at', since).limit(1).maybeSingle()

    if (existingRes.error) {
      const code = (existingRes.error as { code?: string })?.code
      if (code && MISSING_COLUMN_CODES.has(code)) {
        existingRes = await sb
          .from('bill_payments').select('*')
          .eq('billid', billId).eq('reference', `idem:${idempotencyKey}`)
          .gte('created_at', since).limit(1).maybeSingle()
      }
    }

    if (existingRes.data) {
      const { data: existingBill } = await sb
        .from('bills').select('id, total, paid, due, status').eq('id', billId).single()
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
    .from('bills').select('id, patientid, total, paid, due, status')
    .eq('id', billId).single()

  if (billErr || !bill) {
    if (billErr) safeErrorLog('POST.fetchBill', billId, billErr)
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  }
  if (bill.status === 'paid') {
    return NextResponse.json({ error: 'Bill is already fully paid' }, { status: 400 })
  }
  if (bill.status === 'refunded' || bill.status === 'waived') {
    return NextResponse.json(
      { error: `Cannot add payment to a ${bill.status} bill` }, { status: 400 },
    )
  }

  // ── Integer-paise comparison ───────────────────────────────────
  const duePaise = rupeesToPaise(Number(bill.due || 0))
  const amountPaise = rupeesToPaise(amountNum)
  if (amountPaise > duePaise) {
    return NextResponse.json(
      {
        error: `Payment ₹${amountNum} exceeds outstanding due ₹${paiseToRupees(duePaise).toFixed(2)}`,
        due: paiseToRupees(duePaise),
      },
      { status: 400 },
    )
  }

  // ── Insert (schema-probing) ────────────────────────────────────
  const resolvedPatientId = (bill as any).patient_id ?? (bill as any).patientid ?? null
  const resolvedReceivedBy =
    (auth as any)?.clinicUserId ?? (auth as any)?.userId ?? (auth as any)?.id ?? null

  const { data: payment, error: payErr } = await insertPaymentRow(sb, {
    billId,
    patientId: resolvedPatientId,
    amount: paiseToRupees(amountPaise),
    mode,
    reference: idempotencyKey ? `idem:${idempotencyKey}` : refClean,
    receivedBy: resolvedReceivedBy,
    notes: notesClean,
  })

  if (payErr) {
    safeErrorLog('POST.insert', billId, payErr)
    const pgMsg =
      (payErr as any)?.message || (payErr as any)?.details ||
      (payErr as any)?.hint || 'Unknown database error'
    const pgCode = (payErr as any)?.code || null
    return NextResponse.json(
      {
        error: `Failed to record payment: ${pgMsg}${pgCode ? ` (code ${pgCode})` : ''}`,
        detail: pgMsg,
        code: pgCode,
      },
      { status: 500 },
    )
  }

  // ── Recalculate parent bill (no DB trigger) ────────────────────
  const recalculated = await recalcBill(sb, billId, Number(bill.total || 0))

  const { data: updatedBill } = await sb
    .from('bills').select('id, total, paid, due, status').eq('id', billId).single()

  // FIX: Spread properties natively to prevent duplicate object literal definitions
  const finalBill = updatedBill ||
    (recalculated
      ? { ...bill, ...recalculated }
      : { ...bill })

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