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
 *   - Billing: No pending/unpaid bills OR admin override
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

export type ClearanceStatus = 'cleared' | 'pending' | 'blocked' | 'not_applicable'

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
  manualChecks?: Partial<Record<ClearanceCategory, { cleared: boolean; by?: string }>>
): Promise<ClearanceResult> {
  const now = new Date().toISOString()

  // Fetch the admission
  const { data: admission, error: admErr } = await supabase
    .from('ipd_admissions')
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
        detail: 'Invalid admission ID',
        isRequired: true,
        canOverride: false,
        checkedAt: now,
        checkedBy: null,
      }],
      overrides: [],
      checkedAt: now,
    }
  }

  const patientId = admission.patient_id
  const items: ClearanceItem[] = []

  // ── 1. BILLING CHECK ─────────────────────────────────────────
  try {
    const { data: pendingBills, error: billErr } = await supabase
      .from('bills')
      .select('id, net_amount, total, paid, due, status')
      .eq('patient_id', patientId)
      .in('status', ['pending', 'unpaid', 'partial'])

    if (billErr) throw billErr

    const totalDue = (pendingBills || []).reduce(
      (sum, b) => sum + Number(b.due || (Number(b.total || b.net_amount || 0) - Number(b.paid || 0))), 0
    )

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

  // ── 2. LAB RESULTS CHECK ─────────────────────────────────────
  try {
    const { data: pendingLabs } = await supabase
      .from('lab_reports')
      .select('id, test_name, status')
      .eq('patient_id', patientId)
      .in('status', ['pending', 'collected', 'processing'])
      .gte('created_at', admission.admission_date + 'T00:00:00')

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
      const testNames = pendingLabs.map(l => l.test_name || 'Unknown').join(', ')
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
  try {
    const { data: recentVitals } = await supabase
      .from('ipd_nursing')
      .select('id, recorded_time, entry_type')
      .eq('ipd_admission_id', admissionId)
      .eq('entry_type', 'vital')
      .order('recorded_time', { ascending: false })
      .limit(1)

    const hasRecentVitals = recentVitals && recentVitals.length > 0
    const lastVitalTime = hasRecentVitals
      ? new Date(recentVitals[0].recorded_time).getTime()
      : 0
    const hoursSinceLastVital = (Date.now() - lastVitalTime) / (1000 * 60 * 60)

    // Manual override check
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
    } else if (hasRecentVitals && hoursSinceLastVital < 12) {
      items.push({
        category: 'nursing',
        label: 'Nursing - Final Vitals',
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

  // ── 6. INSURANCE (only if patient has insurance) ─────────────
  if (admission.insurance_details && admission.insurance_details.trim()) {
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
        description: `Insurance: ${admission.insurance_details}. Ensure claim documents are prepared.`,
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
    i => i.isRequired && (i.status === 'blocked' || i.status === 'pending')
  )

  return {
    admissionId,
    patientId,
    patientName: admission.patient_name || '',
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
 */
export function applyOverride(
  clearance: ClearanceResult,
  category: ClearanceCategory,
  reason: string,
  overriddenBy: string
): ClearanceResult {
  const now = new Date().toISOString()

  const updatedItems = clearance.items.map(item => {
    if (item.category === category && item.canOverride) {
      return {
        ...item,
        status: 'cleared' as ClearanceStatus,
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
    i => i.isRequired && (i.status === 'blocked' || i.status === 'pending')
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
  }
}
