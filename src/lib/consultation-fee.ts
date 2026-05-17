/**
 * src/lib/consultation-fee.ts
 *
 * Consultation Fee Logic:
 *   - NEW patient (first ever encounter/case): ₹500 (configurable via settings.feeOPD)
 *   - EXISTING patient (already has encounters in DB): ₹300 (configurable via settings.feeFollowUp)
 *
 * This module checks whether a patient has had prior encounters (cases)
 * in the system. If they have, the fee is the follow-up rate.
 * If this is their first ever case, the full consultation fee applies.
 */

import { supabase } from './supabase'
import { loadSettings } from './settings'

export interface ConsultationFeeResult {
  fee: number
  feeLabel: string
  isExistingPatient: boolean
  encounterCount: number
}

/**
 * Determine the consultation fee for a patient based on their history.
 *
 * @param patientId - The patient's UUID
 * @returns ConsultationFeeResult with fee amount and metadata
 */
export async function getConsultationFee(patientId: string): Promise<ConsultationFeeResult> {
  const settings = loadSettings()
  const newPatientFee = Number(settings.feeOPD) || 500
  const existingPatientFee = Number(settings.feeFollowUp) || 300

  try {
    // Count how many encounters (cases) this patient already has
    const { count, error } = await supabase
      .from('encounters')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)

    if (error) {
      console.warn('[consultation-fee] Error checking encounters:', error.message)
      // Default to new patient fee on error
      return {
        fee: newPatientFee,
        feeLabel: 'OPD Consultation (New Patient)',
        isExistingPatient: false,
        encounterCount: 0,
      }
    }

    const encounterCount = count ?? 0
    const isExistingPatient = encounterCount > 0

    return {
      fee: isExistingPatient ? existingPatientFee : newPatientFee,
      feeLabel: isExistingPatient
        ? `Follow-up Consultation (Visit #${encounterCount + 1})`
        : 'OPD Consultation (New Patient)',
      isExistingPatient,
      encounterCount,
    }
  } catch (err) {
    console.warn('[consultation-fee] Unexpected error:', err)
    return {
      fee: newPatientFee,
      feeLabel: 'OPD Consultation (New Patient)',
      isExistingPatient: false,
      encounterCount: 0,
    }
  }
}

/**
 * Synchronous version using cached encounter count (for UI display).
 * Call getConsultationFee() for the async/accurate version.
 */
export function getStaticFee(isExistingPatient: boolean): { fee: number; label: string } {
  const settings = loadSettings()
  const newFee = Number(settings.feeOPD) || 500
  const followUpFee = Number(settings.feeFollowUp) || 300

  return {
    fee: isExistingPatient ? followUpFee : newFee,
    label: isExistingPatient ? 'Follow-up Consultation' : 'OPD Consultation (New)',
  }
}
