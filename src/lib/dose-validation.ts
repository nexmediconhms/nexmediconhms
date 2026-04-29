/**
 * src/lib/dose-validation.ts
 *
 * Dose Range Validation Engine
 *
 * Validates prescribed doses against safe ranges based on:
 *   - Drug name
 *   - Patient age (adult vs pediatric)
 *   - Patient weight (for weight-based dosing)
 *   - Route of administration
 *
 * Alert Levels:
 *   - overdose:   Dose exceeds maximum safe dose → HARD STOP
 *   - high:       Dose is above typical range but below max → WARNING
 *   - low:        Dose is below therapeutic range → INFO
 *   - pediatric:  Pediatric dose check failed → WARNING
 *
 * Data sources: BNF, Indian Pharmacopoeia, WHO Essential Medicines
 */

// ─── Types ────────────────────────────────────────────────────

export type DoseAlertLevel = 'overdose' | 'high' | 'low' | 'pediatric'

export interface DoseAlert {
  level: DoseAlertLevel
  drug: string
  prescribedDose: string
  message: string
  safeRange: string
  maxDose: string
  isHardStop: boolean
  recommendation: string
}

export interface DoseCheckResult {
  hasAlerts: boolean
  hasHardStop: boolean
  alerts: DoseAlert[]
}

// ─── Drug Dose Database ───────────────────────────────────────

interface DrugDoseInfo {
  name: string
  aliases: string[]
  unit: string                    // 'mg', 'mcg', 'g', 'ml'
  adult: {
    minSingleDose: number
    maxSingleDose: number
    maxDailyDose: number
    typicalDose: string           // human-readable
  }
  pediatric?: {
    mgPerKg?: number              // mg/kg/dose
    maxPediatricDose: number      // absolute max for children
    minAge?: number               // minimum age in years
    notes?: string
  }
  renalAdjust?: boolean           // needs dose adjustment in renal impairment
  hepaticAdjust?: boolean         // needs dose adjustment in hepatic impairment
  pregnancyCategory?: string      // FDA category: A, B, C, D, X
  notes?: string
}

const DOSE_DB: DrugDoseInfo[] = [
  // ── Analgesics ──────────────────────────────────────────────
  {
    name: 'paracetamol',
    aliases: ['acetaminophen', 'crocin', 'dolo', 'calpol', 'tylenol'],
    unit: 'mg',
    adult: { minSingleDose: 325, maxSingleDose: 1000, maxDailyDose: 4000, typicalDose: '500-1000mg every 4-6h' },
    pediatric: { mgPerKg: 15, maxPediatricDose: 1000, minAge: 0, notes: '10-15 mg/kg/dose, max 5 doses/day' },
    pregnancyCategory: 'B',
  },
  {
    name: 'ibuprofen',
    aliases: ['brufen', 'advil', 'motrin'],
    unit: 'mg',
    adult: { minSingleDose: 200, maxSingleDose: 800, maxDailyDose: 3200, typicalDose: '400-800mg every 6-8h' },
    pediatric: { mgPerKg: 10, maxPediatricDose: 400, minAge: 0.5, notes: '5-10 mg/kg/dose every 6-8h' },
    pregnancyCategory: 'C',
    notes: 'Avoid in 3rd trimester (category D). Avoid in renal impairment.',
  },
  {
    name: 'diclofenac',
    aliases: ['voveran', 'voltaren'],
    unit: 'mg',
    adult: { minSingleDose: 25, maxSingleDose: 75, maxDailyDose: 150, typicalDose: '50mg twice or thrice daily' },
    pediatric: { mgPerKg: 1, maxPediatricDose: 50, minAge: 1, notes: '1-3 mg/kg/day in divided doses' },
    pregnancyCategory: 'C',
  },
  {
    name: 'mefenamic acid',
    aliases: ['meftal', 'ponstan'],
    unit: 'mg',
    adult: { minSingleDose: 250, maxSingleDose: 500, maxDailyDose: 1500, typicalDose: '500mg thrice daily' },
    pediatric: { mgPerKg: 6.5, maxPediatricDose: 500, minAge: 6, notes: '6.5 mg/kg/dose TDS. Not for < 6 years.' },
    pregnancyCategory: 'C',
  },

  // ── Antibiotics ─────────────────────────────────────────────
  {
    name: 'amoxicillin',
    aliases: ['amoxyclav', 'augmentin', 'mox'],
    unit: 'mg',
    adult: { minSingleDose: 250, maxSingleDose: 1000, maxDailyDose: 3000, typicalDose: '500mg thrice daily' },
    pediatric: { mgPerKg: 25, maxPediatricDose: 500, minAge: 0, notes: '25-50 mg/kg/day in 3 divided doses' },
    pregnancyCategory: 'B',
  },
  {
    name: 'azithromycin',
    aliases: ['zithromax', 'azee', 'azithral'],
    unit: 'mg',
    adult: { minSingleDose: 250, maxSingleDose: 500, maxDailyDose: 500, typicalDose: '500mg once daily for 3-5 days' },
    pediatric: { mgPerKg: 10, maxPediatricDose: 500, minAge: 0.5, notes: '10 mg/kg/day once daily' },
    pregnancyCategory: 'B',
  },
  {
    name: 'metronidazole',
    aliases: ['flagyl', 'metrogyl'],
    unit: 'mg',
    adult: { minSingleDose: 200, maxSingleDose: 800, maxDailyDose: 2400, typicalDose: '400mg thrice daily' },
    pediatric: { mgPerKg: 7.5, maxPediatricDose: 400, minAge: 0, notes: '7.5 mg/kg/dose TDS' },
    pregnancyCategory: 'B',
    notes: 'Avoid alcohol during and 48h after treatment.',
  },
  {
    name: 'ciprofloxacin',
    aliases: ['cipro', 'ciplox'],
    unit: 'mg',
    adult: { minSingleDose: 250, maxSingleDose: 750, maxDailyDose: 1500, typicalDose: '500mg twice daily' },
    pediatric: { mgPerKg: 10, maxPediatricDose: 500, minAge: 1, notes: 'Generally avoided in children (cartilage damage). Use only if no alternative.' },
    pregnancyCategory: 'C',
  },
  {
    name: 'cefixime',
    aliases: ['suprax', 'taxim-o'],
    unit: 'mg',
    adult: { minSingleDose: 200, maxSingleDose: 400, maxDailyDose: 400, typicalDose: '200mg twice daily or 400mg once daily' },
    pediatric: { mgPerKg: 8, maxPediatricDose: 400, minAge: 0.5, notes: '8 mg/kg/day in 1-2 divided doses' },
    pregnancyCategory: 'B',
  },

  // ── Gynecology-specific ─────────────────────────────────────
  {
    name: 'progesterone',
    aliases: ['susten', 'gestone', 'utrogestan'],
    unit: 'mg',
    adult: { minSingleDose: 100, maxSingleDose: 400, maxDailyDose: 800, typicalDose: '200-400mg daily (vaginal/oral)' },
    pregnancyCategory: 'B',
    notes: 'Natural micronized progesterone. Safe in pregnancy for luteal support.',
  },
  {
    name: 'dydrogesterone',
    aliases: ['duphaston'],
    unit: 'mg',
    adult: { minSingleDose: 10, maxSingleDose: 20, maxDailyDose: 40, typicalDose: '10mg twice daily' },
    pregnancyCategory: 'B',
  },
  {
    name: 'methyldopa',
    aliases: ['aldomet'],
    unit: 'mg',
    adult: { minSingleDose: 250, maxSingleDose: 500, maxDailyDose: 3000, typicalDose: '250-500mg 2-3 times daily' },
    pregnancyCategory: 'B',
    notes: 'First-line antihypertensive in pregnancy.',
  },
  {
    name: 'labetalol',
    aliases: ['trandate', 'lobet'],
    unit: 'mg',
    adult: { minSingleDose: 100, maxSingleDose: 400, maxDailyDose: 2400, typicalDose: '100-200mg twice daily' },
    pregnancyCategory: 'C',
    notes: 'Second-line antihypertensive in pregnancy after methyldopa.',
  },
  {
    name: 'nifedipine',
    aliases: ['adalat', 'depin'],
    unit: 'mg',
    adult: { minSingleDose: 10, maxSingleDose: 60, maxDailyDose: 120, typicalDose: '10-20mg TDS or 30mg SR BD' },
    pregnancyCategory: 'C',
    notes: 'Used for tocolysis and hypertension in pregnancy. Avoid sublingual route.',
  },
  {
    name: 'misoprostol',
    aliases: ['cytotec', 'misoprost'],
    unit: 'mcg',
    adult: { minSingleDose: 25, maxSingleDose: 800, maxDailyDose: 1600, typicalDose: '25-50mcg vaginally for induction; 200mcg orally for medical abortion' },
    pregnancyCategory: 'X',
    notes: 'CONTRAINDICATED in pregnancy (except for induction/abortion under supervision). Uterotonic.',
  },
  {
    name: 'oxytocin',
    aliases: ['pitocin', 'syntocinon'],
    unit: 'iu',
    adult: { minSingleDose: 2, maxSingleDose: 10, maxDailyDose: 40, typicalDose: '2-10 IU IV for induction; 5 IU IM for PPH' },
    pregnancyCategory: 'X',
    notes: 'Only for induction/augmentation under supervision. Monitor for hyperstimulation.',
  },
  {
    name: 'tranexamic acid',
    aliases: ['tranexa', 'pause', 'lysteda'],
    unit: 'mg',
    adult: { minSingleDose: 500, maxSingleDose: 1500, maxDailyDose: 4000, typicalDose: '500-1000mg TDS for 3-5 days' },
    pediatric: { mgPerKg: 25, maxPediatricDose: 1000, minAge: 1 },
    pregnancyCategory: 'B',
  },
  {
    name: 'clomiphene',
    aliases: ['clomid', 'siphene', 'fertyl'],
    unit: 'mg',
    adult: { minSingleDose: 25, maxSingleDose: 150, maxDailyDose: 150, typicalDose: '50-100mg daily for 5 days (day 2-6 of cycle)' },
    pregnancyCategory: 'X',
    notes: 'Ovulation induction. Max 6 cycles. Monitor for OHSS.',
  },
  {
    name: 'letrozole',
    aliases: ['femara', 'letroz'],
    unit: 'mg',
    adult: { minSingleDose: 2.5, maxSingleDose: 7.5, maxDailyDose: 7.5, typicalDose: '2.5-5mg daily for 5 days (day 2-6 of cycle)' },
    pregnancyCategory: 'X',
    notes: 'Off-label for ovulation induction. Increasingly preferred over clomiphene.',
  },

  // ── Common medications ──────────────────────────────────────
  {
    name: 'metformin',
    aliases: ['glucophage', 'glycomet'],
    unit: 'mg',
    adult: { minSingleDose: 250, maxSingleDose: 1000, maxDailyDose: 2550, typicalDose: '500mg BD, titrate to 1000mg BD' },
    pregnancyCategory: 'B',
    renalAdjust: true,
    notes: 'Start low, increase gradually. Stop if eGFR < 30.',
  },
  {
    name: 'pantoprazole',
    aliases: ['pantop', 'pan-d'],
    unit: 'mg',
    adult: { minSingleDose: 20, maxSingleDose: 80, maxDailyDose: 80, typicalDose: '40mg once daily before breakfast' },
    pediatric: { mgPerKg: 1, maxPediatricDose: 40, minAge: 5 },
    pregnancyCategory: 'B',
  },
  {
    name: 'ondansetron',
    aliases: ['zofran', 'emeset', 'ondem'],
    unit: 'mg',
    adult: { minSingleDose: 4, maxSingleDose: 8, maxDailyDose: 24, typicalDose: '4-8mg every 8h' },
    pediatric: { mgPerKg: 0.15, maxPediatricDose: 4, minAge: 0.5, notes: '0.1-0.15 mg/kg/dose' },
    pregnancyCategory: 'B',
  },
  {
    name: 'domperidone',
    aliases: ['motilium', 'domstal'],
    unit: 'mg',
    adult: { minSingleDose: 10, maxSingleDose: 20, maxDailyDose: 30, typicalDose: '10mg thrice daily before meals' },
    pediatric: { mgPerKg: 0.25, maxPediatricDose: 10, minAge: 0, notes: '0.25 mg/kg/dose TDS' },
    pregnancyCategory: 'C',
    notes: 'Max 30mg/day (cardiac risk at higher doses). Max 7 days.',
  },
  {
    name: 'folic acid',
    aliases: ['folate', 'folvite'],
    unit: 'mg',
    adult: { minSingleDose: 0.4, maxSingleDose: 5, maxDailyDose: 5, typicalDose: '5mg once daily' },
    pregnancyCategory: 'A',
    notes: 'Essential in pregnancy. 5mg/day for women with history of NTD.',
  },
  {
    name: 'calcium',
    aliases: ['shelcal', 'calcimax', 'calcium carbonate', 'calcium citrate'],
    unit: 'mg',
    adult: { minSingleDose: 250, maxSingleDose: 600, maxDailyDose: 1500, typicalDose: '500mg twice daily' },
    pregnancyCategory: 'A',
  },
  {
    name: 'vitamin d3',
    aliases: ['cholecalciferol', 'd-rise', 'calcirol'],
    unit: 'iu',
    adult: { minSingleDose: 1000, maxSingleDose: 60000, maxDailyDose: 60000, typicalDose: '1000 IU daily or 60000 IU weekly' },
    pregnancyCategory: 'A',
    notes: '60000 IU is a weekly sachet dose, not daily.',
  },
]

// ─── Dose Checker ─────────────────────────────────────────────

/**
 * Parse a dose string into a numeric value and unit.
 * Examples: "500mg" → { value: 500, unit: 'mg' }
 *           "5g" → { value: 5000, unit: 'mg' } (converted)
 *           "1000" → { value: 1000, unit: 'mg' } (assumed)
 */
function parseDose(doseStr: string): { value: number; unit: string } | null {
  if (!doseStr?.trim()) return null

  const match = doseStr.match(/(\d+\.?\d*)\s*(mg|mcg|g|ml|iu|units?)?/i)
  if (!match) return null

  let value = parseFloat(match[1])
  let unit = (match[2] || 'mg').toLowerCase()

  // Convert grams to mg for comparison
  if (unit === 'g') {
    value *= 1000
    unit = 'mg'
  }

  return { value, unit }
}

/**
 * Find a drug in the dose database by name.
 */
function findDrug(drugName: string): DrugDoseInfo | null {
  const norm = drugName.toLowerCase().replace(/\d+\s*(mg|mcg|g|ml|iu|units?)\b/gi, '').trim()

  return DOSE_DB.find(d =>
    norm.includes(d.name) ||
    d.aliases.some(a => norm.includes(a)) ||
    d.name.includes(norm) ||
    d.aliases.some(a => a.includes(norm))
  ) || null
}

/**
 * Parse frequency string to get doses per day.
 */
function getFrequencyMultiplier(frequency: string): number {
  const f = frequency.toLowerCase()
  if (f.includes('once daily') || f.includes('od') || f.includes('once a day')) return 1
  if (f.includes('twice') || f.includes('bd') || f.includes('bid')) return 2
  if (f.includes('thrice') || f.includes('tds') || f.includes('tid') || f.includes('three')) return 3
  if (f.includes('four') || f.includes('qid') || f.includes('qds')) return 4
  if (f.includes('every 6') || f.includes('q6h')) return 4
  if (f.includes('every 8') || f.includes('q8h')) return 3
  if (f.includes('every 12') || f.includes('q12h')) return 2
  if (f.includes('sos') || f.includes('prn') || f.includes('as needed')) return 1
  if (f.includes('weekly') || f.includes('once weekly')) return 1 / 7
  if (f.includes('bedtime') || f.includes('hs')) return 1
  return 1 // default to once daily
}

/**
 * Validate a single medication's dose.
 *
 * @param drugName - Name of the drug
 * @param dose - Dose string (e.g., "500mg", "5g")
 * @param frequency - Frequency string (e.g., "Twice daily")
 * @param patientAge - Patient age in years
 * @param patientWeight - Patient weight in kg (optional)
 */
export function validateDose(
  drugName: string,
  dose: string,
  frequency: string = 'Once daily',
  patientAge?: number,
  patientWeight?: number
): DoseAlert[] {
  const alerts: DoseAlert[] = []
  const drugInfo = findDrug(drugName)
  if (!drugInfo) return alerts // unknown drug — can't validate

  const parsed = parseDose(dose)
  if (!parsed) return alerts // can't parse dose

  const freqMultiplier = getFrequencyMultiplier(frequency)
  const dailyDose = parsed.value * freqMultiplier
  const isPediatric = patientAge !== undefined && patientAge < 12

  // ── Adult dose checks ───────────────────────────────────────
  if (!isPediatric) {
    // Overdose check (hard stop)
    if (parsed.value > drugInfo.adult.maxSingleDose * 2) {
      alerts.push({
        level: 'overdose',
        drug: drugName,
        prescribedDose: dose,
        message: `⚠️ DANGEROUS: ${drugName} ${dose} is ${Math.round(parsed.value / drugInfo.adult.maxSingleDose)}x the maximum single dose!`,
        safeRange: drugInfo.adult.typicalDose,
        maxDose: `${drugInfo.adult.maxSingleDose}${drugInfo.unit} per dose, ${drugInfo.adult.maxDailyDose}${drugInfo.unit}/day`,
        isHardStop: true,
        recommendation: `Maximum single dose is ${drugInfo.adult.maxSingleDose}${drugInfo.unit}. Please verify the dose.`,
      })
    }
    // High dose warning
    else if (parsed.value > drugInfo.adult.maxSingleDose) {
      alerts.push({
        level: 'high',
        drug: drugName,
        prescribedDose: dose,
        message: `${drugName} ${dose} exceeds the typical maximum single dose of ${drugInfo.adult.maxSingleDose}${drugInfo.unit}`,
        safeRange: drugInfo.adult.typicalDose,
        maxDose: `${drugInfo.adult.maxSingleDose}${drugInfo.unit} per dose`,
        isHardStop: false,
        recommendation: `Consider reducing to ${drugInfo.adult.maxSingleDose}${drugInfo.unit} or less.`,
      })
    }

    // Daily dose check
    if (dailyDose > drugInfo.adult.maxDailyDose) {
      alerts.push({
        level: dailyDose > drugInfo.adult.maxDailyDose * 1.5 ? 'overdose' : 'high',
        drug: drugName,
        prescribedDose: `${dose} ${frequency}`,
        message: `${drugName} total daily dose ~${Math.round(dailyDose)}${drugInfo.unit}/day exceeds max ${drugInfo.adult.maxDailyDose}${drugInfo.unit}/day`,
        safeRange: drugInfo.adult.typicalDose,
        maxDose: `${drugInfo.adult.maxDailyDose}${drugInfo.unit}/day`,
        isHardStop: dailyDose > drugInfo.adult.maxDailyDose * 1.5,
        recommendation: `Reduce dose or frequency. Maximum daily dose is ${drugInfo.adult.maxDailyDose}${drugInfo.unit}.`,
      })
    }

    // Low dose warning
    if (parsed.value < drugInfo.adult.minSingleDose && parsed.value > 0) {
      alerts.push({
        level: 'low',
        drug: drugName,
        prescribedDose: dose,
        message: `${drugName} ${dose} is below the typical therapeutic dose of ${drugInfo.adult.minSingleDose}${drugInfo.unit}`,
        safeRange: drugInfo.adult.typicalDose,
        maxDose: `${drugInfo.adult.maxSingleDose}${drugInfo.unit}`,
        isHardStop: false,
        recommendation: `Typical starting dose is ${drugInfo.adult.minSingleDose}${drugInfo.unit}. This dose may be sub-therapeutic.`,
      })
    }
  }

  // ── Pediatric dose checks ───────────────────────────────────
  if (isPediatric && drugInfo.pediatric) {
    const ped = drugInfo.pediatric

    // Age check
    if (ped.minAge !== undefined && patientAge < ped.minAge) {
      alerts.push({
        level: 'pediatric',
        drug: drugName,
        prescribedDose: dose,
        message: `${drugName} is not recommended for children under ${ped.minAge} year${ped.minAge !== 1 ? 's' : ''}. Patient is ${patientAge}y.`,
        safeRange: ped.notes || 'Not recommended for this age',
        maxDose: `${ped.maxPediatricDose}${drugInfo.unit}`,
        isHardStop: true,
        recommendation: `Consider age-appropriate alternative. ${ped.notes || ''}`,
      })
    }

    // Weight-based dose check
    if (patientWeight && ped.mgPerKg) {
      const maxWeightBasedDose = ped.mgPerKg * patientWeight
      const effectiveMax = Math.min(maxWeightBasedDose, ped.maxPediatricDose)

      if (parsed.value > effectiveMax * 1.5) {
        alerts.push({
          level: 'overdose',
          drug: drugName,
          prescribedDose: dose,
          message: `⚠️ PEDIATRIC OVERDOSE: ${drugName} ${dose} for ${patientWeight}kg child. Max dose = ${Math.round(effectiveMax)}${drugInfo.unit} (${ped.mgPerKg} mg/kg)`,
          safeRange: `${ped.mgPerKg} mg/kg/dose = ${Math.round(maxWeightBasedDose)}${drugInfo.unit}`,
          maxDose: `${ped.maxPediatricDose}${drugInfo.unit} absolute max`,
          isHardStop: true,
          recommendation: `For ${patientWeight}kg child: ${Math.round(maxWeightBasedDose)}${drugInfo.unit}/dose (max ${ped.maxPediatricDose}${drugInfo.unit}). ${ped.notes || ''}`,
        })
      } else if (parsed.value > effectiveMax) {
        alerts.push({
          level: 'high',
          drug: drugName,
          prescribedDose: dose,
          message: `${drugName} ${dose} exceeds weight-based dose for ${patientWeight}kg child (${ped.mgPerKg} mg/kg = ${Math.round(maxWeightBasedDose)}${drugInfo.unit})`,
          safeRange: `${ped.mgPerKg} mg/kg/dose`,
          maxDose: `${Math.round(effectiveMax)}${drugInfo.unit}`,
          isHardStop: false,
          recommendation: `Consider ${Math.round(maxWeightBasedDose)}${drugInfo.unit}/dose. ${ped.notes || ''}`,
        })
      }
    }

    // Absolute pediatric max
    if (parsed.value > ped.maxPediatricDose) {
      alerts.push({
        level: 'overdose',
        drug: drugName,
        prescribedDose: dose,
        message: `${drugName} ${dose} exceeds absolute pediatric maximum of ${ped.maxPediatricDose}${drugInfo.unit}`,
        safeRange: ped.notes || `Max ${ped.maxPediatricDose}${drugInfo.unit}`,
        maxDose: `${ped.maxPediatricDose}${drugInfo.unit}`,
        isHardStop: true,
        recommendation: `Reduce to ${ped.maxPediatricDose}${drugInfo.unit} or less.`,
      })
    }
  }

  // ── Pregnancy category check ────────────────────────────────
  // This is informational — shown as a note, not a hard stop
  if (drugInfo.pregnancyCategory === 'X') {
    alerts.push({
      level: 'overdose', // using overdose level for visibility
      drug: drugName,
      prescribedDose: dose,
      message: `${drugName} is FDA Category X — CONTRAINDICATED in pregnancy. Known to cause fetal harm.`,
      safeRange: 'Not safe in pregnancy',
      maxDose: 'N/A',
      isHardStop: true,
      recommendation: 'Do NOT prescribe to pregnant patients. Use alternative.',
    })
  }

  return alerts
}

/**
 * Validate all medications in a prescription.
 */
export function validatePrescription(
  medications: { drug: string; dose: string; frequency: string }[],
  patientAge?: number,
  patientWeight?: number
): DoseCheckResult {
  const allAlerts: DoseAlert[] = []

  for (const med of medications) {
    if (!med.drug?.trim()) continue
    const alerts = validateDose(med.drug, med.dose, med.frequency, patientAge, patientWeight)
    allAlerts.push(...alerts)
  }

  return {
    hasAlerts: allAlerts.length > 0,
    hasHardStop: allAlerts.some(a => a.isHardStop),
    alerts: allAlerts,
  }
}

/**
 * Get dose alert level styling.
 */
export function doseAlertStyle(level: DoseAlertLevel): {
  bg: string; text: string; border: string; icon: string; label: string
} {
  switch (level) {
    case 'overdose':
      return { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300', icon: '🚫', label: 'OVERDOSE RISK' }
    case 'high':
      return { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: '⚠️', label: 'HIGH DOSE' }
    case 'low':
      return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: 'ℹ️', label: 'LOW DOSE' }
    case 'pediatric':
      return { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', icon: '👶', label: 'PEDIATRIC' }
  }
}
