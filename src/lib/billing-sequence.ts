/**
 * src/lib/billing-sequence.ts
 *
 * Client-side helper for the sequential bill generation API.
 * Used by billing/page.tsx and IPD pages to generate bills with proper
 * sequential invoice numbers and automatic finance sync.
 *
 * This replaces the direct `supabase.from('bills').insert(...)` pattern
 * with an API call that:
 *   1. Assigns a sequential invoice number (OPD-YYYYMM-XXXX / IPD-YYYYMM-XXXX)
 *   2. Handles concurrency via advisory locks
 *   3. Auto-syncs to the hospital_fund finance ledger
 *   4. Supports IPD bill + receipt generation in one call
 *   5. Supports idempotency keys to prevent double-billing
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────

export type BillModule = 'OPD' | 'IPD'
export type BillStatus = 'paid' | 'pending' | 'partial'

export interface GenerateBillRequest {
  module: BillModule
  patient_id: string
  patient_name: string
  mrn?: string
  items: { label: string; amount: number }[]
  subtotal: number
  discount?: number
  gst_percent?: number
  gst_amount?: number
  net_amount: number
  payment_mode?: 'cash' | 'upi' | 'card' | 'insurance' | 'other'
  status?: BillStatus
  notes?: string
  encounter_id?: string
  admission_id?: string
  razorpay_payment_id?: string
  // IPD-specific
  generate_receipt?: boolean
  receipt_amount?: number
  // Idempotency
  idempotency_key?: string
}

export interface GenerateBillResponse {
  success: boolean
  bill?: any
  invoice_number?: string
  module?: string
  receipt?: any
  message?: string
  error?: string
  idempotent?: boolean
}

export interface DeleteBillResponse {
  success: boolean
  message?: string
  error?: string
  deleted_bill?: {
    id: string
    invoice_number: string
    net_amount: number
  }
}

// ── Generate a unique idempotency key ────────────────────────────
export function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ── Get auth token from Supabase session ─────────────────────────
async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

// ── Generate Bill (POST /api/billing/generate-bill) ──────────────
export async function generateSequentialBill(
  request: GenerateBillRequest
): Promise<GenerateBillResponse> {
  const token = await getAuthToken()
  if (!token) {
    return { success: false, error: 'Not authenticated. Please log in.' }
  }

  try {
    const res = await fetch('/api/billing/generate-bill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    })

    const data = await res.json()

    if (!res.ok) {
      return { success: false, error: data.error || `HTTP ${res.status}` }
    }

    return data as GenerateBillResponse
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' }
  }
}

// ── Delete Bill (DELETE /api/billing/generate-bill?billId=xxx) ────
export async function deleteSequentialBill(billId: string): Promise<DeleteBillResponse> {
  const token = await getAuthToken()
  if (!token) {
    return { success: false, error: 'Not authenticated. Please log in.' }
  }

  try {
    const res = await fetch(`/api/billing/generate-bill?billId=${encodeURIComponent(billId)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    const data = await res.json()

    if (!res.ok) {
      return { success: false, error: data.error || `HTTP ${res.status}` }
    }

    return data as DeleteBillResponse
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' }
  }
}

// ── Convenience: Generate OPD Bill ───────────────────────────────
export async function generateOPDBill(params: Omit<GenerateBillRequest, 'module'>): Promise<GenerateBillResponse> {
  return generateSequentialBill({ ...params, module: 'OPD' })
}

// ── Convenience: Generate IPD Bill with Receipt ──────────────────
export async function generateIPDBill(params: Omit<GenerateBillRequest, 'module'>): Promise<GenerateBillResponse> {
  return generateSequentialBill({
    ...params,
    module: 'IPD',
    generate_receipt: true,
    receipt_amount: params.receipt_amount || params.net_amount,
  })
}