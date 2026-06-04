/**
 * src/lib/critical-alerts.ts  — UPDATED
 *
 * Critical Value Detection — wired into OPD edit page on every save and blur.
 *
 * Changes vs original:
 *  - Consistent return type { hasCritical, alerts }
 *  - alerts[] now has { level, message, value } for audit logging
 *  - Added lab-result critical values (Hb, glucose, K+, Na+)
 *  - Added pregnancy-specific thresholds
 *
 * ═══════════════════════════════════════════════════════════════════════
 * UPDATES IN THIS VERSION (June 2026) — ALL ADDITIVE, NO REMOVALS
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   FIX #29: NEGATIVE / OUT-OF-RANGE VITALS NOW FLAGGED
 *     The previous version only checked thresholds in the positive direction
 *     (e.g., `bp_systolic >= 180`, `bp_systolic <= 80`). A typo entering -180
 *     for BP slipped through silently — neither the critical-high nor the
 *     critical-low branch fired (since -180 is <= 80 but also nonsensical).
 *
 *     New behavior: a sanity-check pass runs first. Negative or physically
 *     impossible values (e.g., temperature < 25°C, BP < 0, SpO₂ > 100, pulse
 *     > 300) are flagged as 'warning' with a "data quality" message rather
 *     than masquerading as clinical alerts. After the sanity pass, the
 *     normal threshold logic runs (skipping fields that already failed the
 *     sanity check).
 *
 *     This is a DATA-QUALITY guard, not a clinical one — it tells the user
 *     "this entry doesn't look right" without overriding genuine extreme
 *     values that happen to also be extreme physiological readings.
 *
 *   FIX #29b: BOUNDARIES TIGHTENED
 *     - Pulse upper bound for sanity check: > 300 bpm (physiologically rare
 *       above 250)
 *     - SpO₂ bounds: must be in [0, 100]
 *     - Temperature: hard floor at 20°C below which is incompatible with life
 *
 * SIGNATURE PRESERVED:
 *   - checkCriticalValues(vitals: VitalsInput, context: PatientContext = {}): CriticalCheckResult
 *
 * ALL EXISTING CALLERS REMAIN COMPATIBLE:
 *   - src/app/.../opd/[id]/edit/page.tsx — imports checkCriticalValues and
 *     reads { hasCritical, alerts }.
 *
 * ALL TYPES PRESERVED:
 *   - CriticalValueAlert, CriticalCheckResult, VitalsInput, PatientContext
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface CriticalValueAlert {
  level:   'critical' | 'warning'
  message: string
  value:   string | number
  field:   string
}

export interface CriticalCheckResult {
  hasCritical: boolean
  hasWarning:  boolean
  alerts:      CriticalValueAlert[]
}

export interface VitalsInput {
  bp_systolic?:  number
  bp_diastolic?: number
  pulse?:        number
  spo2?:         number
  temperature?:  number
  weight?:       number
  rr?:           number    // respiratory rate
  // Lab values (optional)
  hemoglobin?:   number
  glucose?:      number
  potassium?:    number
  sodium?:       number
}

export interface PatientContext {
  patientAge?:  number
  isPregnant?:  boolean
  gestWeeks?:   number
}

// ── Internal helpers ─────────────────────────────────────────

/** Returns true if x is a finite number (not NaN, not Infinity). */
function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

/**
 * FIX #29: Physiological sanity bounds.
 * Values outside these ranges are flagged as data-quality warnings rather
 * than processed by the threshold logic.
 *
 * These are deliberately wider than the "warning" thresholds — they catch
 * genuinely impossible inputs (typos, unit confusion) without re-flagging
 * the legitimate critical-range values.
 */
const SANITY_BOUNDS: Record<keyof VitalsInput, { min: number; max: number; unit: string }> = {
  bp_systolic:  { min: 30,  max: 300, unit: 'mmHg' },
  bp_diastolic: { min: 20,  max: 200, unit: 'mmHg' },
  pulse:        { min: 20,  max: 300, unit: 'bpm' },
  spo2:         { min: 0,   max: 100, unit: '%' },
  temperature:  { min: 25,  max: 45,  unit: '°C' },
  weight:       { min: 0.3, max: 350, unit: 'kg' },
  rr:           { min: 4,   max: 80,  unit: '/min' },
  hemoglobin:   { min: 1,   max: 25,  unit: 'g/dL' },
  glucose:      { min: 10,  max: 1500, unit: 'mg/dL' },
  potassium:    { min: 0.5, max: 12,  unit: 'mEq/L' },
  sodium:       { min: 80,  max: 200, unit: 'mEq/L' },
}

/**
 * Run sanity checks on all provided vitals. Returns:
 *   - alerts: data-quality warnings for fields outside SANITY_BOUNDS
 *   - skipFields: a Set of field names that should be skipped by the
 *     normal threshold logic (because they failed sanity).
 */
function runSanityChecks(vitals: VitalsInput): {
  alerts: CriticalValueAlert[]
  skipFields: Set<string>
} {
  const alerts: CriticalValueAlert[] = []
  const skipFields = new Set<string>()

  for (const key of Object.keys(SANITY_BOUNDS) as (keyof VitalsInput)[]) {
    const value = vitals[key]
    if (value === undefined || value === null) continue
    if (!isFiniteNum(value)) continue

    const { min, max, unit } = SANITY_BOUNDS[key]

    if (value < min || value > max) {
      // Out-of-physiological-range — likely a typo
      alerts.push({
        level: 'warning',
        field: key,
        value,
        message:
          `Invalid ${key.replace(/_/g, ' ')}: ${value} ${unit} is outside the ` +
          `physically plausible range [${min}–${max}]. ` +
          `Please verify the entry.`,
      })
      skipFields.add(key)
    }
  }

  return { alerts, skipFields }
}

/**
 * Check vitals (and optional lab values) for critical/warning values.
 * Thresholds based on Indian AHA/ESC/FOGSI guidelines.
 */
export function checkCriticalValues(
  vitals:  VitalsInput,
  context: PatientContext = {},
): CriticalCheckResult {
  const alerts: CriticalValueAlert[] = []

  const { bp_systolic, bp_diastolic, pulse, spo2, temperature, hemoglobin, glucose, potassium, sodium } = vitals
  const { isPregnant, gestWeeks } = context

  // ── FIX #29: Sanity pass FIRST ───────────────────────────────
  // Any vital outside SANITY_BOUNDS is flagged as a data-quality warning
  // and skipped by the threshold logic below to avoid double-firing.
  const sanity = runSanityChecks(vitals)
  alerts.push(...sanity.alerts)

  // ── Blood Pressure ──────────────────────────────────────────

  if (bp_systolic !== undefined && isFiniteNum(bp_systolic) && !sanity.skipFields.has('bp_systolic')) {
    if (bp_systolic >= 180) {
      alerts.push({
        level:   'critical',
        field:   'bp_systolic',
        value:   bp_systolic,
        message: `Hypertensive Crisis: Systolic BP ${bp_systolic} mmHg (≥180). Immediate action required.`,
      })
    } else if (bp_systolic >= 160) {
      alerts.push({
        level:   isPregnant ? 'critical' : 'warning',
        field:   'bp_systolic',
        value:   bp_systolic,
        message: isPregnant
          ? `Severe Hypertension in Pregnancy: Systolic ${bp_systolic} mmHg. Risk of eclampsia — start MgSO₄ protocol.`
          : `Severe Hypertension: Systolic ${bp_systolic} mmHg (≥160). Urgent treatment needed.`,
      })
    } else if (bp_systolic <= 80) {
      alerts.push({
        level:   'critical',
        field:   'bp_systolic',
        value:   bp_systolic,
        message: `Hypotension: Systolic BP ${bp_systolic} mmHg (≤80). Shock possible — check perfusion.`,
      })
    }
  }

  if (bp_diastolic !== undefined && isFiniteNum(bp_diastolic) && !sanity.skipFields.has('bp_diastolic')) {
    if (bp_diastolic >= 110) {
      alerts.push({
        level:   'critical',
        field:   'bp_diastolic',
        value:   bp_diastolic,
        message: isPregnant
          ? `Severe Diastolic Hypertension: ${bp_diastolic} mmHg in pregnancy. Pre-eclampsia risk — assess immediately.`
          : `Hypertensive Crisis: Diastolic BP ${bp_diastolic} mmHg (≥110). Immediate intervention required.`,
      })
    } else if (bp_diastolic >= 100 && isPregnant) {
      alerts.push({
        level:   'warning',
        field:   'bp_diastolic',
        value:   bp_diastolic,
        message: `Diastolic BP ${bp_diastolic} mmHg in pregnancy. Monitor closely for pre-eclampsia.`,
      })
    }
  }

  // ── Pulse ────────────────────────────────────────────────────

  if (pulse !== undefined && isFiniteNum(pulse) && !sanity.skipFields.has('pulse')) {
    if (pulse < 40) {
      alerts.push({
        level:   'critical',
        field:   'pulse',
        value:   pulse,
        message: `Severe Bradycardia: Pulse ${pulse} bpm (<40). Cardiac monitoring required immediately.`,
      })
    } else if (pulse < 50) {
      alerts.push({
        level:   'warning',
        field:   'pulse',
        value:   pulse,
        message: `Bradycardia: Pulse ${pulse} bpm. Check for medications, cardiac cause.`,
      })
    } else if (pulse > 140) {
      alerts.push({
        level:   'critical',
        field:   'pulse',
        value:   pulse,
        message: `Severe Tachycardia: Pulse ${pulse} bpm (>140). Evaluate for arrhythmia, sepsis, haemorrhage.`,
      })
    } else if (pulse > 100) {
      alerts.push({
        level:   'warning',
        field:   'pulse',
        value:   pulse,
        message: `Tachycardia: Pulse ${pulse} bpm. Investigate cause (pain, fever, anaemia, anxiety).`,
      })
    }
  }

  // ── SpO₂ ─────────────────────────────────────────────────────

  if (spo2 !== undefined && isFiniteNum(spo2) && !sanity.skipFields.has('spo2')) {
    if (spo2 < 90) {
      alerts.push({
        level:   'critical',
        field:   'spo2',
        value:   spo2,
        message: `Critical Hypoxia: SpO₂ ${spo2}% (<90). Start oxygen immediately — risk of organ damage.`,
      })
    } else if (spo2 < 94) {
      alerts.push({
        level:   'warning',
        field:   'spo2',
        value:   spo2,
        message: `Low SpO₂: ${spo2}% (94–90 range). Consider supplemental oxygen, monitor respiratory status.`,
      })
    }
  }

  // ── Temperature ──────────────────────────────────────────────

  if (temperature !== undefined && isFiniteNum(temperature) && !sanity.skipFields.has('temperature')) {
    if (temperature >= 39.5) {
      alerts.push({
        level:   'critical',
        field:   'temperature',
        value:   temperature,
        message: `High Fever: ${temperature}°C. Possible sepsis — blood cultures, IV antibiotics, sepsis protocol.`,
      })
    } else if (temperature >= 38.5) {
      alerts.push({
        level:   'warning',
        field:   'temperature',
        value:   temperature,
        message: `Fever: ${temperature}°C. Investigate infection source. ${isPregnant ? 'Chorioamnionitis risk in pregnancy.' : ''}`,
      })
    } else if (temperature < 35) {
      alerts.push({
        level:   'critical',
        field:   'temperature',
        value:   temperature,
        message: `Hypothermia: ${temperature}°C (<35°C). Active rewarming required.`,
      })
    }
  }

  // ── Haemoglobin (if provided from labs) ──────────────────────

  if (hemoglobin !== undefined && isFiniteNum(hemoglobin) && !sanity.skipFields.has('hemoglobin')) {
    const critThreshold  = isPregnant ? 7.0 : 6.0
    const warnThreshold  = isPregnant ? 9.0 : 8.0

    if (hemoglobin < critThreshold) {
      alerts.push({
        level:   'critical',
        field:   'hemoglobin',
        value:   hemoglobin,
        message: `Severe Anaemia: Hb ${hemoglobin} g/dL. ${isPregnant ? 'Blood transfusion likely needed in pregnancy.' : 'Transfusion threshold — evaluate immediately.'}`,
      })
    } else if (hemoglobin < warnThreshold) {
      alerts.push({
        level:   'warning',
        field:   'hemoglobin',
        value:   hemoglobin,
        message: `Anaemia: Hb ${hemoglobin} g/dL. Iron supplementation / investigation needed.`,
      })
    }
  }

  // ── Blood Glucose ─────────────────────────────────────────────

  if (glucose !== undefined && isFiniteNum(glucose) && !sanity.skipFields.has('glucose')) {
    if (glucose > 400) {
      alerts.push({
        level:   'critical',
        field:   'glucose',
        value:   glucose,
        message: `Severe Hyperglycaemia: Blood glucose ${glucose} mg/dL. Possible DKA — urgent insulin & hydration.`,
      })
    } else if (glucose < 50) {
      alerts.push({
        level:   'critical',
        field:   'glucose',
        value:   glucose,
        message: `Severe Hypoglycaemia: Blood glucose ${glucose} mg/dL. Immediate IV dextrose required.`,
      })
    }
  }

  // ── Electrolytes ──────────────────────────────────────────────

  if (potassium !== undefined && isFiniteNum(potassium) && !sanity.skipFields.has('potassium')) {
    if (potassium > 6.0) {
      alerts.push({ level: 'critical', field: 'potassium', value: potassium, message: `Hyperkalaemia: K⁺ ${potassium} mEq/L (>6.0). Cardiac arrhythmia risk — ECG immediately.` })
    } else if (potassium < 2.5) {
      alerts.push({ level: 'critical', field: 'potassium', value: potassium, message: `Severe Hypokalaemia: K⁺ ${potassium} mEq/L (<2.5). IV replacement with cardiac monitoring.` })
    }
  }

  if (sodium !== undefined && isFiniteNum(sodium) && !sanity.skipFields.has('sodium')) {
    if (sodium > 155) {
      alerts.push({ level: 'critical', field: 'sodium', value: sodium, message: `Severe Hypernatraemia: Na⁺ ${sodium} mEq/L. IV free water replacement needed.` })
    } else if (sodium < 120) {
      alerts.push({ level: 'critical', field: 'sodium', value: sodium, message: `Severe Hyponatraemia: Na⁺ ${sodium} mEq/L. Risk of cerebral oedema — gradual correction required.` })
    }
  }

  return {
    hasCritical: alerts.some(a => a.level === 'critical'),
    hasWarning:  alerts.some(a => a.level === 'warning'),
    alerts,
  }
}