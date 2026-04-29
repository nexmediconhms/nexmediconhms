/**
 * src/lib/allergy-alerts.ts
 *
 * Allergy Alert System with Cross-Reactivity Checking
 *
 * When a doctor prescribes a medication, this module checks:
 *   1. Direct match — patient allergic to "Amoxicillin", doctor prescribes "Amoxicillin"
 *   2. Cross-reactivity — patient allergic to "Penicillin", doctor prescribes "Amoxicillin"
 *      (Amoxicillin IS a penicillin → 10% cross-reactivity)
 *   3. Class-level — patient allergic to "NSAIDs", doctor prescribes "Ibuprofen"
 *
 * Hard Stop: For severe/life-threatening allergies, the system BLOCKS the prescription
 * and requires the doctor to explicitly acknowledge the risk with a documented reason.
 */

import { supabase } from './supabase'

// ─── Types ────────────────────────────────────────────────────

export type AllergySeverity = 'mild' | 'moderate' | 'severe' | 'life-threatening'

export interface PatientAllergy {
  id: string
  patient_id: string
  allergen: string
  allergen_type: 'drug' | 'food' | 'environmental'
  reaction: string
  severity: AllergySeverity
  confirmed: boolean
}

export interface AllergyAlert {
  type: 'direct' | 'cross-reactivity' | 'class'
  allergen: string           // what the patient is allergic to
  prescribedDrug: string     // what the doctor is trying to prescribe
  severity: AllergySeverity
  reaction: string
  crossReactivityRate?: string  // e.g., "~10% cross-reactivity"
  explanation: string
  isHardStop: boolean        // true = must acknowledge before proceeding
}

export interface AllergyCheckResult {
  hasAlerts: boolean
  hasHardStop: boolean       // at least one alert requires acknowledgment
  alerts: AllergyAlert[]
}

// ─── Cross-Reactivity Database ────────────────────────────────
// Maps allergen classes to their member drugs and cross-reactivity info

interface DrugClass {
  className: string
  members: string[]          // drug names that belong to this class
  crossReactsWith?: {
    className: string
    rate: string             // e.g., "~10%", "~2-5%"
    explanation: string
  }[]
}

const DRUG_CLASSES: DrugClass[] = [
  {
    className: 'Penicillins',
    members: [
      'penicillin', 'amoxicillin', 'ampicillin', 'amoxyclav', 'augmentin',
      'piperacillin', 'tazobactam', 'piperacillin-tazobactam', 'flucloxacillin',
      'cloxacillin', 'dicloxacillin', 'nafcillin', 'oxacillin', 'benzylpenicillin',
      'phenoxymethylpenicillin', 'penicillin v', 'penicillin g', 'co-amoxiclav',
    ],
    crossReactsWith: [
      {
        className: 'Cephalosporins',
        rate: '~2-5%',
        explanation: 'Cephalosporins share the beta-lactam ring with penicillins. Cross-reactivity is ~2-5% (higher with 1st gen cephalosporins).',
      },
      {
        className: 'Carbapenems',
        rate: '~1%',
        explanation: 'Carbapenems share the beta-lactam ring. Cross-reactivity is low (~1%) but can be severe.',
      },
    ],
  },
  {
    className: 'Cephalosporins',
    members: [
      'cephalexin', 'cefadroxil', 'cefazolin',           // 1st gen
      'cefuroxime', 'cefaclor', 'cefprozil',              // 2nd gen
      'ceftriaxone', 'cefotaxime', 'cefixime', 'cefpodoxime', 'ceftazidime', // 3rd gen
      'cefepime',                                          // 4th gen
      'ceftaroline',                                       // 5th gen
    ],
    crossReactsWith: [
      {
        className: 'Penicillins',
        rate: '~2-5%',
        explanation: 'Penicillin-allergic patients have ~2-5% chance of cephalosporin allergy (higher with 1st gen).',
      },
    ],
  },
  {
    className: 'Carbapenems',
    members: ['meropenem', 'imipenem', 'ertapenem', 'doripenem'],
    crossReactsWith: [
      {
        className: 'Penicillins',
        rate: '~1%',
        explanation: 'Low cross-reactivity with penicillins, but reactions can be severe.',
      },
    ],
  },
  {
    className: 'Sulfonamides',
    members: [
      'sulfamethoxazole', 'trimethoprim-sulfamethoxazole', 'cotrimoxazole',
      'septran', 'bactrim', 'sulfasalazine', 'sulfadiazine', 'dapsone',
    ],
    crossReactsWith: [
      {
        className: 'Sulfonamide Diuretics',
        rate: '~10%',
        explanation: 'Thiazide diuretics contain a sulfonamide moiety. Cross-reactivity is debated but possible.',
      },
    ],
  },
  {
    className: 'Sulfonamide Diuretics',
    members: [
      'hydrochlorothiazide', 'chlorthalidone', 'indapamide',
      'furosemide', 'bumetanide', 'torsemide',
    ],
  },
  {
    className: 'NSAIDs',
    members: [
      'aspirin', 'ibuprofen', 'diclofenac', 'naproxen', 'piroxicam',
      'meloxicam', 'indomethacin', 'ketorolac', 'mefenamic acid',
      'aceclofenac', 'etoricoxib', 'celecoxib', 'nimesulide',
    ],
    crossReactsWith: [
      {
        className: 'COX-2 Inhibitors',
        rate: '~2-4%',
        explanation: 'COX-2 selective inhibitors have lower but non-zero cross-reactivity with traditional NSAIDs.',
      },
    ],
  },
  {
    className: 'COX-2 Inhibitors',
    members: ['celecoxib', 'etoricoxib', 'rofecoxib'],
  },
  {
    className: 'Fluoroquinolones',
    members: [
      'ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'norfloxacin',
      'ofloxacin', 'gatifloxacin', 'sparfloxacin',
    ],
  },
  {
    className: 'Macrolides',
    members: ['erythromycin', 'azithromycin', 'clarithromycin', 'roxithromycin'],
  },
  {
    className: 'Tetracyclines',
    members: ['tetracycline', 'doxycycline', 'minocycline', 'tigecycline'],
  },
  {
    className: 'Aminoglycosides',
    members: ['gentamicin', 'amikacin', 'tobramycin', 'streptomycin', 'neomycin'],
  },
  {
    className: 'Opioids',
    members: [
      'morphine', 'codeine', 'tramadol', 'fentanyl', 'oxycodone',
      'hydrocodone', 'pethidine', 'meperidine', 'buprenorphine',
    ],
    crossReactsWith: [
      {
        className: 'Opioids',
        rate: '~15-20%',
        explanation: 'Cross-reactivity between opioids is common. Morphine and codeine are most cross-reactive.',
      },
    ],
  },
  {
    className: 'Local Anaesthetics (Amide)',
    members: ['lidocaine', 'lignocaine', 'bupivacaine', 'ropivacaine', 'mepivacaine'],
  },
  {
    className: 'Local Anaesthetics (Ester)',
    members: ['procaine', 'benzocaine', 'tetracaine', 'chloroprocaine'],
  },
  {
    className: 'ACE Inhibitors',
    members: ['enalapril', 'ramipril', 'lisinopril', 'perindopril', 'captopril', 'trandolapril'],
  },
  {
    className: 'Statins',
    members: ['atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin', 'fluvastatin'],
  },
]

// ─── Allergy Checker ──────────────────────────────────────────

/**
 * Normalize drug name for matching.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\d+\s*(mg|mcg|g|ml|iu|units?)\b/gi, '')
    .replace(/\b(tablet|capsule|syrup|injection|cream|ointment|drops|sr|er|cr|xl|od)\b/gi, '')
    .replace(/[^a-z\s-]/g, '')
    .trim()
}

/**
 * Find which drug class(es) a drug belongs to.
 */
function findDrugClasses(drugName: string): DrugClass[] {
  const norm = normalize(drugName)
  return DRUG_CLASSES.filter(dc =>
    dc.members.some(m => norm.includes(m) || m.includes(norm))
  )
}

/**
 * Check a list of prescribed drugs against a patient's known allergies.
 *
 * @param prescribedDrugs - Drug names being prescribed
 * @param allergies - Patient's known allergies
 * @returns AllergyCheckResult with all alerts
 */
export function checkAllergies(
  prescribedDrugs: string[],
  allergies: PatientAllergy[]
): AllergyCheckResult {
  const alerts: AllergyAlert[] = []

  for (const drug of prescribedDrugs) {
    const normDrug = normalize(drug)
    const drugClasses = findDrugClasses(drug)

    for (const allergy of allergies) {
      if (allergy.allergen_type !== 'drug') continue

      const normAllergen = normalize(allergy.allergen)
      const allergenClasses = findDrugClasses(allergy.allergen)

      // 1. Direct match
      if (normDrug.includes(normAllergen) || normAllergen.includes(normDrug)) {
        alerts.push({
          type: 'direct',
          allergen: allergy.allergen,
          prescribedDrug: drug,
          severity: allergy.severity as AllergySeverity,
          reaction: allergy.reaction || 'Unknown reaction',
          explanation: `Patient has a documented ${allergy.severity} allergy to ${allergy.allergen}. ${drug} IS ${allergy.allergen}.`,
          isHardStop: allergy.severity === 'severe' || allergy.severity === 'life-threatening',
        })
        continue
      }

      // 2. Same class (e.g., both are penicillins)
      for (const dc of drugClasses) {
        for (const ac of allergenClasses) {
          if (dc.className === ac.className) {
            alerts.push({
              type: 'class',
              allergen: allergy.allergen,
              prescribedDrug: drug,
              severity: allergy.severity as AllergySeverity,
              reaction: allergy.reaction || 'Unknown reaction',
              explanation: `Patient is allergic to ${allergy.allergen} (${ac.className}). ${drug} is also a ${dc.className} — same drug class.`,
              isHardStop: allergy.severity === 'severe' || allergy.severity === 'life-threatening',
            })
          }
        }
      }

      // 3. Cross-reactivity between classes
      for (const dc of drugClasses) {
        for (const ac of allergenClasses) {
          const crossReact = ac.crossReactsWith?.find(cr => cr.className === dc.className)
          if (crossReact) {
            alerts.push({
              type: 'cross-reactivity',
              allergen: allergy.allergen,
              prescribedDrug: drug,
              severity: allergy.severity as AllergySeverity,
              reaction: allergy.reaction || 'Unknown reaction',
              crossReactivityRate: crossReact.rate,
              explanation: crossReact.explanation,
              isHardStop: allergy.severity === 'life-threatening',
            })
          }
        }
      }
    }
  }

  // Deduplicate
  const unique = alerts.filter((alert, idx) =>
    alerts.findIndex(a =>
      a.allergen === alert.allergen &&
      a.prescribedDrug === alert.prescribedDrug &&
      a.type === alert.type
    ) === idx
  )

  return {
    hasAlerts: unique.length > 0,
    hasHardStop: unique.some(a => a.isHardStop),
    alerts: unique,
  }
}

// ─── Fetch Patient Allergies ──────────────────────────────────

/**
 * Fetch all allergies for a patient from Supabase.
 */
export async function fetchPatientAllergies(patientId: string): Promise<PatientAllergy[]> {
  try {
    const { data, error } = await supabase
      .from('patient_allergies')
      .select('*')
      .eq('patient_id', patientId)
      .order('severity', { ascending: false })

    if (error) {
      console.warn('[Allergy] Failed to fetch allergies:', error.message)
      return []
    }

    return (data || []) as PatientAllergy[]
  } catch {
    return []
  }
}

/**
 * Add a new allergy for a patient.
 */
export async function addPatientAllergy(allergy: Omit<PatientAllergy, 'id'>): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('patient_allergies')
      .insert(allergy)

    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/**
 * Get allergy severity badge styling.
 */
export function allergySeverityStyle(severity: AllergySeverity): {
  bg: string; text: string; border: string; icon: string
} {
  switch (severity) {
    case 'life-threatening':
      return { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300', icon: '☠️' }
    case 'severe':
      return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: '🚨' }
    case 'moderate':
      return { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', icon: '⚠️' }
    case 'mild':
      return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: 'ℹ️' }
  }
}
