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

/**
 * Alert levels.
 *
 * BUG-D03 fix: added 'pregnancy' as a dedicated level for pregnancy-
 * category-related warnings.  Previously Category X drugs were flagged
 * with level 'overdose', which caused the UI to show "OVERDOSE RISK" for
 * a normal-dose Misoprostol prescribed to any adult woman — confusing,
 * and not factually accurate (the issue is contraindication, not dose).
 */
export type DoseAlertLevel = 'overdose' | 'high' | 'low' | 'pediatric' | 'pregnancy'

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

/**
 * BUG-D03 helper: pregnancy status of the patient.  When undefined or
 * 'unknown', Category X warnings are still shown (safe default).  When
 * 'not_pregnant' (e.g., male patient, post-menopausal, post-hysterectomy)
 * the warning is suppressed.
 */
export type PregnancyStatus = 'pregnant' | 'not_pregnant' | 'unknown'

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
  /**
   * BUG-D05 fix: optional cumulative-course-dose cap for drugs where
   * total course exposure matters (cytotoxics, certain antibiotics with
   * cumulative toxicity).  If set AND the caller provides courseDays,
   * we check (dailyDose * courseDays) against this limit and warn on
   * exceedance.  Leave undefined for drugs where per-day limits suffice.
   *
   * Units match `unit` field on the same drug.
   */
  maxCourseDose?: number
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

/** Escape regex metacharacters in a literal string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Tokenize a drug name for matching.
 *
 * BUG-D02 fix: replace non-alpha with space (not empty string) and
 * collapse whitespace.  This preserves word boundaries so that, e.g.,
 * "Amoxicillin-Clavulanate" tokenizes as ["amoxicillin", "clavulanate"]
 * rather than the single token "amoxicillinclavulanate" which defeats
 * exact-word matching.
 */
function tokenizeDrugName(name: string): { norm: string; tokens: string[] } {
  const norm = name
    .toLowerCase()
    .replace(/\d+\s*(mg|mcg|g|ml|iu|units?)\b/gi, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = norm.split(/\s+/).filter(Boolean)
  return { norm, tokens }
}

/**
 * Find a drug in the dose database by name.
 *
 * BUG-D02 fix: previously used naive `norm.includes(alias)` for every
 * alias — a 3-character alias like 'mox' (Indian brand for amoxicillin)
 * matched 'moxifloxacin', triggering wrong dose ranges and false alerts.
 *
 * Match priority:
 *   1. Whole-token match against the drug's name or any alias
 *      (handles "Cipro 500" → ciprofloxacin, "Mox 500" → amoxicillin).
 *   2. Substring match on the full canonical name (handles hyphenated
 *      compound names like "amoxicillin-clavulanate").
 *   3. Substring match on aliases ONLY when the alias is ≥ 5 chars.
 *      This intentionally excludes very short aliases ('mox', 'azee')
 *      from substring fallback to prevent false positives.
 */
function findDrug(drugName: string): DrugDoseInfo | null {
  const { norm, tokens } = tokenizeDrugName(drugName)
  if (!norm) return null
  const tokenSet = new Set(tokens)

  // 1. Whole-token match
  for (const d of DOSE_DB) {
    if (tokenSet.has(d.name)) return d
    for (const a of d.aliases) {
      if (tokenSet.has(a)) return d
    }
  }

  // 2/3. Substring fallback (canonical name always; aliases only if ≥ 5 chars)
  for (const d of DOSE_DB) {
    if (d.name.length >= 4 && norm.includes(d.name)) return d
    for (const a of d.aliases) {
      if (a.length >= 5 && norm.includes(a)) return d
    }
  }

  return null
}

/**
 * Parse frequency string to get doses per day.
 *
 * BUG-D04 fix: previous implementation used substring `includes` which
 * caused several misclassifications:
 *   - 'qod' (every other day) matched `f.includes('od')` → returned 1
 *     (should be 0.5).
 *   - 'q.i.d.' (with periods) failed to match 'qid'.
 *   - 'q4h' / 'q12h' generic patterns weren't handled — only specific
 *     'every 6'/'every 8'/'every 12' literals were checked.
 *   - 'stat' (single immediate dose) wasn't recognised at all.
 *
 * New implementation:
 *   - Strips dots so 'q.i.d.' → 'qid' before matching.
 *   - Uses word-boundary regex so 'qod' doesn't match 'od', 'tide'
 *     doesn't match 'tid', etc.
 *   - Handles arbitrary q<N>h / every <N> hours patterns generically.
 *   - Returns 0.5 for every-other-day frequencies.
 *   - Falls back to 1 (once daily) when nothing matches — preserves
 *     prior default behaviour.
 *
 * Returns a positive number representing "doses per day".  For every-
 * other-day prescriptions the value is 0.5.
 */
function getFrequencyMultiplier(frequency: string): number {
  const f = (frequency || '')
    .toLowerCase()
    .replace(/\./g, '')           // 'q.i.d.' → 'qid'
    .replace(/\s+/g, ' ')
    .trim()
  if (!f) return 1

  // Strict word-boundary check using whitespace or string edge as boundary.
  // We can't rely on \b alone because regex \b treats digits as word chars,
  // so 'q4h' would have a word break between 'q' and '4'.
  const word = (w: string) => new RegExp(`(^|\\s|/)${escapeRegex(w)}(\\s|/|$)`).test(f)

  // Single dose / stat — total daily dose check uses a multiplier of 1
  if (word('stat') || /\bsingle dose\b/.test(f) || /\bonce only\b/.test(f)) return 1

  // Every other day / alternate day → 0.5 doses/day
  if (
    word('qod') || word('eod') ||
    /\bevery other day\b/.test(f) ||
    /\balternate days?\b/.test(f) ||
    /\bevery 2 days?\b/.test(f)
  ) return 0.5

  // Generic hourly: q4h, q6h, q8h, q12h, "every 4 hours", etc.
  const qhMatch = f.match(/\bq\s*(\d+)\s*h\b/) || f.match(/\bevery\s+(\d+)\s*(?:h|hours?)\b/)
  if (qhMatch) {
    const hours = parseInt(qhMatch[1], 10)
    if (Number.isFinite(hours) && hours > 0 && hours <= 24) {
      return Math.round((24 / hours) * 100) / 100
    }
  }

  // Standard abbreviations — order matters: more specific first
  if (word('qid') || word('qds') || /\bfour times?\b/.test(f) || /\b4 times?\b/.test(f)) return 4
  if (word('tid') || word('tds') || /\bthrice\b/.test(f) || /\bthree times?\b/.test(f) || /\b3 times?\b/.test(f)) return 3
  if (word('bid') || word('bd') || word('bds') || /\btwice\b/.test(f) || /\b2 times?\b/.test(f)) return 2
  if (
    word('od') || word('qd') ||
    word('hs') || word('nocte') ||
    /\bbedtime\b/.test(f) ||
    /\bonce daily\b/.test(f) || /\bonce a day\b/.test(f) || /\bdaily\b/.test(f)
  ) return 1

  if (/\bweekly\b/.test(f) || /\bonce a week\b/.test(f)) return 1 / 7

  // PRN / SOS — frequency is unknown.  Return 1 for daily-dose math,
  // matching the previous default; callers that need a worst-case
  // estimate should treat PRN doses as needing manual review.
  if (word('prn') || word('sos') || /\bas needed\b/.test(f) || /\bas required\b/.test(f)) return 1

  return 1
}

/**
 * Validate a single medication's dose.
 *
 * @param drugName - Name of the drug
 * @param dose - Dose string (e.g., "500mg", "5g")
 * @param frequency - Frequency string (e.g., "Twice daily")
 * @param patientAge - Patient age in years
 * @param patientWeight - Patient weight in kg (optional)
 * @param opts - Optional contextual flags:
 *               - pregnancyStatus: BUG-D03 fix; suppresses Category X
 *                 warnings when 'not_pregnant'.
 *               - courseDays: BUG-D05 fix; if provided AND drug has
 *                 maxCourseDose, total course exposure is checked.
 */
export function validateDose(
  drugName: string,
  dose: string,
  frequency: string = 'Once daily',
  patientAge?: number,
  patientWeight?: number,
  opts?: {
    pregnancyStatus?: PregnancyStatus
    courseDays?: number
  },
): DoseAlert[] {
  const alerts: DoseAlert[] = []
  const drugInfo = findDrug(drugName)
  if (!drugInfo) return alerts // unknown drug — can't validate

  const parsed = parseDose(dose)
  if (!parsed) return alerts // can't parse dose

  const freqMultiplier = getFrequencyMultiplier(frequency)
  const dailyDose = parsed.value * freqMultiplier

  // ── BUG-D01 fix: pediatric cutoff is 18 years (WHO standard), not 12 ──
  // Adolescents (13-17) were previously checked against adult ranges,
  // which can dangerously over-dose a teenager.  Now we use pediatric
  // ranges whenever the drug has them AND the patient is < 18.
  // For drugs without pediatric data, fall back to adult ranges so we
  // don't lose any check coverage (existing behaviour preserved).
  const ageKnown = patientAge !== undefined && patientAge !== null
  const isPediatric =
    ageKnown && (patientAge as number) < 18 && drugInfo.pediatric !== undefined

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
    if (ped.minAge !== undefined && (patientAge as number) < ped.minAge) {
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

  // ── BUG-D03 fix: Pregnancy category check ────────────────────
  // Previously: every Category X drug produced an 'overdose'-level alert
  // for every adult, regardless of the patient's actual pregnancy status.
  // Now: the alert uses the dedicated 'pregnancy' level, and is suppressed
  // when the caller has confirmed the patient is not pregnant (e.g., male
  // patient, post-menopausal, post-hysterectomy, partner not the patient).
  // Default behaviour (status undefined or 'unknown') is to show the
  // warning — fail-safe.
  if (drugInfo.pregnancyCategory === 'X') {
    const status = opts?.pregnancyStatus ?? 'unknown'
    if (status !== 'not_pregnant') {
      alerts.push({
        level: 'pregnancy',
        drug: drugName,
        prescribedDose: dose,
        message:
          status === 'pregnant'
            ? `${drugName} is FDA Category X — CONTRAINDICATED in pregnancy. Known to cause fetal harm.`
            : `${drugName} is FDA Category X — CONTRAINDICATED in pregnancy. Confirm patient is not pregnant before prescribing.`,
        safeRange: 'Not safe in pregnancy',
        maxDose: 'N/A',
        isHardStop: status === 'pregnant',  // Hard stop only when pregnancy confirmed
        recommendation:
          status === 'pregnant'
            ? 'Do NOT prescribe to this pregnant patient. Use alternative.'
            : 'Verify pregnancy status. If pregnant, use alternative agent.',
      })
    }
  }

  // ── BUG-D05 fix: cumulative course dose check ────────────────
  // For drugs where total course exposure matters (e.g., methotrexate,
  // cumulative cytotoxics), check (dailyDose × courseDays) against the
  // drug's maxCourseDose.  This only fires when both data points are
  // present; legacy callers that don't pass courseDays see no change.
  const courseDays = opts?.courseDays
  if (
    drugInfo.maxCourseDose &&
    typeof courseDays === 'number' &&
    Number.isFinite(courseDays) &&
    courseDays > 0
  ) {
    const cumulative = dailyDose * courseDays
    if (cumulative > drugInfo.maxCourseDose) {
      alerts.push({
        level: cumulative > drugInfo.maxCourseDose * 1.5 ? 'overdose' : 'high',
        drug: drugName,
        prescribedDose: `${dose} ${frequency} × ${courseDays} days`,
        message: `${drugName} cumulative course dose ~${Math.round(cumulative)}${drugInfo.unit} exceeds max course dose ${drugInfo.maxCourseDose}${drugInfo.unit}`,
        safeRange: drugInfo.adult.typicalDose,
        maxDose: `${drugInfo.maxCourseDose}${drugInfo.unit} per course`,
        isHardStop: cumulative > drugInfo.maxCourseDose * 1.5,
        recommendation: `Shorten course or reduce dose so total ≤ ${drugInfo.maxCourseDose}${drugInfo.unit}.`,
      })
    }
  }

  return alerts
}

/**
 * Validate all medications in a prescription.
 *
 * BUG-D03 / BUG-D05: accepts optional pregnancy status and per-drug
 * courseDays so all relevant context can be fed into validateDose.
 */
export function validatePrescription(
  medications: { drug: string; dose: string; frequency: string; courseDays?: number }[],
  patientAge?: number,
  patientWeight?: number,
  opts?: {
    pregnancyStatus?: PregnancyStatus
  },
): DoseCheckResult {
  const allAlerts: DoseAlert[] = []

  for (const med of medications) {
    if (!med.drug?.trim()) continue
    const alerts = validateDose(
      med.drug,
      med.dose,
      med.frequency,
      patientAge,
      patientWeight,
      {
        pregnancyStatus: opts?.pregnancyStatus,
        courseDays: med.courseDays,
      },
    )
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
 *
 * BUG-D03: 'pregnancy' level gets a dedicated pink/rose style so the UI
 * can distinguish it from 'overdose' (red) at a glance.
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
    case 'pregnancy':
      return { bg: 'bg-pink-50', text: 'text-pink-800', border: 'border-pink-200', icon: '🤰', label: 'CONTRAINDICATED IN PREGNANCY' }
  }
}
