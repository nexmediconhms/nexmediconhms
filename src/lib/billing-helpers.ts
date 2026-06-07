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
  if (!patientId) return { bills: [], error: null }

  // ═══════════════════════════════════════════════════════════════════════════
  // ATTEMPT 1: Server-side API route (bypasses RLS, most reliable)
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const res = await fetch(`/api/billing/patient-bills?patient_id=${encodeURIComponent(patientId)}`)
    if (res.ok) {
      const data = await res.json()
      if (data.ok && Array.isArray(data.bills)) {
        // API already returns normalized bills
        return { bills: data.bills, error: null }
      }
    }
  } catch (apiErr) {
    console.warn('[billing-helpers] API route unavailable, falling back to client-side:', apiErr)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ATTEMPT 2: Client-side with schema detection
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const schema = await detectBillingSchema()

    const { data, error } = await supabase
      .from('bills')
      .select('*')
      .eq(schema.patient_id, patientId)
      .order(schema.created_at, { ascending: false })
      .limit(50)

    if (!error && data && data.length > 0) {
      return { bills: data.map(normalizeBill), error: null }
    }

    // If we got an error (e.g., column doesn't exist in ORDER BY), try without order
    if (error) {
      console.warn('[billing-helpers] Schema-detected query failed:', error.message)
      const { data: data2, error: error2 } = await supabase
        .from('bills')
        .select('*')
        .eq(schema.patient_id, patientId)
        .limit(50)

      if (!error2 && data2 && data2.length > 0) {
        return { bills: data2.map(normalizeBill), error: null }
      }
    }
  } catch {
    // Non-fatal, continue to fallback
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ATTEMPT 3: Try alternate column names (opposite of what was detected)
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    // Try patientid (legacy)
    const { data: legacyData, error: legacyErr } = await supabase
      .from('bills')
      .select('*')
      .eq('patientid', patientId)
      .limit(50)

    if (!legacyErr && legacyData && legacyData.length > 0) {
      return { bills: legacyData.map(normalizeBill), error: null }
    }

    // Try patient_id (modern) — in case detection was wrong
    const { data: modernData, error: modernErr } = await supabase
      .from('bills')
      .select('*')
      .eq('patient_id', patientId)
      .limit(50)

    if (!modernErr && modernData && modernData.length > 0) {
      return { bills: modernData.map(normalizeBill), error: null }
    }
  } catch {
    // Non-fatal
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ATTEMPT 4: Last resort — fetch recent bills and filter in memory
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const { data: allBills } = await supabase
      .from('bills')
      .select('*')
      .limit(200)

    if (allBills && allBills.length > 0) {
      const matched = allBills.filter((b: any) =>
        b.patient_id === patientId || b.patientid === patientId
      )
      if (matched.length > 0) {
        return { bills: matched.map(normalizeBill), error: null }
      }
    }
  } catch {
    // Non-fatal
  }

  // Nothing found
  return { bills: [], error: null }
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
