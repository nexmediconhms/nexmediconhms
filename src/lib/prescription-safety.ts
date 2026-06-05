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
  //
  // ─────────────────────────────────────────────────────────────────
  // FIX (2026-06-05) — compatible with both old and new dose-validation.ts
  //
  // Earlier, an attempt to thread `pregnancyStatus` through to
  // validateDose() introduced a 6th argument to the call:
  //     validateDose(drug, dose, freq, age, weight, { pregnancyStatus })
  // That depended on a separate update to src/lib/dose-validation.ts
  // (BUG-D03 fix) which adds an `opts` parameter.  When the two files
  // were out of sync — e.g. on a partial merge or when one fix was
  // pulled without the other — TypeScript reported:
  //     "Expected 2-5 arguments, but got 6."
  // on the validateDose() call site (around lines 128 / 138 depending
  // on whitespace).
  //
  // RESOLUTION:
  //   1. Call validateDose with the ORIGINAL 5-argument signature so
  //      this file compiles regardless of which version of
  //      dose-validation.ts is in the repo.
  //   2. Keep the new 'pregnancy' level/category mapping below with
  //      `String(da.level)` widening — that way it acts as forward-
  //      compat code (lights up automatically once dose-validation.ts
  //      gets the BUG-D03 update which introduces the new level), and
  //      acts as a harmless no-op until then.
  //   3. The Category-X / Category-D pregnancy warning is still raised
  //      separately by the dedicated block (Section 4 below) when
  //      input.isPregnant === true, so we don't lose that signal by
  //      dropping the opts argument here.
  // ─────────────────────────────────────────────────────────────────
  try {
    for (const med of validMeds) {
      if (!med.dose.trim()) continue

      const doseAlerts = validateDose(
        med.drug,
        med.dose,
        med.frequency || 'Once daily',
        input.patientAge,
        input.patientWeight,
      )

      for (const da of doseAlerts) {
        // Widen the level to string so we can safely test for the new
        // 'pregnancy' value without TypeScript narrowing the union to
        // a set that doesn't include it.  When dose-validation.ts has
        // the old DoseAlertLevel union ('overdose'|'high'|'low'|'pediatric')
        // the 'pregnancy' branch simply never fires, which is correct.
        const level: string = String((da as { level: string }).level)

        let clinicalLevel: 'critical' | 'major' | 'moderate' | 'minor'
        if (level === 'overdose') {
          clinicalLevel = 'critical'
        } else if (level === 'pregnancy') {
          // Confirmed pregnancy + Cat X → critical hard-stop.
          // Unknown / unconfirmed pregnancy → major (still prominent).
          clinicalLevel = da.isHardStop ? 'critical' : 'major'
        } else if (level === 'high') {
          clinicalLevel = 'major'
        } else {
          clinicalLevel = 'moderate'
        }

        alerts.push({
          id: `dose-${med.drug}-${level}`,
          level: clinicalLevel,
          category: level === 'pregnancy' ? 'pregnancy' : 'dose',
          title:
            level === 'pregnancy'
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