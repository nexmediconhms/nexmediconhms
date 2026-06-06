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
 * Load bills for a patient, adapting to the detected schema
 */
export async function loadPatientBills(patientId: string) {
  const schema = await detectBillingSchema()

  const { data, error } = await supabase
    .from('bills')
    .select('*')  // Use * to avoid column name issues
    .eq(schema.patient_id, patientId)
    .order(schema.created_at, { ascending: false })
    .limit(50)

  if (error) {
    console.error('[billing-helpers] loadPatientBills error:', error.message)
    return { bills: [], error }
  }

  // Normalize the response to always use snake_case keys for the UI
  const normalizedBills = (data || []).map(bill => ({
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
