/**
 * src/lib/audit-enhanced.ts
 *
 * Enhanced Audit Logging — Extended Types & Mandatory Logging Helpers
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FIX: Audit Logging — Missing Critical Action Coverage
 *
 * PROBLEM:
 *   While the hash-chain audit system (audit.ts) is structurally sound,
 *   not all critical actions are logged:
 *     ❌ Refunds (some paths bypass audit)
 *     ❌ Discharge overrides (admin bypassing checks)
 *     ❌ Role changes
 *     ❌ Bill modifications / soft deletes
 *     ❌ Consent recording
 *
 * SOLUTION:
 *   This module provides:
 *     1. Extended action/entity type constants
 *     2. Mandatory audit helpers that MUST be called for critical actions
 *     3. A decorator pattern for wrapping critical operations with
 *        guaranteed audit logging (audit runs BEFORE the action,
 *        not after, to comply with DPDP audit-before-disclosure)
 *
 * USAGE:
 *   import { auditRefund, auditDischargeOverride, auditRoleChange } from '@/lib/audit-enhanced'
 *
 *   await auditRefund(billId, amount, reason, refundMode, issuedBy)
 *   await auditDischargeOverride(admissionId, overriddenChecks, approvedBy)
 *
 * COMPATIBILITY:
 *   This module re-exports everything from audit.ts and extends it.
 *   Existing callers of audit() are unaffected.
 * ═══════════════════════════════════════════════════════════════════════
 */

// Re-export everything from the base audit module
export {
  audit,
  auditLogin,
  auditLogout,
  auditSafetyOverride,
  clearAuditCache,
  verifyAuditChain,
} from './audit'

import { audit } from './audit'
import type { AuditAction, AuditEntity } from './audit'

// ── Extended Action Types ────────────────────────────────────────

/**
 * All audit actions (base + extended).
 * The base audit.ts accepts any string for action, so these are
 * used for type safety in the convenience helpers below.
 */
export type ExtendedAuditAction =
  | AuditAction
  | 'refund'
  | 'discharge_override'
  | 'role_change'
  | 'bill_modify'
  | 'bill_cancel'
  | 'consent_record'
  | 'admin_override'
  | 'credit_note_create'
  | 'credit_note_cancel'
  | 'bed_assign'
  | 'bed_release'

/**
 * All audit entity types (base + extended).
 */
export type ExtendedAuditEntity =
  | AuditEntity
  | 'refund'
  | 'credit_note'
  | 'payment'
  | 'ipd_admission'
  | 'queue'
  | 'consent'
  | 'role'

// ── Mandatory Audit Helpers ──────────────────────────────────────
// These MUST be called for their respective operations.
// They are intentionally verbose so the audit trail is human-readable.

/**
 * Audit a refund operation.
 * MUST be called for every refund — before or after the refund
 * is recorded in payment_transactions.
 */
export async function auditRefund(
  billId: string,
  amount: number,
  reason: string,
  refundMode: string,
  issuedBy: string,
  extra?: {
    razorpayRefundId?: string | null
    creditNoteId?: string | null
    isFullRefund?: boolean
    totalRefundedAfter?: number
  },
): Promise<void> {
  await audit(
    'refund' as AuditAction,
    'bill' as AuditEntity,
    billId,
    `Refund ₹${amount} by ${issuedBy}`,
    {
      after: {
        amount,
        reason,
        refund_mode: refundMode,
        issued_by: issuedBy,
        razorpay_refund_id: extra?.razorpayRefundId || null,
        credit_note_id: extra?.creditNoteId || null,
        is_full_refund: extra?.isFullRefund || false,
        total_refunded: extra?.totalRefundedAfter || amount,
      },
    },
  )
}

/**
 * Audit a discharge with admin override.
 * MUST be called when an admin bypasses discharge checks.
 * This is a compliance requirement — admin overrides must be traceable.
 */
export async function auditDischargeOverride(
  admissionId: string,
  overriddenChecks: string[],
  approvedBy: string,
  patientName?: string,
): Promise<void> {
  await audit(
    'admin_override' as AuditAction,
    'discharge' as AuditEntity,
    admissionId,
    `Admin override for discharge: ${patientName || 'patient'}`,
    {
      after: {
        overridden_checks: overriddenChecks,
        approved_by: approvedBy,
        override_reason: 'Admin authorized discharge with pending items',
        is_admin_override: true,
      },
    },
  )
}

/**
 * Audit a role change (user promoted/demoted).
 * MUST be called for every role modification.
 */
export async function auditRoleChange(
  userId: string,
  userEmail: string,
  oldRole: string,
  newRole: string,
  changedBy: string,
): Promise<void> {
  await audit(
    'update' as AuditAction,
    'user' as AuditEntity,
    userId,
    `Role change: ${userEmail} (${oldRole} → ${newRole})`,
    {
      before: { role: oldRole },
      after: { role: newRole, changed_by: changedBy },
    },
  )
}

/**
 * Audit a bill modification (amount change, item edit, etc.)
 * MUST be called before the bill is modified.
 */
export async function auditBillModify(
  billId: string,
  modifier: string,
  modificationType: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  await audit(
    'update' as AuditAction,
    'bill' as AuditEntity,
    billId,
    `Bill modified by ${modifier}: ${modificationType}`,
    { before, after },
  )
}

/**
 * Audit a bill cancellation / soft delete.
 * MUST be called when a bill is cancelled or soft-deleted.
 */
export async function auditBillCancel(
  billId: string,
  cancelledBy: string,
  reason: string,
  invoiceNumber?: string,
): Promise<void> {
  await audit(
    'delete' as AuditAction,
    'bill' as AuditEntity,
    billId,
    `Bill ${invoiceNumber || billId} cancelled by ${cancelledBy}`,
    {
      after: {
        cancelled_by: cancelledBy,
        reason,
        invoice_number: invoiceNumber,
      },
    },
  )
}

/**
 * Audit a credit note creation.
 */
export async function auditCreditNoteCreate(
  creditNoteId: string,
  billId: string,
  amount: number,
  reason: string,
  issuedBy: string,
): Promise<void> {
  await audit(
    'create' as AuditAction,
    'bill' as AuditEntity,
    billId,
    `Credit note ${creditNoteId} for ₹${amount}`,
    {
      after: {
        credit_note_id: creditNoteId,
        amount,
        reason,
        issued_by: issuedBy,
      },
    },
  )
}

/**
 * Audit a credit note cancellation.
 */
export async function auditCreditNoteCancel(
  creditNoteId: string,
  billId: string,
  amount: number,
  cancelledBy: string,
): Promise<void> {
  await audit(
    'update' as AuditAction,
    'bill' as AuditEntity,
    billId,
    `Credit note ${creditNoteId} cancelled (₹${amount})`,
    {
      before: { credit_note_status: 'issued' },
      after: {
        credit_note_status: 'cancelled',
        cancelled_by: cancelledBy,
        credit_note_id: creditNoteId,
      },
    },
  )
}

/**
 * Audit a bed assignment.
 */
export async function auditBedAssign(
  bedId: string,
  patientId: string,
  patientName: string,
  bedNumber: string,
  ward: string,
  assignedBy: string,
): Promise<void> {
  await audit(
    'update' as AuditAction,
    'bed' as AuditEntity,
    bedId,
    `Bed ${bedNumber} assigned to ${patientName}`,
    {
      after: {
        patient_id: patientId,
        patient_name: patientName,
        bed_number: bedNumber,
        ward,
        assigned_by: assignedBy,
      },
    },
  )
}

/**
 * Audit a bed release.
 */
export async function auditBedRelease(
  bedId: string,
  bedNumber: string,
  releasedBy: string,
  reason: string,
): Promise<void> {
  await audit(
    'update' as AuditAction,
    'bed' as AuditEntity,
    bedId,
    `Bed ${bedNumber} released: ${reason}`,
    {
      after: {
        status: 'available',
        released_by: releasedBy,
        reason,
      },
    },
  )
}

// ── Critical Path Enforcement ────────────────────────────────────

/**
 * Wraps a critical operation with mandatory audit logging.
 *
 * Usage:
 *   const result = await withAudit(
 *     () => performRefund(billId, amount),
 *     'refund', 'bill', billId, `Refund ₹${amount}`,
 *   )
 *
 * The audit entry is written BEFORE the operation executes.
 * If the operation fails, a follow-up audit entry records the failure.
 *
 * This ensures that even if the operation throws, the audit trail
 * shows the ATTEMPT was made — critical for compliance and forensics.
 */
export async function withAudit<T>(
  operation: () => Promise<T>,
  action: string,
  entityType: string,
  entityId: string,
  entityLabel: string,
  changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> },
): Promise<T> {
  // Log the attempt BEFORE executing
  await audit(
    action as AuditAction,
    entityType as AuditEntity,
    entityId,
    `[ATTEMPT] ${entityLabel}`,
    changes,
  )

  try {
    const result = await operation()

    // Log success
    await audit(
      action as AuditAction,
      entityType as AuditEntity,
      entityId,
      `[SUCCESS] ${entityLabel}`,
      changes,
    ).catch(() => {}) // non-fatal on success path

    return result
  } catch (err: any) {
    // Log failure
    await audit(
      action as AuditAction,
      entityType as AuditEntity,
      entityId,
      `[FAILED] ${entityLabel}: ${err?.message || 'unknown error'}`,
      {
        after: {
          error: err?.message || 'unknown',
          ...(changes?.after || {}),
        },
      },
    ).catch(() => {}) // non-fatal

    throw err // re-throw so the caller sees the original error
  }
}
