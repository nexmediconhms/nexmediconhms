/**
 * src/lib/billing-workflow.ts
 *
 * Billing workflow helpers for preventing double-billing of consultation fees.
 *
 * BILLING MODELS (Indian Clinic Practice):
 *
 *   MODEL A — "Upfront Collection" (most private clinics):
 *     Patient pays consultation fee at registration counter → sees doctor →
 *     only additional services (labs, procedures, consumables) create a bill.
 *
 *   MODEL B — "Post-Consultation" (some hospitals):
 *     Patient registers without payment → sees doctor → everything billed
 *     together after consultation.
 *
 * This module ensures:
 *   1. If consultation fee was paid upfront, it's NOT added again in billing
 *   2. If no additional services exist, no empty bill is generated
 *   3. Follow-up visits can have different fee rules
 *   4. Full audit trail for fee collection decisions
 *
 * NON-BREAKING: New file. Existing billing page works unchanged.
 * The guards are opt-in — the billing page calls these helpers to check.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FeeStatus {
  /** Whether the consultation/registration fee was already paid */
  feePaid: boolean;
  /** Amount that was paid (if any) */
  feeAmount: number | null;
  /** Receipt number (if any) */
  receiptNumber: string | null;
  /** Payment mode (cash/card/UPI/etc.) */
  paymentMode: string | null;
  /** When the fee was paid */
  paidAt: string | null;
  /** Which billing model is active for this encounter */
  billingModel: 'upfront' | 'post_consultation';
  /** Whether this encounter should only show additional services in billing */
  additionalServicesOnly: boolean;
  /** Visit type (OPD/ANC/Follow-up) — affects fee rules */
  visitType: string;
  /** Whether a bill already exists for this encounter */
  billExists: boolean;
  /** ID of existing bill (if any) */
  existingBillId: string | null;
}

export interface MarkFeeAsPaidInput {
  encounterId?: string;
  queueEntryId?: string;
  patientId: string;
  amount: number;
  receiptNumber?: string;
  paymentMode: 'cash' | 'card' | 'upi' | 'online' | 'other';
  collectedBy?: string;
}

// ─── Consultation Fee Constants ─────────────────────────────────────────────
// These should ideally come from a settings table, but hardcoded defaults
// ensure the system works out of the box.

export const DEFAULT_CONSULTATION_FEES: Record<string, number> = {
  'OPD Consultation': 500,
  'ANC Consultation': 500,
  'Follow-up Consultation': 300,
  'Emergency Consultation': 100,
};

/** Service codes that represent "consultation/registration" fees */
export const CONSULTATION_SERVICE_CODES = [
  'OPD Consultation',
  'ANC Consultation',
  'Follow-up Consultation',
  'Emergency Consultation',
  'Registration Fee',
  'Consultation Fee',
];

// ─── Check Fee Status ───────────────────────────────────────────────────────

/**
 * Check whether the consultation fee has already been paid for this encounter.
 * Called by the billing page before showing the bill form.
 */
export async function checkFeeStatus(
  supabase: SupabaseClient,
  params: {
    encounterId?: string;
    queueEntryId?: string;
    patientId: string;
    visitDate?: string;
  }
): Promise<{ data: FeeStatus; error: string | null }> {
  try {
    const defaultStatus: FeeStatus = {
      feePaid: false,
      feeAmount: null,
      receiptNumber: null,
      paymentMode: null,
      paidAt: null,
      billingModel: 'upfront',
      additionalServicesOnly: false,
      visitType: 'OPD',
      billExists: false,
      existingBillId: null,
    };

    // Strategy 1: Check via encounter
    if (params.encounterId) {
      const { data: encounter } = await supabase
        .from('encounters')
        .select('registration_fee_paid, registration_fee_amount, registration_fee_receipt, registration_fee_paid_at, registration_fee_mode, billing_model, additional_services_only, visit_type')
        .eq('id', params.encounterId)
        .single();

      if (encounter) {
        defaultStatus.feePaid = encounter.registration_fee_paid || false;
        defaultStatus.feeAmount = encounter.registration_fee_amount;
        defaultStatus.receiptNumber = encounter.registration_fee_receipt;
        defaultStatus.paymentMode = encounter.registration_fee_mode;
        defaultStatus.paidAt = encounter.registration_fee_paid_at;
        defaultStatus.billingModel = encounter.billing_model || 'upfront';
        defaultStatus.additionalServicesOnly = encounter.additional_services_only || false;
        defaultStatus.visitType = encounter.visit_type || 'OPD';
      }

      // Check if a bill already exists for this encounter
      const { data: existingBill } = await supabase
        .from('bills')
        .select('id')
        .eq('encounter_id', params.encounterId)
        .limit(1)
        .maybeSingle();

      if (existingBill) {
        defaultStatus.billExists = true;
        defaultStatus.existingBillId = existingBill.id;
      }
    }

    // Strategy 2: Check via queue entry
    if (!defaultStatus.feePaid && params.queueEntryId) {
      const { data: queueEntry } = await supabase
        .from('opd_queue')
        .select('fee_collected, fee_amount, fee_receipt_number')
        .eq('id', params.queueEntryId)
        .single();

      if (queueEntry?.fee_collected) {
        defaultStatus.feePaid = true;
        defaultStatus.feeAmount = queueEntry.fee_amount;
        defaultStatus.receiptNumber = queueEntry.fee_receipt_number;
      }
    }

    // Strategy 3: Check today's bills for this patient (catch-all)
    if (!defaultStatus.feePaid) {
      const today = params.visitDate || new Date().toISOString().split('T')[0];

      const { data: todayBills } = await supabase
        .from('bills')
        .select('id, is_registration_fee, total_amount, created_at')
        .eq('patient_id', params.patientId)
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`)
        .eq('is_registration_fee', true)
        .limit(1)
        .maybeSingle();

      if (todayBills) {
        defaultStatus.feePaid = true;
        defaultStatus.feeAmount = todayBills.total_amount;
        defaultStatus.existingBillId = todayBills.id;
        defaultStatus.billExists = true;
      }
    }

    // Strategy 3b: Fallback - check bills with consultation items in items array
    // Catches older bills where is_registration_fee was not set
    if (!defaultStatus.feePaid) {
      const todayFb = params.visitDate || new Date().toISOString().split('T')[0];

      const { data: allTodayBills } = await supabase
        .from('bills')
        .select('id, items, net_amount, payment_mode, created_at, status')
        .eq('patient_id', params.patientId)
        .gte('created_at', `${todayFb}T00:00:00`)
        .lte('created_at', `${todayFb}T23:59:59`)
        .eq('status', 'paid')
        .limit(10);

      if (allTodayBills && allTodayBills.length > 0) {
        const consultationBill = allTodayBills.find((bill: any) => {
          if (!Array.isArray(bill.items)) return false;
          return bill.items.some((item: any) => {
            const label = (item.label || item.description || '').toLowerCase();
            return CONSULTATION_SERVICE_CODES.some(
              code => label.includes(code.toLowerCase())
            );
          });
        });

        if (consultationBill) {
          defaultStatus.feePaid = true;
          defaultStatus.feeAmount = consultationBill.net_amount;
          defaultStatus.paymentMode = consultationBill.payment_mode;
          defaultStatus.existingBillId = consultationBill.id;
          defaultStatus.billExists = true;
        }
      }
    }

    // If fee was paid upfront, billing page should only show additional services
    if (defaultStatus.feePaid) {
      defaultStatus.additionalServicesOnly = true;
    }

    return { data: defaultStatus, error: null };
  } catch (err) {
    return {
      data: {
        feePaid: false, feeAmount: null, receiptNumber: null,
        paymentMode: null, paidAt: null, billingModel: 'upfront',
        additionalServicesOnly: false, visitType: 'OPD',
        billExists: false, existingBillId: null,
      },
      error: String(err),
    };
  }
}

// ─── Mark Fee as Paid ───────────────────────────────────────────────────────

/**
 * Mark the consultation/registration fee as paid at the registration counter.
 * Called when the front-desk staff collects payment.
 */
export async function markFeeAsPaid(
  supabase: SupabaseClient,
  input: MarkFeeAsPaidInput
): Promise<{ error: string | null }> {
  try {
    const now = new Date().toISOString();

    // Update encounter
    if (input.encounterId) {
      await supabase
        .from('encounters')
        .update({
          registration_fee_paid: true,
          registration_fee_amount: input.amount,
          registration_fee_receipt: input.receiptNumber || null,
          registration_fee_paid_at: now,
          registration_fee_mode: input.paymentMode,
          additional_services_only: true,
        })
        .eq('id', input.encounterId);
    }

    // Update queue entry
    if (input.queueEntryId) {
      await supabase
        .from('opd_queue')
        .update({
          fee_collected: true,
          fee_amount: input.amount,
          fee_receipt_number: input.receiptNumber || null,
        })
        .eq('id', input.queueEntryId);
    }

    // Audit log
    await supabase
      .from('billing_guard_log')
      .insert({
        encounter_id: input.encounterId || null,
        patient_id: input.patientId,
        queue_entry_id: input.queueEntryId || null,
        action: 'fee_collected_at_registration',
        reason: `Consultation fee ₹${input.amount} collected at registration`,
        amount: input.amount,
        receipt_number: input.receiptNumber || null,
        payment_mode: input.paymentMode,
        performed_by: input.collectedBy || null,
      });

    return { error: null };
  } catch (err) {
    return { error: String(err) };
  }
}

// ─── Validate Bill Before Generation ────────────────────────────────────────

/**
 * Check a bill's line items against fee status.
 * Returns warnings if consultation fee is being double-billed.
 * Called before saving a new bill.
 */
export function validateBillItems(
  feeStatus: FeeStatus,
  billItems: Array<{ name: string; amount: number }>
): {
  valid: boolean;
  warnings: string[];
  filteredItems: Array<{ name: string; amount: number }>;
  removedItems: Array<{ name: string; amount: number; reason: string }>;
} {
  const warnings: string[] = [];
  const removedItems: Array<{ name: string; amount: number; reason: string }> = [];
  const filteredItems: Array<{ name: string; amount: number }> = [];

  for (const item of billItems) {
    const isConsultationFee = CONSULTATION_SERVICE_CODES.some(
      code => item.name.toLowerCase().includes(code.toLowerCase())
    );

    if (isConsultationFee && feeStatus.feePaid) {
      removedItems.push({
        ...item,
        reason: `Already paid at registration (Receipt: ${feeStatus.receiptNumber || 'N/A'}, ₹${feeStatus.feeAmount})`,
      });
      warnings.push(
        `"${item.name}" (₹${item.amount}) removed — consultation fee already paid at registration`
      );
    } else {
      filteredItems.push(item);
    }
  }

  // If no items remain after filtering, warn that no bill is needed
  if (filteredItems.length === 0 && removedItems.length > 0) {
    warnings.push('No additional services to bill. The consultation fee was already collected at registration.');
  }

  return {
    valid: warnings.length === 0,
    warnings,
    filteredItems,
    removedItems,
  };
}

// ─── Skip Billing for Encounter ─────────────────────────────────────────────

/**
 * Explicitly mark that no additional bill is needed for this encounter.
 * Used when doctor prescribed no extra services and fee was paid upfront.
 */
export async function skipBillingForEncounter(
  supabase: SupabaseClient,
  encounterId: string,
  patientId: string,
  reason: string,
  performedBy?: string
): Promise<{ error: string | null }> {
  try {
    // Log the decision
    await supabase
      .from('billing_guard_log')
      .insert({
        encounter_id: encounterId,
        patient_id: patientId,
        action: 'billing_skipped',
        reason: reason || 'No additional services — consultation fee already paid',
        performed_by: performedBy || null,
      });

    return { error: null };
  } catch (err) {
    return { error: String(err) };
  }
}

// ─── Get Billing Guard Log ──────────────────────────────────────────────────

/**
 * Get audit trail for fee collection decisions.
 * Useful for end-of-day reconciliation.
 */
export async function getBillingGuardLog(
  supabase: SupabaseClient,
  options: {
    date?: string;
    patientId?: string;
    limit?: number;
  } = {}
): Promise<{ data: unknown[]; error: string | null }> {
  try {
    let query = supabase
      .from('billing_guard_log')
      .select('*, patients(name, mrn)')
      .order('created_at', { ascending: false })
      .limit(options.limit || 100);

    if (options.date) {
      query = query
        .gte('created_at', `${options.date}T00:00:00`)
        .lte('created_at', `${options.date}T23:59:59`);
    }
    if (options.patientId) {
      query = query.eq('patient_id', options.patientId);
    }

    const { data, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}
