'use client'

/**
 * src/components/billing/DischargeBillingGate.tsx
 *
 * Discharge Billing Gate — Verifies billing clearance before allowing discharge.
 *
 * Shows:
 *   - Total charges, paid amount, deposits, outstanding
 *   - List of pending (unpaid) bills
 *   - "Clear & Proceed" button (if all paid)
 *   - "Admin Override" button (if outstanding, admin only)
 *   - Links to record payment / collect deposit
 *
 * Usage:
 *   <DischargeBillingGate
 *     admissionId="uuid"
 *     patientId="uuid"
 *     patientName="Jane Doe"
 *     onCleared={() => proceedWithDischarge()}
 *     onRecordPayment={(billId) => openPartialPaymentModal(billId)}
 *   />
 *
 * ─── ADDITIVE ────────────────────────────────────────────────────────
 * New component. Can be embedded in the discharge page/flow.
 * The existing discharge process continues to work without this.
 * ─────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle, AlertTriangle, IndianRupee, Loader2,
  ShieldAlert, ArrowRight, CreditCard, RefreshCw,
} from 'lucide-react'

interface DischargeBillingGateProps {
  admissionId: string
  patientId: string
  patientName: string
  /** Called when billing is cleared (either all paid or admin override) */
  onCleared: () => void
  /** Called when user wants to record a payment for a specific bill */
  onRecordPayment?: (billId: string) => void
  /** Is the current user an admin? */
  isAdmin?: boolean
}

interface PendingBill {
  id: string
  invoice: string
  amount: number
  paid: number
  due: number
  status: string
}

interface ClearanceData {
  canDischarge: boolean
  alreadyCleared: boolean
  totalCharges: number
  totalPaid: number
  totalDeposit: number
  depositAdjusted: number
  unadjustedDeposit: number
  outstanding: number
  pendingBills: PendingBill[]
  reasons: string[]
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

export default function DischargeBillingGate({
  admissionId,
  patientId,
  patientName,
  onCleared,
  onRecordPayment,
  isAdmin = false,
}: DischargeBillingGateProps) {
  const [data, setData] = useState<ClearanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [showOverride, setShowOverride] = useState(false)
  const [processing, setProcessing] = useState(false)

  const loadClearance = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `/api/billing/discharge-clearance?admissionId=${admissionId}&patientId=${patientId}`
      )
      if (res.ok) {
        const d = await res.json()
        setData(d)
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Failed to check billing clearance')
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setLoading(false)
  }, [admissionId, patientId])

  useEffect(() => { loadClearance() }, [loadClearance])

  async function handleClear() {
    setProcessing(true)
    setError('')
    try {
      const res = await fetch('/api/billing/discharge-clearance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admission_id: admissionId,
          patient_id: patientId,
          action: 'clear',
        }),
      })
      const d = await res.json()
      if (res.ok && d.ok) {
        onCleared()
      } else {
        setError(d.error || 'Failed to clear billing')
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setProcessing(false)
  }

  async function handleOverride() {
    if (!overrideReason.trim() || overrideReason.trim().length < 5) {
      setError('Override reason must be at least 5 characters')
      return
    }
    setProcessing(true)
    setError('')
    try {
      const res = await fetch('/api/billing/discharge-clearance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admission_id: admissionId,
          patient_id: patientId,
          action: 'override',
          override_reason: overrideReason.trim(),
        }),
      })
      const d = await res.json()
      if (res.ok && (d.ok || d.cleared)) {
        onCleared()
      } else {
        setError(d.error || 'Override failed')
      }
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setProcessing(false)
  }

  // ── Loading state ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="border rounded-xl p-6 bg-white text-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-500">Checking billing status...</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="border rounded-xl p-6 bg-red-50 text-center">
        <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600">{error || 'Unable to check billing clearance'}</p>
        <button onClick={loadClearance} className="mt-3 text-sm text-blue-600 hover:underline">
          Try Again
        </button>
      </div>
    )
  }

  // ── Already cleared ────────────────────────────────────────────
  if (data.alreadyCleared) {
    return (
      <div className="border border-green-200 rounded-xl p-5 bg-green-50">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-8 h-8 text-green-500" />
          <div>
            <p className="font-semibold text-green-800">Billing Cleared</p>
            <p className="text-sm text-green-600">Ready for discharge</p>
          </div>
          <button
            onClick={onCleared}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
          >
            Proceed <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  // ── All paid — ready to clear ──────────────────────────────────
  if (data.canDischarge) {
    return (
      <div className="border border-green-200 rounded-xl bg-green-50 overflow-hidden">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-8 h-8 text-green-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-green-800">All Charges Settled</p>
              <p className="text-sm text-green-600 mt-0.5">
                Total: {inr(data.totalCharges)} · Paid: {inr(data.totalPaid)}
                {data.depositAdjusted > 0 && ` · Deposit adj: ${inr(data.depositAdjusted)}`}
              </p>
            </div>
          </div>
        </div>
        <div className="px-5 pb-5">
          <button
            onClick={handleClear}
            disabled={processing}
            className="w-full flex items-center justify-center gap-2 py-3 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Clear Billing & Proceed to Discharge
          </button>
        </div>
      </div>
    )
  }

  // ── Outstanding charges — needs payment or override ────────────
  return (
    <div className="border border-red-200 rounded-xl bg-white overflow-hidden">
      {/* Header */}
      <div className="p-5 bg-red-50 border-b border-red-200">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-8 h-8 text-red-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-red-800">Outstanding Balance</p>
            <p className="text-2xl font-bold text-red-700 mt-1">{inr(data.outstanding)}</p>
            <p className="text-sm text-red-600 mt-1">
              {data.reasons.join(' · ')}
            </p>
          </div>
          <button onClick={loadClearance} className="p-2 hover:bg-red-100 rounded-lg">
            <RefreshCw className="w-4 h-4 text-red-400" />
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b">
        <div className="text-center">
          <p className="text-xs text-gray-500">Total Charges</p>
          <p className="text-sm font-bold text-gray-900">{inr(data.totalCharges)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500">Paid</p>
          <p className="text-sm font-bold text-green-600">{inr(data.totalPaid)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500">Deposit</p>
          <p className="text-sm font-bold text-amber-600">{inr(data.totalDeposit)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500">Unadjusted Deposit</p>
          <p className="text-sm font-bold text-amber-500">{inr(data.unadjustedDeposit)}</p>
        </div>
      </div>

      {/* Pending bills */}
      {data.pendingBills.length > 0 && (
        <div className="p-4 border-b">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Unpaid Bills</p>
          <div className="space-y-2">
            {data.pendingBills.map(bill => (
              <div key={bill.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-900">{bill.invoice}</p>
                  <p className="text-xs text-gray-500">
                    Total: {inr(bill.amount)} · Paid: {inr(bill.paid)} · Due: {inr(bill.due)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    bill.status === 'partially_paid'
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {bill.status === 'partially_paid' ? 'Partial' : 'Unpaid'}
                  </span>
                  {onRecordPayment && (
                    <button
                      onClick={() => onRecordPayment(bill.id)}
                      className="flex items-center gap-1 px-2 py-1 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"
                    >
                      <CreditCard className="w-3 h-3" />
                      Pay
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="p-4 space-y-3">
        {/* Admin override */}
        {isAdmin && (
          <>
            {!showOverride ? (
              <button
                onClick={() => setShowOverride(true)}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-amber-300 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-50"
              >
                <ShieldAlert className="w-4 h-4" />
                Admin Override — Discharge Without Full Payment
              </button>
            ) : (
              <div className="border border-amber-300 rounded-xl p-4 bg-amber-50">
                <p className="text-sm font-medium text-amber-800 mb-2">
                  Override Reason (required for audit)
                </p>
                <textarea
                  value={overrideReason}
                  onChange={e => setOverrideReason(e.target.value)}
                  placeholder="Why is this patient being discharged without full payment? (e.g., LAMA, family undertaking signed, payment promised within 7 days)"
                  className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm resize-none"
                  rows={3}
                />
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => { setShowOverride(false); setOverrideReason('') }}
                    className="flex-1 py-2 border border-amber-300 rounded-lg text-sm text-amber-700 hover:bg-amber-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleOverride}
                    disabled={processing || overrideReason.trim().length < 5}
                    className="flex-1 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
                    Confirm Override
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {!isAdmin && (
          <p className="text-xs text-gray-500 text-center">
            Please collect the outstanding payment or contact an admin for discharge override.
          </p>
        )}
      </div>
    </div>
  )
}