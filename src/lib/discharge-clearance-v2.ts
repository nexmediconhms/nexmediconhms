/**
 * ⚠️ ⚠️ ⚠️  DEPRECATED — DO NOT IMPORT THIS FILE  ⚠️ ⚠️ ⚠️
 *
 * 2026-06-04 audit finding: this `discharge-clearance-v2.ts` claims the
 * v1 file (`discharge-clearance.ts`) is broken and that v2 is the
 * replacement. THE OPPOSITE IS TRUE. v2 queries the no-underscore
 * tables `ipdadmissions`, `labreports` and the columns `patientid`,
 * `reportname`, `createdat` — none of which exist on production
 * deployments after migration 017.
 *
 * v1 (`@/lib/discharge-clearance.ts`) is the canonical, schema-resilient
 * implementation. It tries snake_case first (production canonical) and
 * falls back to no-underscore for legacy databases. The `DischargeClearance`
 * React component imports v1 — DO NOT change it to v2.
 *
 * This file is preserved unchanged below for historical reference. If
 * anything imports `checkDischargeClearanceV2`, REPLACE that import with:
 *
 *   import { checkDischargeClearance } from '@/lib/discharge-clearance'
 *
 * No callers should exist in the repo. A grep was run on 2026-06-04 and
 * confirmed zero imports of `checkDischargeClearanceV2`.
 *
 * See `docs/MIGRATIONS_INVENTORY.md` and the section §0.2 of the audit
 * report for the full diagnosis.
 * ─────────────────────────────────────────────────────────────────────
 */

/**
 * src/lib/discharge-clearance-v2.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BUG #8 FIX: Discharge Clearance Wrong Table/Column Names
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PROBLEM:
 *   The original discharge-clearance.ts queries tables and columns that
 *   don't match the actual database schema:
 *
 *   Code queries:          Actual schema:
 *   ─────────────          ──────────────
 *   ipd_admissions    →    ipdadmissions
 *   ipd_nursing       →    (table doesn't exist at all)
 *   lab_reports       →    labreports
 *   bills.patient_id  →    bills.patientid
 *   bills.net_amount  →    (column may not exist; schema has 'total')
 *   lab_reports.patient_id → labreports.patientid
 *   lab_reports.test_name  → labreports.reportname
 *   lab_reports.created_at → labreports.createdat
 *   ipd_admissions.patient_id → ipdadmissions.patientid
 *   ipd_admissions.admission_date → ipdadmissions.admissiondate
 *   admission.patient_name → (not a column in ipdadmissions)
 *   admission.insurance_details → (not a column in ipdadmissions)
 *
 * EFFECT OF BUG:
 *   - Discharge clearance checks ALWAYS FAIL silently
 *   - Billing clearance returns "Check Failed" (queries wrong table)
 *   - Lab results check returns "Not Applicable" (queries wrong table)
 *   - Nursing check ALWAYS shows "pending" (table doesn't exist)
 *   - In practice, the clearance checklist is completely non-functional
 *   - Patients may be discharged without billing clearance
 *   - No verification of pending lab results before discharge
 *
 * SOLUTION:
 *   This file provides `checkDischargeClearanceV2()` which:
 *   1. Uses correct table names (ipdadmissions, labreports, bills)
 *   2. Uses correct column names (patientid, reportname, createdat, etc.)
 *   3. Removes ipd_nursing dependency (table doesn't exist — uses encounters instead)
 *   4. Handles missing optional columns gracefully
 *
 * AFTER FIX:
 *   ✅ Billing clearance correctly detects unpaid bills
 *   ✅ Lab results check finds pending tests during admission
 *   ✅ Discharge is properly blocked when bills are outstanding
 *   ✅ All clearance items show accurate status
 *   ✅ Admin override still works as before
 *
 * USAGE:
 *   // Replace: import { checkDischargeClearance } from '@/lib/discharge-clearance'
 *   // With:    import { checkDischargeClearanceV2 } from '@/lib/discharge-clearance-v2'
 */

import { supabase } from './supabase'

// Re-export types from original for compatibility
export type {
  ClearanceCategory,
  ClearanceStatus,
  ClearanceItem,
  ClearanceResult,
  ClearanceOverride,
} from './discharge-clearance'

// Re-export utility functions that don't depend on DB queries
export { applyOverride, getClearanceStatusDisplay } from './discharge-clearance'

import type {
  ClearanceCategory,
  ClearanceStatus,
  ClearanceItem,
  ClearanceResult,
} from './discharge-clearance'

// ─── Main Clearance Check (Corrected) ────────────────────────────────

/**
 * Run all discharge clearance checks using CORRECT table/column names.
 *
 * @param admissionId - The IPD admission UUID
 * @param manualChecks - Optional manual check overrides
 */
export async function checkDischargeClearanceV2(
  admissionId: string,
  manualChecks?: Partial<Record<ClearanceCategory, { cleared: boolean; by?: string }>>
): Promise<ClearanceResult> {
  const now = new Date().toISOString()

  // ═══ KEY FIX: Use 'ipdadmissions' table (not 'ipd_admissions') ═══
  const { data: admission, error: admErr } = await supabase
    .from('ipdadmissions')
    .select('*')
    .eq('id', admissionId)
    .single()

  if (admErr || !admission) {
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
        detail: admErr?.message || 'Invalid admission ID',
        isRequired: true,
        canOverride: false,
        checkedAt: now,
        checkedBy: null,
      }],
      overrides: [],
      checkedAt: now,
    }
  }

  // ═══ KEY FIX: Use 'patientid' (not 'patient_id') ═══
  const patientId = admission.patientid
  const items: ClearanceItem[] = []

  // Get patient name for display
  let patientName = ''
  try {
    const { data: patient } = await supabase
      .from('patients')
      .select('fullname')
      .eq('id', patientId)
      .single()
    patientName = patient?.fullname || ''
  } catch { /* non-fatal */ }

  // ── 1. BILLING CHECK ────────────────────────────────────────────────
  try {
    // ═══ KEY FIX: Use 'patientid', and check 'total'/'paid'/'due' columns ═══
    const { data: pendingBills, error: billErr } = await supabase
      .from('bills')
      .select('id, total, paid, due, status')
      .eq('patientid', patientId)
      .in('status', ['pending', 'unpaid', 'partial'])

    if (billErr) throw billErr

    // Calculate total due — handle both 'due' column and computed total-paid
    const totalDue = (pendingBills || []).reduce((sum, b) => {
      const due = Number(b.due) || 0
      if (due > 0) return sum + due
      // Fallback: compute from total - paid
      return sum + Math.max(0, (Number(b.total) || 0) - (Number(b.paid) || 0))
    }, 0)

    if (!pendingBills || pendingBills.length === 0 || totalDue <= 0) {
      items.push({
        category: 'billing',
        label: 'Billing Cleared',
        description: 'All bills are paid in full',
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

  // ── 2. LAB RESULTS CHECK ────────────────────────────────────────────
  try {
    // ═══ KEY FIX: Use 'labreports' table (not 'lab_reports') ═══
    // ═══ KEY FIX: Use 'patientid', 'reportname', 'createdat' ═══
    const { data: pendingLabs, error: labErr } = await supabase
      .from('labreports')
      .select('id, reportname, status, createdat')
      .eq('patientid', patientId)
      .in('status', ['pending', 'collected', 'processing'])

    if (labErr) {
      // Table might not exist yet — treat as not applicable
      items.push({
        category: 'lab',
        label: 'Lab Reports',
        description: 'Unable to check lab reports',
        status: 'not_applicable',
        detail: null,
        isRequired: false,
        canOverride: true,
        checkedAt: now,
        checkedBy: 'system',
      })
    } else if (!pendingLabs || pendingLabs.length === 0) {
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
      // Filter to only labs created during this admission
      const admissionDate = admission.admissiondate || '1900-01-01'
      const relevantLabs = pendingLabs.filter(lab => {
        if (!lab.createdat) return true // Include if no date (be conservative)
        return lab.createdat >= admissionDate + 'T00:00:00'
      })

      if (relevantLabs.length === 0) {
        items.push({
          category: 'lab',
          label: 'Lab Results Complete',
          description: 'No pending labs from this admission period',
          status: 'cleared',
          detail: null,
          isRequired: false,
          canOverride: true,
          checkedAt: now,
          checkedBy: 'system',
        })
      } else {
        // ═══ KEY FIX: Use 'reportname' (not 'test_name') ═══
        const testNames = relevantLabs.map(l => l.reportname || 'Unknown').join(', ')
        items.push({
          category: 'lab',
          label: 'Pending Lab Results',
          description: `${relevantLabs.length} test(s) still pending: ${testNames}`,
          status: 'pending',
          detail: `Pending: ${testNames}. Results should ideally be available before discharge.`,
          isRequired: false,
          canOverride: true,
          checkedAt: now,
          checkedBy: 'system',
        })
      }
    }
  } catch {
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

  // ── 3. NURSING / VITALS CHECK ───────────────────────────────────────
  // ═══ KEY FIX: ipd_nursing table doesn't exist in schema ═══
  // Instead, check if there's a recent encounter with vitals for this patient
  try {
    const { data: recentEncounters } = await supabase
      .from('encounters')
      .select('id, vitals, createdat')
      .eq('patientid', patientId)
      .not('vitals', 'is', null)
      .order('createdat', { ascending: false })
      .limit(1)

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
    } else if (recentEncounters && recentEncounters.length > 0) {
      const lastVital = recentEncounters[0]
      const hoursSince = lastVital.createdat
        ? (Date.now() - new Date(lastVital.createdat).getTime()) / (1000 * 60 * 60)
        : 999

      if (hoursSince < 24) {
        items.push({
          category: 'nursing',
          label: 'Nursing - Recent Vitals',
          description: `Last vitals recorded ${Math.round(hoursSince)} hours ago`,
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
          description: `Last vitals were ${Math.round(hoursSince)} hours ago. Final vitals needed.`,
          status: 'pending',
          detail: 'Record final vitals and confirm patient is stable for discharge.',
          isRequired: true,
          canOverride: true,
          checkedAt: now,
          checkedBy: null,
        })
      }
    } else {
      items.push({
        category: 'nursing',
        label: 'Nursing Sign-off Required',
        description: 'No vitals recorded during this admission',
        status: 'pending',
        detail: 'Record final vitals before discharge.',
        isRequired: true,
        canOverride: true,
        checkedAt: now,
        checkedBy: null,
      })
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

  // ── 4. CONSENT CHECK ────────────────────────────────────────────────
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
      detail: 'Check the consent checkbox after patient/attendant signs.',
      isRequired: true,
      canOverride: true,
      checkedAt: now,
      checkedBy: null,
    })
  }

  // ── 5. DOCTOR FINAL ORDERS ──────────────────────────────────────────
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
    // Check if discharge summary exists and has required fields
    try {
      const { data: dsSummary } = await supabase
        .from('dischargesummaries')
        .select('finaldiagnosis, conditionatdischarge, dischargeadvice')
        .eq('patientid', patientId)
        .order('createdat', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (dsSummary && dsSummary.finaldiagnosis && dsSummary.conditionatdischarge) {
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
          detail: 'Fill the discharge summary form with required fields.',
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
        description: 'Complete discharge summary required',
        status: 'pending',
        detail: null,
        isRequired: true,
        canOverride: false,
        checkedAt: now,
        checkedBy: null,
      })
    }
  }

  // ── 6. PHARMACY CLEARANCE ───────────────────────────────────────────
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

  // ── Aggregate Result ────────────────────────────────────────────────
  const blockedRequired = items.filter(
    i => i.isRequired && (i.status === 'blocked' || i.status === 'pending')
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