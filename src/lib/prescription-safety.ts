/**
 * src/lib/prescription-safety.ts
 *
 * Prescription Safety Orchestrator
 *
 * Runs ALL clinical safety checks before a prescription is saved:
 *   1. Drug-drug interactions
 *   2. Allergy cross-reactivity
 *   3. Dose range validation
 *   4. Pregnancy category warnings
 *
 * Returns a unified list of ClinicalAlerts for the safety modal.
 */

import { checkDrugInteractions } from './drug-interactions'
import { checkAllergies, fetchPatientAllergies } from './allergy-alerts'
import { validateDose } from './dose-validation'
import type { ClinicalAlert } from '@/components/clinical/ClinicalSafetyModal'
import type { Medication } from '@/types'

// ─── Types ────────────────────────────────────────────────────

export interface SafetyCheckInput {
  medications: Medication[]
  patientId: string
  patientAge?: number
  patientWeight?: number
  isPregnant?: boolean
  gestationalAge?: string
}

export interface SafetyCheckResult {
  hasAlerts: boolean
  hasHardStop: boolean
  alerts: ClinicalAlert[]
}

// ─── Main Safety Check ────────────────────────────────────────

/**
 * Run all prescription safety checks.
 * Call this before saving a prescription.
 */
export async function runPrescriptionSafetyChecks(
  input: SafetyCheckInput
): Promise<SafetyCheckResult> {
  const alerts: ClinicalAlert[] = []
  const validMeds = input.medications.filter(m => m.drug.trim())
  const drugNames = validMeds.map(m => m.drug.trim())

  if (drugNames.length === 0) {
    return { hasAlerts: false, hasHardStop: false, alerts: [] }
  }

  // 1. Drug-Drug Interactions
  try {
    const interactions = checkDrugInteractions(drugNames)
    if (interactions.hasInteractions) {
      for (const ix of interactions.all) {
        alerts.push({
          id: `interaction-${ix.drugA}-${ix.drugB}`,
          level: ix.severity === 'critical' ? 'critical' : ix.severity === 'major' ? 'major' : ix.severity === 'moderate' ? 'moderate' : 'minor',
          category: 'drug-interaction',
          title: `${ix.drugA} + ${ix.drugB}`,
          message: ix.description,
          details: `Mechanism: ${ix.mechanism}. Effect: ${ix.clinicalEffect}`,
          action: ix.management,
          isHardStop: ix.severity === 'critical',
        })
      }
    }
  } catch (err) {
    console.warn('[Safety] Drug interaction check failed:', err)
  }

  // 2. Allergy Checks — fetch patient allergies then check
  try {
    const patientAllergies = await fetchPatientAllergies(input.patientId)
    if (patientAllergies.length > 0) {
      const allergyResult = checkAllergies(drugNames, patientAllergies)
      if (allergyResult.hasAlerts) {
        for (const alert of allergyResult.alerts) {
          alerts.push({
            id: `allergy-${alert.allergen}-${alert.prescribedDrug}`,
            level: alert.severity === 'life-threatening' ? 'critical' : alert.severity === 'severe' ? 'major' : 'moderate',
            category: 'allergy',
            title: `Allergy: ${alert.allergen} → ${alert.prescribedDrug}`,
            message: alert.explanation,
            details: alert.crossReactivityRate
              ? `Cross-reactivity: ${alert.crossReactivityRate}. Reaction: ${alert.reaction}`
              : `Known reaction: ${alert.reaction}`,
            action: alert.isHardStop
              ? 'STOP: Do NOT prescribe this medication. Choose an alternative.'
              : 'Monitor closely. Consider alternative if available.',
            isHardStop: alert.isHardStop,
          })
        }
      }
    }
  } catch (err) {
    console.warn('[Safety] Allergy check failed:', err)
  }

  // 3. Dose Validation
  try {
    // BUG-D03 follow-up: pass through the patient's pregnancy status so
    // validateDose's Category-X warning is properly contextualised.  When
    // input.isPregnant is undefined we treat it as 'unknown' (fail-safe:
    // the warning still fires, with isHardStop=false).
    const pregnancyStatus =
      input.isPregnant === true
        ? 'pregnant'
        : input.isPregnant === false
          ? 'not_pregnant'
          : 'unknown'

    for (const med of validMeds) {
      if (!med.dose.trim()) continue

      const doseAlerts = validateDose(
        med.drug,
        med.dose,
        med.frequency || 'Once daily',
        input.patientAge,
        input.patientWeight,
        { pregnancyStatus },
      )

      for (const da of doseAlerts) {
        // Map dose-validation level → ClinicalAlert level.
        // BUG-D03 follow-up: 'pregnancy' is a new level introduced when
        // the Category-X warning was decoupled from 'overdose'.  Without
        // this branch it would fall through to 'moderate', under-stating
        // the severity for a confirmed pregnancy + Category-X drug.
        let clinicalLevel: 'critical' | 'major' | 'moderate' | 'minor'
        if (da.level === 'overdose') {
          clinicalLevel = 'critical'
        } else if (da.level === 'pregnancy') {
          // Confirmed pregnancy + Cat X → critical hard-stop.
          // Unknown / unconfirmed → major (still prominent, not blocking).
          clinicalLevel = da.isHardStop ? 'critical' : 'major'
        } else if (da.level === 'high') {
          clinicalLevel = 'major'
        } else {
          clinicalLevel = 'moderate'
        }

        alerts.push({
          id: `dose-${med.drug}-${da.level}`,
          level: clinicalLevel,
          category: da.level === 'pregnancy' ? 'pregnancy' : 'dose',
          title:
            da.level === 'pregnancy'
              ? `Pregnancy: ${da.drug}`
              : `Dose Alert: ${da.drug}`,
          message: da.message,
          details: `Safe range: ${da.safeRange}. Max dose: ${da.maxDose}`,
          action: da.recommendation,
          isHardStop: da.isHardStop,
        })
      }
    }
  } catch (err) {
    console.warn('[Safety] Dose validation failed:', err)
  }

  // 4. Pregnancy Category Warnings
  if (input.isPregnant) {
    try {
      const { getAllDrugsSync } = await import('./drug-database')
      const allDrugs = getAllDrugsSync()
      for (const med of validMeds) {
        const drugName = med.drug.toLowerCase()
        const dbEntry = allDrugs.find(d =>
          d.generic.toLowerCase().includes(drugName) ||
          d.brands.some(b => b.toLowerCase().includes(drugName))
        )
        if (dbEntry && (dbEntry.pregnancyCategory === 'D' || dbEntry.pregnancyCategory === 'X')) {
          alerts.push({
            id: `pregnancy-${med.drug}`,
            level: dbEntry.pregnancyCategory === 'X' ? 'critical' : 'major',
            category: 'pregnancy',
            title: `Pregnancy Category ${dbEntry.pregnancyCategory}: ${dbEntry.generic}`,
            message: dbEntry.pregnancyCategory === 'X'
              ? `${dbEntry.generic} is CONTRAINDICATED in pregnancy (Category X). Known to cause fetal harm.`
              : `${dbEntry.generic} is Category D — evidence of fetal risk. Use only if benefit outweighs risk.`,
            details: dbEntry.notes || undefined,
            action: dbEntry.pregnancyCategory === 'X'
              ? 'DO NOT prescribe. Choose a pregnancy-safe alternative.'
              : 'Document clinical justification. Discuss risks with patient.',
            isHardStop: dbEntry.pregnancyCategory === 'X',
          })
        }
      }
    } catch (err) {
      console.warn('[Safety] Pregnancy check failed:', err)
    }
  }

  // Deduplicate by id
  const uniqueAlerts = Array.from(new Map(alerts.map(a => [a.id, a])).values())

  return {
    hasAlerts: uniqueAlerts.length > 0,
    hasHardStop: uniqueAlerts.some(a => a.isHardStop),
    alerts: uniqueAlerts,
  }
}
