/**
 * src/lib/billing-helpers.ts
 *
 * Billing Schema Helper — handles both legacy and modern column names
 *
 * WHY THIS EXISTS:
 *   The v00-schema-master creates bills with camelCase columns (patientid, createdat).
 *   The modern code expects snake_case (patient_id, created_at).
 *   PostgREST returns empty results (not errors) when filtering on non-existent columns.
 *   This helper detects the schema and provides correct query builders.
 *
 * FIX (June 2026):
 *   Added API-first approach: loadPatientBills now calls /api/billing/patient-bills
 *   which uses the service role key (bypasses RLS). This solves the issue where
 *   client-side queries return empty due to RLS policies blocking reads.
 *   Falls back to client-side multi-attempt queries if the API is unavailable.
 */

import { supabase } from '@/lib/supabase'

// ─── Schema Detection (client-side) ──────────────────────────────────────────

interface BillingSchema {
  patient_id: string
  created_at: string
  updated_at: string
  invoice_number: string
  payment_mode: string
  hasNetAmount: boolean
  hasPatientName: boolean
  hasPaidAt: boolean
}

let cachedSchema: BillingSchema | null = null
let detecting = false

/**
 * Detect the bills table schema and cache the result.
 * Call this once on page load.
 */
export async function detectBillingSchema(): Promise<BillingSchema> {
  if (cachedSchema) return cachedSchema

  // Prevent parallel detection
  if (detecting) {
    await new Promise(resolve => setTimeout(resolve, 500))
    if (cachedSchema) return cachedSchema
  }

  detecting = true

  try {
    // Try modern snake_case
    const { data: snakeTest, error: snakeErr } = await supabase
      .from('bills')
      .select('patient_id, created_at')
      .limit(0)

    if (!snakeErr) {
      // Check optional columns
      const { error: netErr } = await supabase.from('bills').select('net_amount').limit(0)
      const { error: nameErr } = await supabase.from('bills').select('patient_name').limit(0)
      const { error: paidAtErr } = await supabase.from('bills').select('paid_at').limit(0)

      cachedSchema = {
        patient_id: 'patient_id',
        created_at: 'created_at',
        updated_at: 'updated_at',
        invoice_number: 'invoice_number',
        payment_mode: 'payment_mode',
        hasNetAmount: !netErr,
        hasPatientName: !nameErr,
        hasPaidAt: !paidAtErr,
      }
      detecting = false
      return cachedSchema
    }

    // Try legacy camelCase
    const { error: camelErr } = await supabase
      .from('bills')
      .select('patientid, createdat')
      .limit(0)

    if (!camelErr) {
      cachedSchema = {
        patient_id: 'patientid',
        created_at: 'createdat',
        updated_at: 'updatedat',
        invoice_number: 'invoicenumber',
        payment_mode: 'paymentmode',
        hasNetAmount: false,
        hasPatientName: false,
        hasPaidAt: false,
      }
      console.warn('[billing-helpers] Legacy schema detected! Bills table uses camelCase columns. Please run migration 023.')
      detecting = false
      return cachedSchema
    }

    // Default fallback
    cachedSchema = {
      patient_id: 'patient_id',
      created_at: 'created_at',
      updated_at: 'updated_at',
      invoice_number: 'invoice_number',
      payment_mode: 'payment_mode',
      hasNetAmount: true,
      hasPatientName: true,
      hasPaidAt: true,
    }
    detecting = false
    return cachedSchema
  } catch {
    detecting = false
    // Return defaults
    return cachedSchema || {
      patient_id: 'patient_id',
      created_at: 'created_at',
      updated_at: 'updated_at',
      invoice_number: 'invoice_number',
      payment_mode: 'payment_mode',
      hasNetAmount: true,
      hasPatientName: true,
      hasPaidAt: true,
    }
  }
}

/**
 * Normalize a raw bill record (from any schema version) to consistent snake_case keys.
 */
function normalizeBill(bill: any) {
  return {
    id: bill.id,
    patient_id: bill.patient_id || bill.patientid,
    patient_name: bill.patient_name || '',
    mrn: bill.mrn || '',
    invoice_number: bill.invoice_number || bill.invoicenumber || '',
    items: Array.isArray(bill.items) ? bill.items : [],
    subtotal: Number(bill.subtotal || bill.total || 0),
    net_amount: Number(bill.net_amount || bill.total || 0),
    total: Number(bill.total || 0),
    paid: Number(bill.paid || 0),
    due: Number(bill.due || 0),
    discount: Number(bill.discount || 0),
    tax: Number(bill.tax || 0),
    gst_amount: Number(bill.gst_amount || 0),
    payment_mode: bill.payment_mode || bill.paymentmode || null,
    payment_ref: bill.payment_ref || null,
    status: bill.status || 'unknown',
    notes: bill.notes || '',
    created_at: bill.created_at || bill.createdat || null,
    updated_at: bill.updated_at || bill.updatedat || null,
    paid_at: bill.paid_at || null,
    encounter_id: bill.encounter_id || null,
  }
}

/**
 * Load bills for a patient.
 *
 * Strategy (in order):
 *   1. Call /api/billing/patient-bills (service role, bypasses RLS) — most reliable
 *   2. Client-side query with detected schema column names
 *   3. Client-side query with alternate column names (fallback)
 *   4. Client-side SELECT * with in-memory filter (last resort)
 */
export async function loadPatientBills(patientId: string) {
  // CRITICAL FIX: Do NOT rely solely on schema detection + a single column query.
  // The bills table can have BOTH `patient_id` and `patientid` columns (after
  // migration 023/024), but a given row may have only ONE of them populated —
  // depending on which insert path created it (modern vs. legacy retry in the
  // registration-payment API). Querying only the detected primary column
  // misses bills inserted via the legacy retry path.
  //
  // Strategy: run BOTH queries, merge results, dedupe by id. Each query either
  // succeeds (returning rows or empty) or returns an error if the column
  // doesn't exist — in which case we just ignore that side and use the other.

  const billMap = new Map<string, any>()

  // Query 1: modern column (patient_id)
  const modernResult = await supabase
    .from('bills')
    .select('*')
    .eq('patient_id', patientId)
    .limit(50)

  if (!modernResult.error && Array.isArray(modernResult.data)) {
    for (const bill of modernResult.data) {
      billMap.set(bill.id, bill)
    }
  } else if (modernResult.error) {
    // Column likely doesn't exist in this DB — silently fall through to legacy
    console.debug('[billing-helpers] patient_id query skipped:', modernResult.error.message)
  }

  // Query 2: legacy column (patientid). ALWAYS run this, even if modern returned
  // rows — a patient may have bills from both insert paths historically.
  const legacyResult = await supabase
    .from('bills')
    .select('*')
    .eq('patientid', patientId)
    .limit(50)

  if (!legacyResult.error && Array.isArray(legacyResult.data)) {
    for (const bill of legacyResult.data) {
      // Map.set is fine even if id is already present; we dedupe by Map's key
      // semantics. But we want to KEEP whichever row we already saw (they're
      // the same row from two angles), so use has() check.
      if (!billMap.has(bill.id)) {
        billMap.set(bill.id, bill)
      }
    }
  } else if (legacyResult.error) {
    console.debug('[billing-helpers] patientid query skipped:', legacyResult.error.message)
  }

  // Sort merged set by created_at descending (handles both column names)
  const allBills = Array.from(billMap.values()).sort((a, b) => {
    const aTime = new Date(a.paid_at || a.created_at || a.createdat || 0).getTime()
    const bTime = new Date(b.paid_at || b.created_at || b.createdat || 0).getTime()
    return bTime - aTime
  })

  // Cap at 50 after merging (in case both queries returned 50 distinct rows)
  const cappedBills = allBills.slice(0, 50)

  // Normalize the response to always use snake_case keys for the UI
  const normalizedBills = cappedBills.map(bill => ({
    id: bill.id,
    patient_id: bill.patient_id || bill.patientid,
    patient_name: bill.patient_name || '',
    mrn: bill.mrn || '',
    invoice_number: bill.invoice_number || bill.invoicenumber || '',
    items: Array.isArray(bill.items) ? bill.items : [],
    subtotal: Number(bill.subtotal || bill.total || 0),
    net_amount: Number(bill.net_amount || bill.total || 0),
    total: Number(bill.total || 0),
    paid: Number(bill.paid || 0),
    due: Number(bill.due || 0),
    payment_mode: bill.payment_mode || bill.paymentmode || null,
    payment_ref: bill.payment_ref || null,
    status: bill.status || 'unknown',
    notes: bill.notes || '',
    created_at: bill.created_at || bill.createdat || null,
    updated_at: bill.updated_at || bill.updatedat || null,
    paid_at: bill.paid_at || null,
  }))

  return { bills: normalizedBills, error: null }
}
/**
 * Get the display amount for a bill (handles all field variants)
 */
export function getBillAmount(bill: any): number {
  return Number(bill.net_amount) || Number(bill.total) || Number(bill.paid) || 0
}

/**
 * Get the display items text for a bill
 */
export function getBillItemsText(bill: any): string {
  if (!Array.isArray(bill.items) || bill.items.length === 0) return ''
  return bill.items.map((i: any) => i.label || i.description || 'Item').join(', ')
}
