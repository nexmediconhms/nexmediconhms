/**
 * src/lib/insurance-sync.ts
 *
 * Client-side helper for insurance patient list synchronization.
 *
 * PROBLEM FIXED:
 *   When a patient selects an insurance provider/plan during admission or
 *   checkout, they failed to appear in the global "Insured Patient List"
 *   because:
 *     1. The DB query used boolean comparisons on TEXT fields
 *     2. Fields set during admission (insurance_name, insurance_id) were
 *        not checked in the insured patients query
 *     3. No real-time notification was triggered when insurance fields changed
 *
 * SOLUTION:
 *   This module provides a `syncInsurancePatient()` function that should be
 *   called IMMEDIATELY after any patient update that touches insurance fields.
 *   It calls the POST /api/insurance/patients endpoint which:
 *     1. Updates the patient record to normalize insurance field values
 *     2. Triggers a Postgres NOTIFY so real-time listeners refresh
 *     3. Returns confirmation that the patient is now in the insured list
 *
 * USAGE:
 *   import { syncInsurancePatient } from '@/lib/insurance-sync'
 *
 *   // After saving patient with insurance during registration:
 *   await syncInsurancePatient(patientId, {
 *     mediclaim: true,
 *     policy_tpa_name: 'Medi Assist',
 *     policy_number: 'POL-12345',
 *   })
 *
 *   // After checkout with insurance selection:
 *   await syncInsurancePatient(patientId, {
 *     cashless: true,
 *     insurance_name: 'Star Health',
 *     insurance_id: 'SH-98765',
 *   })
 */

import { supabase } from '@/lib/supabase'

export interface InsuranceData {
  mediclaim?: boolean
  cashless?: boolean
  policy_tpa_name?: string
  policy_number?: string
  insurance_name?: string
  insurance_id?: string
}

export interface SyncResult {
  ok: boolean
  patient_id?: string
  patient_name?: string
  is_insured?: boolean
  message?: string
  error?: string
}

/**
 * Sync a patient's insurance data to ensure they appear in the Insured Patient List.
 * Call this after any update to a patient's insurance fields.
 */
export async function syncInsurancePatient(
  patientId: string,
  insuranceData?: InsuranceData
): Promise<SyncResult> {
  try {
    // If insurance data is provided, also update the patient directly
    // for immediate local consistency
    if (insuranceData) {
      const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() }

      if (insuranceData.mediclaim !== undefined) {
        updatePayload.mediclaim = insuranceData.mediclaim ? 'Yes' : 'No'
      }
      if (insuranceData.cashless !== undefined) {
        updatePayload.cashless = insuranceData.cashless ? 'Yes' : 'No'
      }
      if (insuranceData.policy_tpa_name !== undefined) {
        updatePayload.policy_tpa_name = insuranceData.policy_tpa_name || null
      }
      if (insuranceData.policy_number !== undefined) {
        updatePayload.policy_number = insuranceData.policy_number || null
      }
      if (insuranceData.insurance_name !== undefined) {
        updatePayload.insurance_name = insuranceData.insurance_name || null
      }
      if (insuranceData.insurance_id !== undefined) {
        updatePayload.insurance_id = insuranceData.insurance_id || null
      }

      const { error } = await supabase
        .from('patients')
        .update(updatePayload)
        .eq('id', patientId)

      if (error) {
        console.error('[insurance-sync] Direct update failed:', error.message)
        // Don't return — try the API call anyway
      }
    }

    // Call the API endpoint which also handles notification triggers
    const res = await fetch('/api/insurance/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id: patientId,
        insurance_data: insuranceData,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, error: data.error || `HTTP ${res.status}` }
    }

    const data = await res.json()
    return {
      ok: true,
      patient_id: data.patient_id,
      patient_name: data.patient_name,
      is_insured: data.is_insured,
      message: data.message,
    }
  } catch (err: any) {
    console.error('[insurance-sync] Error:', err)
    return { ok: false, error: err.message || 'Network error' }
  }
}

/**
 * Check if a patient is currently marked as insured.
 * Uses the same logic as the server-side query.
 */
export function isPatientInsured(patient: Record<string, any>): boolean {
  const mediclaim = String(patient.mediclaim || '').trim().toLowerCase()
  const cashless = String(patient.cashless || '').trim().toLowerCase()

  return (
    mediclaim === 'yes' || mediclaim === 'true' ||
    cashless === 'yes' || cashless === 'true' ||
    !!(patient.policy_tpa_name && String(patient.policy_tpa_name).trim()) ||
    !!(patient.insurance_name && String(patient.insurance_name).trim()) ||
    !!(patient.insurance_id && String(patient.insurance_id).trim())
  )
}

/**
 * Subscribe to insurance patient updates via Supabase Realtime.
 * Returns an unsubscribe function.
 */
export function subscribeToInsuranceUpdates(
  onUpdate: (payload: { patient_id: string; event: string }) => void
): () => void {
  const channel = supabase
    .channel('insurance-patient-updates')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'patients',
      // We can't filter by specific columns in Supabase realtime,
      // so we'll receive all patient updates and filter client-side
    }, (payload) => {
      const newRecord = payload.new as Record<string, any>
      const oldRecord = payload.old as Record<string, any>

      // Check if insurance-related fields changed
      const insuranceFields = ['mediclaim', 'cashless', 'policy_tpa_name', 'policy_number', 'insurance_name', 'insurance_id']
      const changed = insuranceFields.some(field =>
        String(newRecord[field] || '') !== String(oldRecord[field] || '')
      )

      if (changed) {
        onUpdate({
          patient_id: newRecord.id,
          event: 'patient_insurance_updated',
        })
      }
    })
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}