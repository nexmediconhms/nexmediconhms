'use client'

/**
 * src/components/billing/PartialPaymentModal.tsx
 *
 * Record partial or split payments against an existing bill.
 *
 * Features:
 *   - Single partial payment (e.g., ₹3,000 of ₹5,000)
 *   - Split payment (e.g., ₹2,000 cash + ₹1,000 UPI)
 *   - Deposit adjustment (deduct from advance deposit)
 *   - Shows bill summary, remaining due, and payment history
 *   - Generates receipt numbers
 *
 * Usage:
 *   <PartialPaymentModal
 *     bill={selectedBill}
 *     onClose={() => setShowModal(false)}
 *     onPaymentRecorded={() => { reload(); setShowModal(false); }}
 *   />
 *
 * ─── ADDITIVE ────────────────────────────────────────────────────────
 * New component. Does not modify any existing billing component.
 * Can be imported and rendered alongside existing bill views.
 * ─────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react'
import {
  X, Plus, Trash2, IndianRupee, CheckCircle, AlertCircle,
  Banknote, Smartphone, CreditCard, Loader2, Split,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────

interface Bill {
  id: string
  patient_id: string
  patient_name?: string
  invoice_number?: string
  net_amount?: number
  total?: number
  paid?: number
  due?: number
  status: string
  admission_id?: string
}

interface PaymentSplit {
  id: string
  amount: string
  payment_mode: string
  payment_ref: string
}

interface PartialPaymentModalProps {
  bill: Bill
  onClose: () => void
  onPaymentRecorded: () => void
}

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash', icon: Banknote, color: 'text-green-600' },
  { value: 'upi', label: 'UPI', icon: Smartphone, color: 'text-blue-600' },
  { value: 'card', label: 'Card', icon: CreditCard, color: 'text-purple-600' },
  { value: 'cheque', label: 'Cheque', icon: IndianRupee, color: 'text-amber-600' },
  { value: 'online', label: 'Online', icon: IndianRupee, color: 'text-cyan-600' },
]

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

let splitCounter = 0

// ── Component ────────────────────────────────────────────────────────

export default function PartialPaymentModal({ bill, onClose, onPaymentRecorded }: PartialPaymentModalProps) {
  const billTotal = Number(bill.net_amount || bill.total || 0)
  const billPaid = Number(bill.paid || 0)
  const remaining = Math.max(0, billTotal - billPaid)

  const [splits, setSplits] = useState<PaymentSplit[]>([
    { id: `s-${++splitCounter}`, amount: String(remaining), payment_mode: 'cash', payment_ref: '' },
  ])
  const [notes, setNotes] = useState('')
  const [depositAdjustment, setDepositAdjustment] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const totalPayment = splits.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const depAdj = Number(depositAdjustment) || 0
  const totalCredit = totalPayment + depAdj
  const isOverpaying = totalCredit > remaining + 0.01
  const isValid = totalCredit > 0 && totalCredit <= remaining + 0.01 && splits.every(s => Number(s.amount) > 0)

  function addSplit() {
    if (splits.length >= 5) return
    const remainingAfter = remaining - totalPayment - depAdj
    setSplits([...splits, {
      id: `s-${++splitCounter}`,
      amount: remainingAfter > 0 ? String(Math.round(remainingAfter * 100) / 100) : '',
      payment_mode: 'upi',
      payment_ref: '',
    }])
  }

  function removeSplit(id: string) {
    if (splits.length <= 1) return
    setSplits(splits.filter(s => s.id !== id))
  }

  function updateSplit(id: string, field: keyof PaymentSplit, value: string) {
    setSplits(splits.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  async function handleSubmit() {
    if (!isValid) return
    setProcessing(true)
    setError('')

    try {
      const res = await fetch('/api/billing/partial-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bill_id: bill.id,
          patient_id: bill.patient_id,
          payments: splits.map(s => ({
            amount: Number(s.amount),
            payment_mode: s.payment_mode,
            payment_ref: s.payment_ref || undefined,
          })),
          received_by: 'reception',
          notes: notes || undefined,
          deposit_adjustment: depAdj > 0 ? depAdj : undefined,
          admission_id: depAdj > 0 ? bill.admission_id : undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.error || 'Payment failed')
        setProcessing(false)
        return
      }

      setSuccess(true)
      setTimeout(() => onPaymentRecorded(), 1500)
    } catch (err: any) {
      setError(err?.message || 'Network error')
      setProcessing(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Record Payment</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {bill.invoice_number || 'Bill'} — {bill.patient_name || 'Patient'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <p className="text-lg font-semibold text-green-700">Payment Recorded</p>
            <p className="text-sm text-gray-500 mt-1">Bill updated successfully</p>
          </div>
        ) : (
          <>
            {/* Bill Summary */}
            <div className="p-5 bg-gray-50 border-b">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-gray-500">Total</p>
                  <p className="text-lg font-bold text-gray-900">{inr(billTotal)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Paid</p>
                  <p className="text-lg font-bold text-green-600">{inr(billPaid)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Remaining</p>
                  <p className="text-lg font-bold text-red-600">{inr(remaining)}</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Payment splits */}
              {splits.map((split, idx) => (
                <div key={split.id} className="border rounded-xl p-4 bg-white">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-700">
                      {splits.length > 1 ? `Payment ${idx + 1}` : 'Payment Amount'}
                    </span>
                    {splits.length > 1 && (
                      <button
                        onClick={() => removeSplit(split.id)}
                        className="p-1 hover:bg-red-50 rounded text-red-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    {/* Amount */}
                    <div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                        <input
                          type="number"
                          value={split.amount}
                          onChange={e => updateSplit(split.id, 'amount', e.target.value)}
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          className="w-full pl-8 pr-4 py-2.5 border rounded-lg text-lg font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>

                    {/* Payment mode */}
                    <div className="grid grid-cols-5 gap-1.5">
                      {PAYMENT_MODES.map(m => {
                        const Icon = m.icon
                        const isActive = split.payment_mode === m.value
                        return (
                          <button
                            key={m.value}
                            onClick={() => updateSplit(split.id, 'payment_mode', m.value)}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-all ${
                              isActive
                                ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                                : 'border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}
                          >
                            <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                            {m.label}
                          </button>
                        )
                      })}
                    </div>

                    {/* Payment reference (for UPI/card/cheque) */}
                    {split.payment_mode !== 'cash' && (
                      <input
                        type="text"
                        value={split.payment_ref}
                        onChange={e => updateSplit(split.id, 'payment_ref', e.target.value)}
                        placeholder={
                          split.payment_mode === 'upi' ? 'UPI Ref / Transaction ID' :
                          split.payment_mode === 'cheque' ? 'Cheque Number' :
                          'Reference / Transaction ID'
                        }
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </div>
                </div>
              ))}

              {/* Add split button */}
              {splits.length < 5 && (
                <button
                  onClick={addSplit}
                  className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
                >
                  <Split className="w-4 h-4" />
                  Split Payment (add another mode)
                </button>
              )}

              {/* Deposit adjustment (only for IPD bills) */}
              {bill.admission_id && (
                <div className="border rounded-xl p-4 bg-amber-50 border-amber-200">
                  <label className="text-sm font-medium text-amber-800 block mb-2">
                    Adjust from Advance Deposit
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 text-sm">₹</span>
                    <input
                      type="number"
                      value={depositAdjustment}
                      onChange={e => setDepositAdjustment(e.target.value)}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className="w-full pl-8 pr-4 py-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <p className="text-xs text-amber-600 mt-1">
                    Deduct this amount from the patient's advance deposit
                  </p>
                </div>
              )}

              {/* Notes */}
              <div>
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Payment total</span>
                  <span className="font-semibold">{inr(totalPayment)}</span>
                </div>
                {depAdj > 0 && (
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-amber-600">Deposit adjustment</span>
                    <span className="font-semibold text-amber-700">{inr(depAdj)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm pt-2 border-t mt-2">
                  <span className="font-medium text-gray-700">Total credit</span>
                  <span className={`font-bold ${isOverpaying ? 'text-red-600' : 'text-green-600'}`}>
                    {inr(totalCredit)}
                  </span>
                </div>
                {totalCredit < remaining && (
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-gray-400">Still remaining after</span>
                    <span className="text-gray-500">{inr(remaining - totalCredit)}</span>
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              {isOverpaying && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">
                    Total credit ({inr(totalCredit)}) exceeds remaining due ({inr(remaining)})
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-5 border-t flex gap-3">
              <button
                onClick={onClose}
                disabled={processing}
                className="flex-1 py-3 border rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!isValid || processing}
                className="flex-1 py-3 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Record Payment — {inr(totalCredit)}
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}