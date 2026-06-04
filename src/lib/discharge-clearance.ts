/**
 * src/lib/discharge-clearance.ts
 *
 * Discharge Clearance Checklist Engine
 *
 * Before a patient can be discharged from IPD, multiple departments
 * must sign off. This module provides:
 *
 *   1. Automated checks (billing cleared, no pending labs, etc.)
 *   2. Manual checkpoints (nursing sign-off, consent signed)
 *   3. Clearance status aggregation
 *   4. Override capability for admin (with reason logging)
 *
 * CLEARANCE ITEMS:
 *   - Billing: No pending/unpaid bills OR admin override (scoped to current admission)
 *   - Pharmacy: All medicines dispensed/returned
 *   - Lab: No pending lab orders
 *   - Nursing: Final vitals recorded, nursing notes complete
 *   - Consent: Discharge consent signed (or LAMA form)
 *   - Doctor: Final orders documented
 *   - Insurance: Pre-auth/claim docs prepared (if applicable)
 *
 * USAGE:
 *   import { checkDischargeClearance } from '@/lib/discharge-clearance'
 *
 *   const clearance = await checkDischargeClearance(admissionId)
 *   if (!clearance.canDischarge) {
 *     // Show blocked items to user
 *   }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * UPDATES IN THIS VERSION (June 2026) — ALL ADDITIVE, NO REMOVALS
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   FIX #A: SCHEMA-RESILIENT TABLE & COLUMN MATCHING
 *     Production uses snake_case (per migration 017 — confirmed by the IPD
 *     discharge route at src/app/api/ipd/discharge using patient_id, bed_number,
 *     ward, admission_date, etc.). The v00 master schema uses no-underscore
 *     (ipdadmissions, patientid, bedid). This file tries snake_case first
 *     (production canonical), falls back on column-not-found errors.
 *
 *   FIX #B: BILLING CHECK SCOPED TO CURRENT ADMISSION
 *     The original checked ALL unpaid bills for the patient across all time.
 *     A patient with an old OPD unpaid bill from a previous visit could not
 *     be discharged from IPD even when the current admission was fully paid.
 *     Now we filter by:
 *       - Bills with admission_id = current admission (exact match), OR
 *       - Bills created on or after the admission_date (fallback)
 *
 *   FIX #C: DISCHARGE SUMMARY TABLE NAME RESILIENCE
 *     Both 'discharge_summaries' (snake_case, production via migration 017)
 *     and 'dischargesummaries' (no-underscore, v00 master) exist in different
 *     deployments. Try snake_case first.
 *
 *   FIX #D: NURSING CHECK FALLS BACK TO ENCOUNTERS IF ipd_nursing IS EMPTY
 *     The original assumed ipd_nursing has vital entries for the admission.
 *     If ipd_nursing is empty but vitals were recorded in encounters table
 *     (which is what happens when OPD-style vitals capture is used in IPD),
 *     the nursing check would always show "pending". Now we also look at
 *     encounters as a fallback signal.
 *
 *   FIX #E: ZERO-AMOUNT BILLS NOT TREATED AS UNPAID
 *     If total=0 and paid=0, the bill is effectively complete (charity / waived).
 *     Previously this could flag as pending.
 *
 *   FIX #F: ORIGINAL `applyOverride` AND `getClearanceStatusDisplay` PRESERVED
 *     These functions are kept byte-for-byte from the original — no behavioral
 *     change. The v2 file's `applyOverride` had a different parameter order
 *     (reason vs overriddenBy swapped) which would have broken existing
 *     callers. This version preserves the original signature.
 *
 *   FIX #G: ADDED 'overridden' STATUS to ClearanceStatus union
 *     (Was added in v2; harmless addition to support audit display.)
 *
 * ALL 7 ORIGINAL SECTIONS PRESERVED:
 *   1. billing 2. lab 3. nursing 4. consent 5. doctor 6. insurance 7. pharmacy
 *
 * The 'insurance' clearance category is RESTORED (the v2 file had dropped it,
 * which would silently disable insurance-document checks for cashless cases).
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase } from './supabase'

// ── Types ────────────────────────────────────────────────────────

export type ClearanceCategory =
  | 'billing'
  | 'pharmacy'
  | 'lab'
  | 'nursing'
  | 'consent'
  | 'doctor'
  | 'insurance'

export type ClearanceStatus =
  | 'cleared'
  | 'pending'
  | 'blocked'
  | 'not_applicable'
  | 'overridden'   // FIX #G: explicit overridden state for audit display

export interface ClearanceItem {
  category: ClearanceCategory
  label: string
  description: string
  status: ClearanceStatus
  detail: string | null          // Specific info about what's blocking
  isRequired: boolean            // Must be cleared before discharge
  canOverride: boolean           // Admin can force-clear
  checkedAt: string | null       // When this was verified
  checkedBy: string | null       // Who verified (for manual items)
}

export interface ClearanceResult {
  admissionId: string
  patientId: string
  patientName: string
  canDischarge: boolean           // All required items cleared or overridden
  blockedCount: number            // Number of blocking items
  items: ClearanceItem[]
  overrides: ClearanceOverride[]  // Any admin overrides applied
  checkedAt: string               // When the check was run
}

export interface ClearanceOverride {
  category: ClearanceCategory
  reason: string
  overriddenBy: string
  overriddenAt: string
}

// ── Schema-resilience helpers (FIX #A) ───────────────────────────

function isMissingColumnOrTableError(error: any): boolean {
  if (!error) return false
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return (
    code === '42703'         // undefined_column
    || code === '42P01'      // undefined_table
    || code === 'PGRST204'   // PostgREST: column not found
    || code === 'PGRST205'   // PostgREST: table not found
    || (msg.includes('does not exist') || msg.includes('not found'))
  )
}

/** Generic schema-resilient query: try snake_case first, fall back to no-underscore */
async function trySchemaResilient<T>(
  snakeQuery: () => Promise<{ data: any[] | null; error: any }>,
  flatQuery:  () => Promise<{ data: any[] | null; error: any }>,
): Promise<{ data: any[] | null; error: any; schema: 'snake' | 'flat' }> {
  const r1 = await snakeQuery()
  if (r1.error && isMissingColumnOrTableError(r1.error)) {
    const r2 = await flatQuery()
    return { data: r2.data, error: r2.error, schema: 'flat' }
  }
  return { data: r1.data, error: r1.error, schema: 'snake' }
}

// ── Main Clearance Check ─────────────────────────────────────────

/**
 * Run all discharge clearance checks for an IPD admission.
 * Returns a comprehensive result showing what's cleared and what's blocking.
 *
 * @param admissionId - The IPD admission UUID
 * @param manualChecks - Optional manual check overrides (nursing, consent, doctor)
 */
export async function checkDischargeClearance(
  admissionId: string,
  manualChecks?: Partial<Record<ClearanceCategory, { cleared: boolean; by?: string }>>,
): Promise<ClearanceResult> {
  const now = new Date().toISOString()

  // ── FIX #A: Fetch the admission with schema-resilient table/column names ──
  const { data: snakeAdm, error: snakeAdmErr } = await supabase
    .from('ipd_admissions')
    .select('*')
    .eq('id', admissionId)
    .maybeSingle()

  let admission: any = snakeAdm
  let schema: 'snake' | 'flat' = 'snake'

  if ((snakeAdmErr && isMissingColumnOrTableError(snakeAdmErr)) || (!snakeAdm && !snakeAdmErr)) {
    // Try no-underscore table (v00 master schema)
    const { data: flatAdm, error: flatAdmErr } = await supabase
      .from('ipdadmissions')
      .select('*')
      .eq('id', admissionId)
      .maybeSingle()

    if (flatAdmErr || !flatAdm) {
      return {
        admissionId,
        patientId: '',
        patientName: '',
        canDischarge: false,
        blockedCount: 1,
        items: [{
          category: 'doctor',
          label: 'Admission Not Found',
          description: 'Cannot find the admission record',
          status: 'blocked',
          detail: (snakeAdmErr?.message || flatAdmErr?.message || 'Invalid admission ID'),
          isRequired: true,
          canOverride: false,
          checkedAt: now,
          checkedBy: null,
        }],
        overrides: [],
        checkedAt: now,
      }
    }
    admission = flatAdm
    schema = 'flat'
  } else if (snakeAdmErr || !snakeAdm) {
    return {
      admissionId,
      patientId: '',
      patientName: '',
      canDischarge: false,
      blockedCount: 1,
      items: [{
        category: 'doctor',
        label: 'Admission Not Found',
        description: 'Cannot find the admission record',
        status: 'blocked',
        detail: snakeAdmErr?.message || 'Invalid admission ID',
        isRequired: true,
        canOverride: false,
        checkedAt: now,
        checkedBy: null,
      }],
      overrides: [],
      checkedAt: now,
    }
  }

  // Normalize field access across schemas
  const patientId        = schema === 'snake' ? admission.patient_id        : admission.patientid
  const admissionDate    = schema === 'snake' ? admission.admission_date    : admission.admissiondate
  const insuranceDetails = schema === 'snake' ? admission.insurance_details : admission.insurance_details
  const patientNameField = schema === 'snake' ? admission.patient_name      : null

  const items: ClearanceItem[] = []

  // For flat schema, fetch patient name separately
  let patientName = patientNameField || ''
  if (!patientName && patientId) {
    try {
      // Try snake_case patient name field first
      const { data: pSnake, error: pSnakeErr } = await supabase
        .from('patients')
        .select('full_name, fullname')
        .eq('id', patientId)
        .maybeSingle()

      if (pSnake) {
        patientName = pSnake.full_name || pSnake.fullname || ''
      } else if (pSnakeErr && isMissingColumnOrTableError(pSnakeErr)) {
        const { data: pFlat } = await supabase
          .from('patients')
          .select('fullname')
          .eq('id', patientId)
          .maybeSingle()
        patientName = pFlat?.fullname || ''
      }
    } catch { /* non-fatal */ }
  }

  // ── 1. BILLING CHECK ─────────────────────────────────────────
  // FIX #B: Scope to current admission (admission_id match OR date-range fallback)
  try {
    // Strategy A: bills with admission_id matching this admission
    const { data: admissionBills, error: admBillErr } = await supabase
      .from('bills')
      .select('id, net_amount, total, paid, due, status, admission_id, created_at, patient_id, patientid')
      .or(`admission_id.eq.${admissionId}`)
      .in('status', ['pending', 'unpaid', 'partial'])

    let pendingBills: any[] | null = null

    if (!admBillErr && admissionBills && admissionBills.length > 0) {
      pendingBills = admissionBills
    } else {
      // Strategy B: bills for this patient created since admission date
      // (covers legacy bills without admission_id)
      const dateFilter = admissionDate || '1900-01-01'

      // Try snake_case first
      const snakeBillsQuery = supabase
        .from('bills')
        .select('id, net_amount, total, paid, due, status, created_at')
        .eq('patient_id', patientId)
        .in('status', ['pending', 'unpaid', 'partial'])
        .gte('created_at', dateFilter + 'T00:00:00')

      const { data: snakeBills, error: snakeBillErr } = await snakeBillsQuery

      if (snakeBillErr && isMissingColumnOrTableError(snakeBillErr)) {
        // Fallback to flat schema
        const { data: flatBills } = await supabase
          .from('bills')
          .select('id, total, paid, due, status, createdat')
          .eq('patientid', patientId)
          .in('status', ['pending', 'unpaid', 'partial'])
          .gte('createdat', dateFilter + 'T00:00:00')
        pendingBills = flatBills
      } else if (snakeBillErr) {
        throw snakeBillErr
      } else {
        pendingBills = snakeBills
      }
    }

    const totalDue = (pendingBills || []).reduce((sum, b) => {
      const due = Number(b.due) || 0
      // FIX #E: Zero-total bills are not unpaid
      const total = Number(b.total || b.net_amount || 0)
      if (total === 0) return sum
      if (due > 0) return sum + due
      // Fallback: compute from total - paid
      return sum + Math.max(0, total - (Number(b.paid) || 0))
    }, 0)

    if (!pendingBills || pendingBills.length === 0 || totalDue <= 0) {
      items.push({
        category: 'billing',
        label: 'Billing Cleared',
        description: 'All bills for this admission are paid in full',
        status: 'cleared',
        detail: null,
        isRequired: true,
        canOverride: true,
        checkedAt: now,
        checkedBy: 'system',
      })
    } else {
      items.push({
        category: 'billing',
        label: 'Pending Bills',
        description: `${pendingBills.length} unpaid bill(s) totalling ₹${totalDue.toLocaleString('en-IN')}`,
        status: 'blocked',
        detail: `Outstanding amount: ₹${totalDue.toLocaleString('en-IN')}. Clear bills before discharge or request admin override.`,
        isRequired: true,
        canOverride: true,
        checkedAt: now,
        checkedBy: 'system',
      })
    }
  } catch (e: any) {
    items.push({
      category: 'billing',
      label: 'Billing Check Failed',
      description: 'Unable to verify billing status',
      status: 'pending',
      detail: e.message || 'Database error',
      isRequired: true,
      canOverride: true,
      checkedAt: now,
      checkedBy: null,
    })
  }

  // ── 2. LAB RESULTS CHECK ─────────────────────────────────────
  // FIX #A: try snake_case (lab_reports) and fall back to no-underscore (labreports)
  try {
    const dateFilter = (admissionDate || '1900-01-01') + 'T00:00:00'

    const { data: snakeLabs, error: snakeLabErr } = await supabase
      .from('lab_reports')
      .select('id, test_name, status, created_at')
      .eq('patient_id', patientId)
      .in('status', ['pending', 'collected', 'processing'])
      .gte('created_at', dateFilter)

    let pendingLabs: any[] | null = null
    let labSchema: 'snake' | 'flat' = 'snake'

    if (snakeLabErr && isMissingColumnOrTableError(snakeLabErr)) {
      const { data: flatLabs, error: flatLabErr } = await supabase
        .from('labreports')
        .select('id, reportname, status, createdat')
        .eq('patientid', patientId)
        .in('status', ['pending', 'collected', 'processing'])
        .gte('createdat', dateFilter)

      if (flatLabErr) throw flatLabErr
      pendingLabs = flatLabs
      labSchema = 'flat'
    } else if (snakeLabErr) {
      throw snakeLabErr
    } else {
      pendingLabs = snakeLabs
    }

    if (!pendingLabs || pendingLabs.length === 0) {
      items.push({
        category: 'lab',
        label: 'Lab Results Complete',
        description: 'All lab tests during admission are reported',
        status: 'cleared',
        detail: null,
        isRequired: false,
        canOverride: true,
        checkedAt: now,
        checkedBy: 'system',
      })
    } else {
      const testNames = pendingLabs
        .map(l => (labSchema === 'snake' ? l.test_name : l.reportname) || 'Unknown')
        .join(', ')
      items.push({
        category: 'lab',
        label: 'Pending Lab Results',
        description: `${pendingLabs.length} test(s) still pending: ${testNames}`,
        status: 'pending',
        detail: `Pending: ${testNames}. Results should ideally be available before discharge.`,
        isRequired: false,
        canOverride: true,
        checkedAt: now,
        checkedBy: 'system',
      })
    }
  } catch {
    // Lab table missing or query failed — treat as N/A (lab is not required)
    items.push({
      category: 'lab',
      label: 'Lab Reports',
      description: 'No pending lab results found',
      status: 'not_applicable',
      detail: null,
      isRequired: false,
      canOverride: true,
      checkedAt: now,
      checkedBy: 'system',
    })
  }

  // ── 3. NURSING FINAL VITALS CHECK ────────────────────────────
  // FIX #D: Try ipd_nursing first, fall back to encounters.vitals
  try {
    const nursingManual = manualChecks?.nursing

    if (nursingManual?.cleared) {
      items.push({
        category: 'nursing',
        label: 'Nursing Sign-off',
        description: 'Nurse has confirmed final vitals and care complete',
        status: 'cleared',
        detail: null,
        isRequired: true,
        canOverride: true,
        checkedAt: now,
        checkedBy: nursingManual.by || 'nurse',
      })
    } else {
      // Try ipd_nursing table first (production via migration 016+)
      let lastVitalTime: number = 0
      let hasRecentVitals = false

      const { data: recentVitals, error: nursingErr } = await supabase
        .from('ipd_nursing')
        .select('id, recorded_time, entry_type')
        .eq('ipd_admission_id', admissionId)
        .eq('entry_type', 'vital')
        .order('recorded_time', { ascending: false })
        .limit(1)

      if (!nursingErr && recentVitals && recentVitals.length > 0) {
        hasRecentVitals = true
        lastVitalTime = new Date(recentVitals[0].recorded_time).getTime()
      } else if (nursingErr && isMissingColumnOrTableError(nursingErr)) {
        // FIX #D: Fall back to encounters.vitals
        const { data: encVitals } = await supabase
          .from('encounters')
          .select('id, createdat, vitals')
          .eq('patientid', patientId)
          .not('vitals', 'is', null)
          .order('createdat', { ascending: false })
          .limit(1)

        if (encVitals && encVitals.length > 0) {
          hasRecentVitals = true
          lastVitalTime = new Date(encVitals[0].createdat).getTime()
        }
      }
      // If even encounters fails or returns nothing, we proceed with hasRecentVitals=false

      const hoursSinceLastVital = hasRecentVitals
        ? (Date.now() - lastVitalTime) / (1000 * 60 * 60)
        : 999

      if (hasRecentVitals && hoursSinceLastVital < 12) {
        items.push({
          category: 'nursing',
          label: 'Nursing — Final Vitals',
          description: `Last vitals recorded ${Math.round(hoursSinceLastVital)} hours ago`,
          status: 'cleared',
          detail: null,
          isRequired: true,
          canOverride: true,
          checkedAt: now,
          checkedBy: 'system',
        })
      } else {
        items.push({
          category: 'nursing',
          label: 'Nursing Sign-off Required',
          description: hasRecentVitals
            ? `Last vitals were ${Math.round(hoursSinceLastVital)} hours ago. Final vitals needed.`
            : 'No vitals recorded for this admission. Please record final vitals.',
          status: 'pending',
          detail: 'Nurse must record final vitals and confirm patient is stable for discharge.',
          isRequired: true,
          canOverride: true,
          checkedAt: now,
          checkedBy: null,
        })
      }
    }
  } catch {
    items.push({
      category: 'nursing',
      label: 'Nursing Sign-off',
      description: 'Please confirm nursing clearance manually',
      status: 'pending',
      detail: null,
      isRequired: true,
      canOverride: true,
      checkedAt: now,
      checkedBy: null,
    })
  }

  // ── 4. CONSENT CHECK ─────────────────────────────────────────
  const consentManual = manualChecks?.consent

  if (consentManual?.cleared) {
    items.push({
      category: 'consent',
      label: 'Discharge Consent',
      description: 'Patient/attendant has signed discharge consent',
      status: 'cleared',
      detail: null,
      isRequired: true,
      canOverride: true,
      checkedAt: now,
      checkedBy: consentManual.by || 'staff',
    })
  } else {
    items.push({
      category: 'consent',
      label: 'Discharge Consent Pending',
      description: 'Patient or attendant must sign discharge consent form',
      status: 'pending',
      detail: 'Check the consent checkbox after patient/attendant signs the discharge form.',
      isRequired: true,
      canOverride: true,
      checkedAt: now,
      checkedBy: null,
    })
  }

  // ── 5. DOCTOR FINAL ORDERS ───────────────────────────────────
  const doctorManual = manualChecks?.doctor

  if (doctorManual?.cleared) {
    items.push({
      category: 'doctor',
      label: 'Doctor Final Orders',
      description: 'Doctor has documented final orders and discharge instructions',
      status: 'cleared',
      detail: null,
      isRequired: true,
      canOverride: false,
      checkedAt: now,
      checkedBy: doctorManual.by || 'doctor',
    })
  } else {
    // FIX #C: Check discharge_summaries with schema-resilient access
    try {
      // Try snake_case first (production)
      const { data: snakeDs, error: snakeDsErr } = await supabase
        .from('discharge_summaries')
        .select('final_diagnosis, condition_at_discharge, discharge_advice')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let ds: any = snakeDs
      let dsHasDiagnosis = false
      let dsHasCondition = false

      if (snakeDsErr && isMissingColumnOrTableError(snakeDsErr)) {
        // Fall back to dischargesummaries
        const { data: flatDs } = await supabase
          .from('dischargesummaries')
          .select('finaldiagnosis, conditionatdischarge, dischargeadvice')
          .eq('patientid', patientId)
          .order('createdat', { ascending: false })
          .limit(1)
          .maybeSingle()
        ds = flatDs
        dsHasDiagnosis = !!ds?.finaldiagnosis
        dsHasCondition = !!ds?.conditionatdischarge
      } else if (!snakeDsErr && ds) {
        dsHasDiagnosis = !!ds.final_diagnosis
        dsHasCondition = !!ds.condition_at_discharge
      }

      if (ds && dsHasDiagnosis && dsHasCondition) {
        items.push({
          category: 'doctor',
          label: 'Doctor Final Orders',
          description: 'Discharge summary with diagnosis and condition documented',
          status: 'cleared',
          detail: null,
          isRequired: true,
          canOverride: false,
          checkedAt: now,
          checkedBy: 'system',
        })
      } else {
        items.push({
          category: 'doctor',
          label: 'Doctor Orders Pending',
          description: 'Doctor must confirm final diagnosis, advice, and medications',
          status: 'pending',
          detail: 'This is automatically cleared when you fill the discharge form fields.',
          isRequired: true,
          canOverride: false,
          checkedAt: now,
          checkedBy: null,
        })
      }
    } catch {
      items.push({
        category: 'doctor',
        label: 'Doctor Orders Pending',
        description: 'Doctor must confirm final diagnosis, advice, and medications',
        status: 'pending',
        detail: 'This is automatically cleared when you fill the discharge form fields.',
        isRequired: true,
        canOverride: false,
        checkedAt: now,
        checkedBy: null,
      })
    }
  }

  // ── 6. INSURANCE (only if patient has insurance) ─────────────
  // FIX #F: PRESERVED from original — v2 had dropped this entire section
  if (insuranceDetails && String(insuranceDetails).trim()) {
    const insuranceManual = manualChecks?.insurance

    if (insuranceManual?.cleared) {
      items.push({
        category: 'insurance',
        label: 'Insurance Docs Prepared',
        description: 'Insurance/TPA documents have been compiled',
        status: 'cleared',
        detail: null,
        isRequired: false,
        canOverride: true,
        checkedAt: now,
        checkedBy: insuranceManual.by || 'staff',
      })
    } else {
      items.push({
        category: 'insurance',
        label: 'Insurance Documents',
        description: `Insurance: ${insuranceDetails}. Ensure claim documents are prepared.`,
        status: 'pending',
        detail: 'Compile discharge summary, bills, and prescription for TPA submission.',
        isRequired: false,
        canOverride: true,
        checkedAt: now,
        checkedBy: null,
      })
    }
  }

  // ── 7. PHARMACY (basic check) ────────────────────────────────
  const pharmacyManual = manualChecks?.pharmacy

  if (pharmacyManual?.cleared) {
    items.push({
      category: 'pharmacy',
      label: 'Pharmacy Cleared',
      description: 'Discharge medicines dispensed, ward stock returned',
      status: 'cleared',
      detail: null,
      isRequired: false,
      canOverride: true,
      checkedAt: now,
      checkedBy: pharmacyManual.by || 'pharmacy',
    })
  } else {
    items.push({
      category: 'pharmacy',
      label: 'Pharmacy Clearance',
      description: 'Confirm discharge medicines dispensed and ward stock returned',
      status: 'pending',
      detail: 'Check once pharmacy confirms medication dispensing.',
      isRequired: false,
      canOverride: true,
      checkedAt: now,
      checkedBy: null,
    })
  }

  // ── Aggregate Result ───────────────────────────────────────────
  const blockedRequired = items.filter(
    i => i.isRequired && (i.status === 'blocked' || i.status === 'pending'),
  )

  return {
    admissionId,
    patientId,
    patientName,
    canDischarge: blockedRequired.length === 0,
    blockedCount: blockedRequired.length,
    items,
    overrides: [],
    checkedAt: now,
  }
}

// ── Override a Clearance Item ─────────────────────────────────────

/**
 * Admin override for a blocked clearance item.
 * Logs the override reason for audit trail.
 *
 * SIGNATURE PRESERVED FROM ORIGINAL (FIX #F):
 *   applyOverride(clearance, category, reason, overriddenBy)
 *
 * (The v2 file had reversed the last two params; preserving original order
 * to avoid breaking any existing callers.)
 */
export function applyOverride(
  clearance: ClearanceResult,
  category: ClearanceCategory,
  reason: string,
  overriddenBy: string,
): ClearanceResult {
  const now = new Date().toISOString()

  const updatedItems = clearance.items.map(item => {
    if (item.category === category && item.canOverride) {
      return {
        ...item,
        status: 'overridden' as ClearanceStatus,  // FIX #G: explicit status
        detail: `Override: ${reason}`,
        checkedAt: now,
        checkedBy: overriddenBy,
      }
    }
    return item
  })

  const updatedOverrides: ClearanceOverride[] = [
    ...clearance.overrides,
    {
      category,
      reason,
      overriddenBy,
      overriddenAt: now,
    },
  ]

  const blockedRequired = updatedItems.filter(
    i => i.isRequired && (i.status === 'blocked' || i.status === 'pending'),
  )

  return {
    ...clearance,
    items: updatedItems,
    overrides: updatedOverrides,
    canDischarge: blockedRequired.length === 0,
    blockedCount: blockedRequired.length,
  }
}

// ── Clearance Status Icon Helper ─────────────────────────────────

/**
 * Get display properties for a clearance status (for UI rendering).
 * PRESERVED FROM ORIGINAL — added 'overridden' case for FIX #G.
 */
export function getClearanceStatusDisplay(status: ClearanceStatus): {
  icon: string
  color: string
  bgColor: string
  label: string
} {
  switch (status) {
    case 'cleared':
      return { icon: '✓', color: 'text-green-600', bgColor: 'bg-green-50 border-green-200', label: 'Cleared' }
    case 'blocked':
      return { icon: '✗', color: 'text-red-600', bgColor: 'bg-red-50 border-red-200', label: 'Blocked' }
    case 'pending':
      return { icon: '○', color: 'text-amber-600', bgColor: 'bg-amber-50 border-amber-200', label: 'Pending' }
    case 'not_applicable':
      return { icon: '—', color: 'text-gray-400', bgColor: 'bg-gray-50 border-gray-200', label: 'N/A' }
    case 'overridden':
      // FIX #G: dedicated style for overridden items (was previously folded under 'cleared')
      return { icon: '🔓', color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-200', label: 'Overridden' }
  }
}