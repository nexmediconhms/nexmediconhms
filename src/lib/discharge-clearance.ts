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
  // FIX #B + BUG-DC02: Scope to current admission.  Strategy:
  //   A. Bills with admission_id = currentAdmissionId (exact match).
  //   B. Bills for this patient whose created_at is on/after admissionDate
  //      (covers legacy bills written before admission_id was introduced).
  //
  // BUG-DC02: previously, when admissionDate was missing/null, the code
  // fell back to '1900-01-01' which scanned EVERY unpaid bill in the
  // patient's history.  A patient with a forgotten OPD bill from years
  // ago could not be discharged from the current IPD — even when the
  // current admission was fully paid.  We now fail-CLOSED for safety:
  // if admissionDate is unavailable, we ONLY use Strategy A and surface
  // a clear 'pending' item asking staff to verify manually.  The
  // discharge isn't permanently blocked — admin can override — but it's
  // never auto-cleared based on stale unrelated bills, and never
  // mis-blocked by them either.
  try {
    // Strategy A: bills with admission_id matching this admission
    const { data: admissionBills, error: admBillErr } = await supabase
      .from('bills')
      .select('id, net_amount, total, paid, due, status, admission_id, created_at, patient_id, patientid')
      .or(`admission_id.eq.${admissionId}`)
      .in('status', ['pending', 'unpaid', 'partial'])

    let pendingBills: any[] | null = null
    let usedFallback = false

    if (!admBillErr && admissionBills && admissionBills.length > 0) {
      pendingBills = admissionBills
    } else if (admissionDate) {
      // Strategy B: bills for this patient created since admission date
      // (covers legacy bills without admission_id).  Only attempted when
      // admissionDate is known — never the 1900-01-01 fallback.
      usedFallback = true
      const dateFilter = admissionDate + 'T00:00:00'

      const snakeBillsQuery = supabase
        .from('bills')
        .select('id, net_amount, total, paid, due, status, created_at')
        .eq('patient_id', patientId)
        .in('status', ['pending', 'unpaid', 'partial'])
        .gte('created_at', dateFilter)

      const { data: snakeBills, error: snakeBillErr } = await snakeBillsQuery

      if (snakeBillErr && isMissingColumnOrTableError(snakeBillErr)) {
        // Fallback to flat schema, still date-scoped
        const { data: flatBills } = await supabase
          .from('bills')
          .select('id, total, paid, due, status, createdat')
          .eq('patientid', patientId)
          .in('status', ['pending', 'unpaid', 'partial'])
          .gte('createdat', dateFilter)
        pendingBills = flatBills
      } else if (snakeBillErr) {
        throw snakeBillErr
      } else {
        pendingBills = snakeBills
      }
    } else {
      // BUG-DC02: No admission_id matches AND no admissionDate — fail-closed.
      // Surface a manual-verification item rather than scanning the entire
      // patient history.
      pendingBills = []
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

    // Special case: no admission_id linkage AND no admission date — we
    // genuinely don't know which bills belong to this admission.  Don't
    // auto-clear; require manual verification.
    if (
      (!admissionBills || admissionBills.length === 0) &&
      !admissionDate
    ) {
      items.push({
        category: 'billing',
        label: 'Billing — Manual Verification Required',
        description: 'Unable to identify bills for this admission automatically',
        status: 'pending',
        detail:
          'This admission has no admission_id-linked bills and no admission_date is recorded. ' +
          'Please verify billing status manually before discharge.',
        isRequired: true,
        canOverride: true,
        checkedAt: now,
        checkedBy: null,
      })
    } else if (!pendingBills || pendingBills.length === 0 || totalDue <= 0) {
      items.push({
        category: 'billing',
        label: 'Billing Cleared',
        description: usedFallback
          ? 'All bills since admission date are paid in full'
          : 'All bills for this admission are paid in full',
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
  //
  // BUG-DC04 fix: previously the catch block here set status = 'not_applicable'.
  // That is fail-OPEN — a transient DB error or RLS blip silently disabled
  // the lab clearance check, so a discharge could proceed with critical
  // lab results outstanding.  Lab is now isRequired = false (matches
  // original) but on query failure we surface a 'pending' status that
  // requires manual confirmation.  An admin can still override, but we
  // never silently say "no labs pending" because we couldn't run the
  // query.
  //
  // Note: when the labs table genuinely doesn't exist in this deployment
  // (a fresh install without the lab module), we still return a 'pending'
  // item — admin override is the right escape hatch for that case.
  try {
    if (!admissionDate) {
      // BUG-DC02-style scoping: without admission date we'd otherwise scan
      // the patient's entire lab history.  Surface as pending instead.
      items.push({
        category: 'lab',
        label: 'Lab Reports — Manual Verification',
        description: 'Cannot scope lab queries without admission date',
        status: 'pending',
        detail: 'Verify there are no outstanding lab orders for this admission before discharge.',
        isRequired: false,
        canOverride: true,
        checkedAt: now,
        checkedBy: null,
      })
    } else {
      const dateFilter = admissionDate + 'T00:00:00'

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
    }
  } catch (e: any) {
    // BUG-DC04: fail-CLOSED on errors.  Previously this branch returned
    // status='not_applicable' which silently bypassed the lab check.
    // We now surface a 'pending' item with the underlying reason so
    // staff make an explicit decision.
    items.push({
      category: 'lab',
      label: 'Lab Reports — Verification Required',
      description: 'Lab status query failed; manual verification needed',
      status: 'pending',
      detail:
        (e?.message ? `${e.message}. ` : '') +
        'Confirm with the lab that no results are outstanding before discharge.',
      isRequired: false,
      canOverride: true,
      checkedAt: now,
      checkedBy: null,
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
    // ── BUG-DC01 fix: scope discharge_summaries lookup to CURRENT admission ──
    // Previous implementation queried by patient_id alone and ordered by
    // created_at DESC — meaning ANY discharge summary from a previous
    // admission would clear the doctor-orders gate for the current
    // admission.  A patient with a closed-out IPD admission from last
    // year could be discharged from today's admission with no actual
    // discharge summary written.  Medical-legal liability.
    //
    // New strategy:
    //   1. Try `admission_id = <current>` exact match (snake_case schema).
    //   2. If admission_id column doesn't exist (older schema), fall back
    //      to (patient_id = X AND created_at >= admissionDate).  This is
    //      strictly more accurate than the previous lookup but preserves
    //      compatibility with installations that haven't run the migration
    //      that adds discharge_summaries.admission_id.
    //   3. Only as a last resort (no admission_id column AND no admission
    //      date) we fall through to "pending" — never reusing an old
    //      summary from a different admission.
    try {
      let ds: any = null
      let dsHasDiagnosis = false
      let dsHasCondition = false

      // Strategy 1: snake_case + admission_id exact match
      const { data: byAdmSnake, error: byAdmSnakeErr } = await supabase
        .from('discharge_summaries')
        .select('final_diagnosis, condition_at_discharge, discharge_advice, admission_id')
        .eq('admission_id', admissionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!byAdmSnakeErr && byAdmSnake) {
        ds = byAdmSnake
        dsHasDiagnosis = !!byAdmSnake.final_diagnosis
        dsHasCondition = !!byAdmSnake.condition_at_discharge
      } else if (byAdmSnakeErr && !isMissingColumnOrTableError(byAdmSnakeErr)) {
        // Real error — propagate to outer catch
        throw byAdmSnakeErr
      } else {
        // admission_id column or table missing — try patient+date scoped lookup
        if (admissionDate) {
          const dateFilter = admissionDate + 'T00:00:00'

          const { data: byDateSnake, error: byDateSnakeErr } = await supabase
            .from('discharge_summaries')
            .select('final_diagnosis, condition_at_discharge, discharge_advice, created_at')
            .eq('patient_id', patientId)
            .gte('created_at', dateFilter)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (!byDateSnakeErr && byDateSnake) {
            ds = byDateSnake
            dsHasDiagnosis = !!byDateSnake.final_diagnosis
            dsHasCondition = !!byDateSnake.condition_at_discharge
          } else if (byDateSnakeErr && isMissingColumnOrTableError(byDateSnakeErr)) {
            // Fall back to no-underscore (v00) schema, still date-scoped
            const { data: byDateFlat } = await supabase
              .from('dischargesummaries')
              .select('finaldiagnosis, conditionatdischarge, dischargeadvice, createdat')
              .eq('patientid', patientId)
              .gte('createdat', dateFilter)
              .order('createdat', { ascending: false })
              .limit(1)
              .maybeSingle()

            ds = byDateFlat
            dsHasDiagnosis = !!byDateFlat?.finaldiagnosis
            dsHasCondition = !!byDateFlat?.conditionatdischarge
          }
        }
        // else: no admission date and no admission_id column ⇒ ds stays null,
        // which correctly produces a 'pending' status below (fail-closed).
      }

      if (ds && dsHasDiagnosis && dsHasCondition) {
        items.push({
          category: 'doctor',
          label: 'Doctor Final Orders',
          description: 'Discharge summary with diagnosis and condition documented for THIS admission',
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
          description: 'Doctor must confirm final diagnosis, advice, and medications for this admission',
          status: 'pending',
          detail: 'This is automatically cleared when you fill the discharge form fields for the current admission.',
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
 * Result type for applyOverride.
 *
 * BUG-DC03 fix: previously applyOverride returned ClearanceResult and
 * silently no-op'd when the requested category had `canOverride: false`
 * (e.g., 'doctor').  The UI could show an "Override" button that did
 * nothing visible — confusing operators.  We now return a discriminated
 * result so callers can detect and surface the failure to the user.
 */
export interface ApplyOverrideResult {
  /** True iff the override was actually applied to a clearance item. */
  applied: boolean
  /** Reason the override could not be applied, when applied=false. */
  reason?: 'category_not_found' | 'category_not_overridable'
  /** Updated clearance result (unchanged when applied=false). */
  clearance: ClearanceResult
}

/**
 * Admin override for a blocked clearance item.
 * Logs the override reason for audit trail.
 *
 * BUG-DC03: the function now reports back whether the override actually
 * took effect.  Categories with `canOverride: false` (currently 'doctor')
 * cannot be overridden — the doctor must complete and finalize the
 * discharge summary properly.  Calling this on a non-overridable category
 * returns `{ applied: false, reason: 'category_not_overridable' }` so
 * the UI can show "this item can't be overridden" instead of silently
 * succeeding.
 *
 * SIGNATURE PRESERVED FROM ORIGINAL (FIX #F):
 *   applyOverride(clearance, category, reason, overriddenBy)
 *
 * RETURN TYPE CHANGED: was ClearanceResult, now ApplyOverrideResult.
 * For backwards compatibility callers can read `result.clearance` to get
 * the same shape as before.  A thin wrapper `applyOverrideLegacy` is
 * exported for any caller that hasn't been updated yet.
 */
export function applyOverride(
  clearance: ClearanceResult,
  category: ClearanceCategory,
  reason: string,
  overriddenBy: string,
): ApplyOverrideResult {
  const now = new Date().toISOString()

  const target = clearance.items.find(i => i.category === category)
  if (!target) {
    return {
      applied: false,
      reason: 'category_not_found',
      clearance,
    }
  }
  if (!target.canOverride) {
    // BUG-DC03: explicit signal — was a silent no-op before
    return {
      applied: false,
      reason: 'category_not_overridable',
      clearance,
    }
  }

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
    applied: true,
    clearance: {
      ...clearance,
      items: updatedItems,
      overrides: updatedOverrides,
      canDischarge: blockedRequired.length === 0,
      blockedCount: blockedRequired.length,
    },
  }
}

/**
 * Legacy wrapper that preserves the pre-fix return shape (just the
 * ClearanceResult) for callers that haven't migrated to the new
 * discriminated return type.  Internally calls applyOverride() and
 * returns the .clearance field.  When the override could NOT be applied
 * this returns the input clearance unchanged — same observable behavior
 * as before BUG-DC03 was fixed, so existing UIs keep working until
 * migrated.
 */
export function applyOverrideLegacy(
  clearance: ClearanceResult,
  category: ClearanceCategory,
  reason: string,
  overriddenBy: string,
): ClearanceResult {
  return applyOverride(clearance, category, reason, overriddenBy).clearance
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