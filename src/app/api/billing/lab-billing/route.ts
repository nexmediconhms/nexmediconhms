/**
 * src/app/api/billing/lab-billing/route.ts
 *
 * Lab Order → Bill Item Integration API
 *
 * POST /api/billing/lab-billing
 *   Auto-generate bill items from lab orders for a patient/encounter.
 *   Body: { patient_id, encounter_id?, admission_id?, lab_order_ids?: string[] }
 *
 * GET /api/billing/lab-billing?patientId=xxx
 *   List unbilled lab orders for a patient.
 *
 * PUT /api/billing/lab-billing
 *   Mark lab orders as billed (after bill is created).
 *   Body: { lab_order_ids: string[], bill_id: string }
 *
 * ADDITIVE — does not modify existing lab-orders or billing routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Default charges for common investigations (INR)
// These are overridden by ipd_charge_rates or billing_templates if they exist
const DEFAULT_LAB_CHARGES: Record<string, number> = {
  'cbc': 350, 'complete blood count': 350,
  'urine routine': 200, 'urine r/m': 200,
  'blood sugar': 150, 'rbs': 150, 'fbs': 150, 'ppbs': 150,
  'hba1c': 500,
  'thyroid': 600, 'tsh': 400, 't3 t4 tsh': 600,
  'lipid profile': 500,
  'liver function': 600, 'lft': 600,
  'kidney function': 500, 'kft': 500, 'rft': 500,
  'uric acid': 200,
  'creatinine': 200,
  'electrolytes': 400,
  'pt inr': 400, 'coagulation': 500,
  'blood group': 200,
  'hiv': 300, 'hbsag': 300, 'hcv': 400,
  'usg': 800, 'ultrasound': 800, 'sonography': 800,
  'x-ray': 400, 'xray': 400,
  'ecg': 300, 'ekg': 300,
  'doppler': 1500,
  'ct scan': 3000, 'mri': 5000,
  'pap smear': 500,
  'beta hcg': 500, 'pregnancy test': 300,
  'gct': 300, 'gtt': 400, 'ogtt': 400,
  'torch': 2000,
  'double marker': 2500, 'triple marker': 3000, 'quadruple marker': 3500,
  'anomaly scan': 1500, 'nt scan': 1200, 'growth scan': 800,
}

function estimateCharge(testName: string): number {
  const lower = (testName || '').toLowerCase().trim()
  for (const [key, val] of Object.entries(DEFAULT_LAB_CHARGES)) {
    if (lower.includes(key)) return val
  }
  return 0 // Unknown test — let user set price
}

// ─── GET — List unbilled lab orders ──────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const patientId = req.nextUrl.searchParams.get('patientId')
  const admissionId = req.nextUrl.searchParams.get('admissionId')

  if (!patientId) {
    return NextResponse.json({ error: 'patientId is required' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  let query = sb
    .from('lab_orders')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(100)

  // Try filtering by billing_status if column exists
  try {
    query = query.or('billing_status.is.null,billing_status.eq.unbilled')
  } catch { /* column may not exist */ }

  if (admissionId) {
    query = query.eq('admission_id', admissionId)
  }

  const { data: orders, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to load lab orders: ' + error.message }, { status: 500 })
  }

  // Enrich with estimated charges
  const enriched = (orders || []).map((o: any) => ({
    ...o,
    estimated_charge: o.charge_amount || estimateCharge(o.test_name || o.investigation || ''),
    billing_status: o.billing_status || 'unbilled',
  }))

  const unbilled = enriched.filter((o: any) => o.billing_status === 'unbilled' || !o.bill_id)
  const totalEstimated = unbilled.reduce((s: number, o: any) => s + (o.estimated_charge || 0), 0)

  return NextResponse.json({
    orders: enriched,
    unbilled_count: unbilled.length,
    unbilled_orders: unbilled,
    total_estimated: totalEstimated,
  })
}

// ─── POST — Generate bill items from lab orders ──────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { patient_id, encounter_id, admission_id, lab_order_ids } = body ?? {}

  if (!patient_id) {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  // Load lab orders
  let query = sb
    .from('lab_orders')
    .select('*')
    .eq('patient_id', patient_id)

  if (lab_order_ids && Array.isArray(lab_order_ids) && lab_order_ids.length > 0) {
    query = query.in('id', lab_order_ids)
  } else {
    // Get all unbilled orders
    try {
      query = query.or('billing_status.is.null,billing_status.eq.unbilled')
    } catch { /* column may not exist */ }
  }

  if (admission_id) query = query.eq('admission_id', admission_id)

  const { data: orders, error } = await query
  if (error) {
    return NextResponse.json({ error: 'Failed to load lab orders: ' + error.message }, { status: 500 })
  }
  if (!orders || orders.length === 0) {
    return NextResponse.json({ error: 'No unbilled lab orders found' }, { status: 404 })
  }

  // Build bill items from lab orders
  const billItems = orders.map((o: any) => {
    const testName = o.test_name || o.investigation || 'Lab Test'
    const charge = Number(o.charge_amount) || estimateCharge(testName)
    return {
      label: `Lab: ${testName}`,
      amount: charge,
      category: 'investigation',
      lab_order_id: o.id,
      quantity: 1,
    }
  })

  const subtotal = billItems.reduce((s: number, i: any) => s + i.amount, 0)

  return NextResponse.json({
    ok: true,
    bill_items: billItems,
    subtotal,
    lab_order_count: orders.length,
    lab_order_ids: orders.map((o: any) => o.id),
    message: `${orders.length} lab order(s) ready to add to bill. Total: ₹${subtotal.toLocaleString('en-IN')}`,
  })
}

// ─── PUT — Mark lab orders as billed ─────────────────────────────────
export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { lab_order_ids, bill_id } = body ?? {}

  if (!Array.isArray(lab_order_ids) || lab_order_ids.length === 0) {
    return NextResponse.json({ error: 'lab_order_ids array is required' }, { status: 400 })
  }
  if (!bill_id) {
    return NextResponse.json({ error: 'bill_id is required' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  const { error } = await sb
    .from('lab_orders')
    .update({
      bill_id,
      billing_status: 'billed',
      updated_at: new Date().toISOString(),
    })
    .in('id', lab_order_ids)

  if (error) {
    // Fallback: column may not exist
    console.warn('[lab-billing] PUT fallback — columns may not exist:', error.message)
    return NextResponse.json({
      ok: true,
      warning: 'Lab orders may not have billing columns. Run migration 031.',
      updated: 0,
    })
  }

  return NextResponse.json({
    ok: true,
    updated: lab_order_ids.length,
    bill_id,
  })
}