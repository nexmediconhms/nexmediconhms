/**
 * src/lib/anc-risk-v2.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BUG #6 FIX: ANC Risk Calculation False Positives
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PROBLEM:
 *   The original calculateANCRisk() in business-logic.ts has this line:
 *
 *     if ((params.gaWeeks || 0) >= 36) reasons.push('Near-term pregnancy (≥36 weeks)')
 *
 *   This means EVERY patient who reaches 36 weeks (which is 100% of term
 *   pregnancies) automatically gets flagged as "medium risk" even if they
 *   are completely healthy.
 *
 *   Additionally, the threshold for "high" risk is just 3+ reasons, which
 *   is too low. A healthy 36-year-old primigravida at 37 weeks would have:
 *     - "Near-term pregnancy (≥36 weeks)" ← not a real risk
 *     - "Advanced maternal age (>35 years)" ← real but mild
 *     - That's already "medium risk" when she may be perfectly healthy
 *
 *   Add gravida ≥ 5 (grand multiparity) and she's "high risk" with only
 *   one genuinely concerning factor.
 *
 * EFFECT OF BUG:
 *   - Alert fatigue: nearly ALL near-term patients show as medium/high risk
 *   - Doctors ignore the risk badges because they're always yellow/red
 *   - Genuinely high-risk patients don't stand out from the noise
 *   - The ANC registry filter "High Risk" shows too many patients
 *   - Wastes clinical time reviewing false alerts
 *
 * SOLUTION:
 *   This file provides `calculateANCRiskV2()` which:
 *   1. Removes "near-term ≥36 weeks" as a risk factor (it's NORMAL, not risk)
 *   2. Keeps "post-dates >40 weeks" as that IS genuinely risky
 *   3. Adds weighted scoring instead of simple count:
 *      - Critical factors (e.g., eclampsia history) = 5 points
 *      - Major factors (hypertension, severe anemia) = 3 points
 *      - Minor factors (advanced age, grand multiparity) = 1 point
 *   4. Uses clinically appropriate thresholds:
 *      - Low: 0 points
 *      - Medium: 1-4 points
 *      - High: 5+ points
 *
 * AFTER FIX:
 *   ✅ Healthy near-term patients stay "Low Risk" (no more false yellows)
 *   ✅ Genuinely high-risk patients (eclampsia, severe HTN) correctly flagged
 *   ✅ Risk badges are clinically meaningful — doctors trust them
 *   ✅ ANC registry "High Risk" filter shows only patients who need attention
 *   ✅ Backward compatible — same return type as original function
 *
 * USAGE:
 *   // Replace: import { calculateANCRisk } from '@/lib/business-logic'
 *   // With:    import { calculateANCRiskV2 } from '@/lib/anc-risk-v2'
 *   // (Same params, same return shape)
 *
 *   const risk = calculateANCRiskV2({
 *     gaWeeks: 38,
 *     bpSystolic: 120,
 *     bpDiastolic: 80,
 *     hemoglobin: 11.5,
 *     age: 28,
 *     gravida: 2,
 *   })
 *   // → { level: 'low', label: 'Low Risk', reasons: [], color: '...' }
 */

// ─── Types (same as original for backward compatibility) ──────────────

export type RiskLevel = 'low' | 'medium' | 'high'

export interface ANCRiskResult {
  level: RiskLevel
  label: string
  reasons: string[]
  color: string    // Tailwind classes for badge
  score: number    // New: numeric score for sorting/comparison
}

// ─── Risk Factor Weights ──────────────────────────────────────────────

interface RiskFactor {
  condition: (params: ANCRiskParams) => boolean
  message: string
  weight: number  // 1 = minor, 3 = major, 5 = critical
  category: 'critical' | 'major' | 'minor'
}

export interface ANCRiskParams {
  gaWeeks?: number
  bpSystolic?: number
  bpDiastolic?: number
  hemoglobin?: number
  weight?: number
  gravida?: number
  age?: number
  riskFactors?: string[]
  /** Previous obstetric history flags */
  previousCSSection?: boolean
  previousPreeclampsia?: boolean
  gestationalDiabetes?: boolean
  multipleGestation?: boolean
  placentaPrevia?: boolean
}

// ─── Risk Factor Definitions ──────────────────────────────────────────

const RISK_FACTORS: RiskFactor[] = [
  // ── CRITICAL (weight: 5) — Immediate attention needed ───────────────
  {
    condition: (p) => (p.bpSystolic || 0) >= 160,
    message: 'Severe hypertension — SBP ≥160 mmHg (risk of eclampsia)',
    weight: 5,
    category: 'critical',
  },
  {
    condition: (p) => (p.bpDiastolic || 0) >= 110,
    message: 'Severe hypertension — DBP ≥110 mmHg (risk of eclampsia)',
    weight: 5,
    category: 'critical',
  },
  {
    condition: (p) => (p.hemoglobin || 99) < 7,
    message: 'Severe anaemia (Hb <7 g/dL) — transfusion may be needed',
    weight: 5,
    category: 'critical',
  },
  {
    condition: (p) => (p.gaWeeks || 0) > 42,
    message: 'Significantly post-dates (>42 weeks) — induction indicated',
    weight: 5,
    category: 'critical',
  },
  {
    condition: (p) => p.placentaPrevia === true,
    message: 'Placenta previa — high bleeding risk',
    weight: 5,
    category: 'critical',
  },
  {
    condition: (p) => p.multipleGestation === true,
    message: 'Multiple gestation (twins/triplets) — higher complication risk',
    weight: 5,
    category: 'critical',
  },

  // ── MAJOR (weight: 3) — Close monitoring required ───────────────────
  {
    condition: (p) => (p.bpSystolic || 0) > 140 && (p.bpSystolic || 0) < 160,
    message: 'Hypertension — SBP 140-159 mmHg',
    weight: 3,
    category: 'major',
  },
  {
    condition: (p) => (p.bpDiastolic || 0) > 90 && (p.bpDiastolic || 0) < 110,
    message: 'Hypertension — DBP 90-109 mmHg',
    weight: 3,
    category: 'major',
  },
  {
    condition: (p) => {
      const hb = p.hemoglobin || 99
      return hb >= 7 && hb < 9
    },
    message: 'Moderate anaemia (Hb 7-8.9 g/dL) — iron therapy + monitoring',
    weight: 3,
    category: 'major',
  },
  {
    condition: (p) => (p.gaWeeks || 0) > 40 && (p.gaWeeks || 0) <= 42,
    message: 'Post-dates pregnancy (40-42 weeks) — consider induction',
    weight: 3,
    category: 'major',
  },
  {
    condition: (p) => p.previousPreeclampsia === true,
    message: 'History of pre-eclampsia — recurrence risk elevated',
    weight: 3,
    category: 'major',
  },
  {
    condition: (p) => p.gestationalDiabetes === true,
    message: 'Gestational diabetes mellitus — glucose monitoring required',
    weight: 3,
    category: 'major',
  },
  {
    condition: (p) => p.previousCSSection === true && (p.gaWeeks || 0) > 36,
    message: 'Previous C-section near term — scar integrity monitoring',
    weight: 3,
    category: 'major',
  },
  {
    condition: (p) => (p.age || 99) < 16,
    message: 'Very young mother (<16 years) — high obstetric risk',
    weight: 3,
    category: 'major',
  },

  // ── MINOR (weight: 1) — Awareness, standard monitoring ─────────────
  {
    condition: (p) => {
      const hb = p.hemoglobin || 99
      return hb >= 9 && hb < 11
    },
    message: 'Mild anaemia (Hb 9-10.9 g/dL) — oral iron supplementation',
    weight: 1,
    category: 'minor',
  },
  {
    condition: (p) => (p.gravida || 0) >= 5,
    message: 'Grand multiparity (G5+) — slightly elevated risk',
    weight: 1,
    category: 'minor',
  },
  {
    condition: (p) => {
      const age = p.age || 0
      return age >= 16 && age < 18
    },
    message: 'Adolescent mother (16-17 years)',
    weight: 1,
    category: 'minor',
  },
  {
    condition: (p) => (p.age || 0) > 35,
    message: 'Advanced maternal age (>35 years)',
    weight: 1,
    category: 'minor',
  },
  {
    condition: (p) => p.previousCSSection === true && (p.gaWeeks || 0) <= 36,
    message: 'Previous C-section — VBAC counselling needed',
    weight: 1,
    category: 'minor',
  },
]

// ─── Pre-existing Risk Factor Keywords (from the riskFactors string array) ──

const CRITICAL_KEYWORDS = [
  'eclampsia', 'abruption', 'rupture', 'hemorrhage', 'haemorrhage',
  'thromboembolism', 'cardiac', 'renal failure',
]

const MAJOR_KEYWORDS = [
  'hypertension', 'diabetes', 'thyroid', 'epilepsy', 'asthma',
  'sickle cell', 'hiv', 'hepatitis', 'previous stillbirth',
  'recurrent miscarriage', 'preterm',
]

function classifyRiskFactor(factor: string): { weight: number; category: string } {
  const lower = factor.toLowerCase()
  if (CRITICAL_KEYWORDS.some(k => lower.includes(k))) {
    return { weight: 5, category: 'critical' }
  }
  if (MAJOR_KEYWORDS.some(k => lower.includes(k))) {
    return { weight: 3, category: 'major' }
  }
  return { weight: 1, category: 'minor' }
}

// ─── Main Function ────────────────────────────────────────────────────

/**
 * Calculate ANC patient risk level using clinically weighted scoring.
 *
 * IMPROVEMENTS over original calculateANCRisk():
 *   1. No false positives from normal near-term pregnancy (≥36 weeks removed)
 *   2. Weighted scoring prevents minor factors from escalating risk inappropriately
 *   3. Severity categories (critical/major/minor) for clinical clarity
 *   4. Returns numeric score for sorting patients by risk in lists
 *
 * @param params - Patient vitals and history
 * @returns ANCRiskResult — same shape as original for backward compatibility
 */
export function calculateANCRiskV2(params: ANCRiskParams): ANCRiskResult {
  const reasons: string[] = []
  let totalScore = 0

  // Check defined risk factors
  for (const factor of RISK_FACTORS) {
    if (factor.condition(params)) {
      reasons.push(factor.message)
      totalScore += factor.weight
    }
  }

  // Check pre-existing risk factors from the string array
  if (params.riskFactors && params.riskFactors.length > 0) {
    for (const rf of params.riskFactors) {
      if (!rf || !rf.trim()) continue
      const { weight } = classifyRiskFactor(rf)
      reasons.push(`Pre-existing: ${rf}`)
      totalScore += weight
    }
  }

  // Determine risk level from weighted score
  let level: RiskLevel
  if (totalScore >= 5) {
    level = 'high'
  } else if (totalScore >= 1) {
    level = 'medium'
  } else {
    level = 'low'
  }

  const COLORS: Record<RiskLevel, string> = {
    low: 'text-green-700 bg-green-100 border-green-200',
    medium: 'text-amber-700 bg-amber-100 border-amber-200',
    high: 'text-red-700 bg-red-100 border-red-200',
  }

  return {
    level,
    label: `${level.charAt(0).toUpperCase() + level.slice(1)} Risk`,
    reasons,
    color: COLORS[level],
    score: totalScore,
  }
}

/**
 * Compare two risk results for sorting (higher risk first).
 * Useful for sorting patient lists in the ANC registry.
 */
export function compareRisk(a: ANCRiskResult, b: ANCRiskResult): number {
  return b.score - a.score
}

/**
 * Get a short summary of risk factors for display in compact views.
 * Shows only the most important factor and count of others.
 */
export function riskSummary(result: ANCRiskResult): string {
  if (result.reasons.length === 0) return 'No risk factors identified'
  if (result.reasons.length === 1) return result.reasons[0]
  return `${result.reasons[0]} (+${result.reasons.length - 1} more)`
}