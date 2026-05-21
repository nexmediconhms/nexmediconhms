'use client'
/**
 * src/components/billing/RefundModal.tsx
 *
 * Refund initiation modal for billing receipt view.
 * Admin-only feature that:
 *  1. Shows bill details and max refundable amount
 *  2. Collects refund amount, reason, and mode
 *  3. Calls POST /api/billing/refund
 *  4. Shows success/error with credit note info
 */

import { useState } from 'react'
import {
  X, AlertCircle, CheckCircle, Loader2,
  IndianRupee, RotateCcw, FileText,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Bill {
  id: string
  patient_id: string
  patient_name: string
  mrn: string
  net_amount: number
  subtotal: number
  discount: number
  payment_mode: string | null
  razorpay_payment_id?: string
  status: string
  paid_at?: string
  gst_amount?: number
  gst_percent?: number
}

interface RefundModalProps {
  bill: Bill
  onClose: () => void
  onRefunded: () => void
}

const REFUND_MODES = [
  { value: 'original', label: 'Original Payment Method', desc: 'Refund to same method (Razorpay/UPI/Card)' },
  { value: 'cash', label: 'Cash', desc: 'Return cash at counter' },
  { value: 'upi', label: 'UPI Transfer', desc: 'Manual UPI transfer to patient' },
  { value: 'cheque', label: 'Cheque', desc: 'Issue refund cheque' },
]

const REFUND_REASONS = [
  'Duplicate billing',
  'Incorrect amount charged',
  'Service not provided',
  'Patient request — treatment cancelled',
  'Insurance claim approved (full)',
  'Overcharge correction',
  'Other (specify below)',
]

export default function RefundModal({ bill, onClose, onRefunded }: RefundModalProps) {
  const [step, setStep] = useState<'form' | 'confirm' | 'processing' | 'success' | 'error'>('form')
  const [refundType, setRefundType] = useState<'full' | 'partial'>('full')
  const [amount, setAmount] = useState(String(bill.net_amount || 0))
  const [reason, setReason] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [refundMode, setRefundMode] = useState(
    bill.razorpay_payment_id ? 'original' : 'cash'
  )
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<any>(null)

  const maxRefundable = Number(bill.net_amount || 0)
  const refundAmount = Number(amount) || 0

  const effectiveReason = reason === 'Other (specify below)'
    ? customReason.trim()
    : reason

  function handleAmountChange(val: string) {
    setAmount(val)
    const num = Number(val)
    if (num > 0 && num < maxRefundable) setRefundType('partial')
    else setRefundType('full')
  }

  function handleFullPartial(type: 'full' | 'partial') {
    setRefundType(type)
    if (type === 'full') setAmount(String(maxRefundable))
    else setAmount('')
  }

  function validateForm(): string | null {
    if (refundAmount <= 0) return 'Refund amount must be greater than 0'
    if (refundAmount > maxRefundable) return `Amount exceeds maximum refundable (₹${maxRefundable})`
    if (!effectiveReason || effectiveReason.length < 5) return 'Please provide a refund reason (minimum 5 characters)'
    if (!refundMode) return 'Please select a refund mode'
    return null
  }

  function handleNext() {
    const err = validateForm()
    if (err) { setError(err); return }
    setError('')
    setStep('confirm')
  }

  async function handleRefund() {
    setStep('processing')
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setStep('error')
        setError('Session expired. Please log in again.')
        return
      }

      const res = await fetch('/api/billing/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          billId: bill.id,
          amount: refundAmount,
          reason: effectiveReason,
          refundMode,
          notes: notes.trim() || null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setStep('error')
        setError(data.error || 'Refund failed')
        return
      }

      setResult(data)
      setStep('success')
      onRefunded()
    } catch (err: any) {
      setStep('error')
      setError(err.message || 'Network error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={e => { if (e.target === e.currentTarget && step === 'form') onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* ═══ FORM STEP ═══ */}
        {step === 'form' && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-orange-500" />
                Initiate Refund
              </h2>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Bill Summary */}
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-gray-900">{bill.patient_name}</div>
                  <div className="text-xs text-gray-500">
                    MRN: {bill.mrn} · Paid: {bill.paid_at ? new Date(bill.paid_at).toLocaleDateString('en-IN') : '—'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900">₹{maxRefundable.toLocaleString('en-IN')}</div>
                  <div className="text-xs text-gray-400">
                    via {bill.payment_mode || 'cash'}
                    {bill.razorpay_payment_id && ' (Razorpay)'}
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl p-3 text-sm mb-4">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}

            <div className="space-y-4">
              {/* Full / Partial toggle */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Refund Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleFullPartial('full')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                      refundType === 'full'
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    Full Refund (₹{maxRefundable})
                  </button>
                  <button
                    onClick={() => handleFullPartial('partial')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                      refundType === 'partial'
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    Partial Refund
                  </button>
                </div>
              </div>

              {/* Amount */}
              {refundType === 'partial' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Refund Amount (₹)</label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="number"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 pl-9"
                      placeholder="Enter amount"
                      value={amount}
                      onChange={e => handleAmountChange(e.target.value)}
                      max={maxRefundable}
                      min={1}
                      step="0.01"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Max refundable: ₹{maxRefundable.toLocaleString('en-IN')}</p>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Reason for Refund *</label>
                <select
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                >
                  <option value="">— Select reason —</option>
                  {REFUND_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                {reason === 'Other (specify below)' && (
                  <input
                    type="text"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mt-2"
                    placeholder="Specify reason..."
                    value={customReason}
                    onChange={e => setCustomReason(e.target.value)}
                  />
                )}
              </div>

              {/* Refund Mode */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Refund Mode</label>
                <div className="space-y-2">
                  {REFUND_MODES.filter(m => {
                    // Only show 'original' if Razorpay payment exists
                    if (m.value === 'original' && !bill.razorpay_payment_id) return false
                    return true
                  }).map(m => (
                    <label key={m.value}
                      className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                        refundMode === m.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="refundMode"
                        value={m.value}
                        checked={refundMode === m.value}
                        onChange={() => setRefundMode(m.value)}
                        className="accent-blue-600"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-900">{m.label}</div>
                        <div className="text-xs text-gray-400">{m.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Internal Notes (optional)</label>
                <textarea
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none"
                  rows={2}
                  placeholder="Any additional notes for accounting..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={onClose} className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleNext}
                disabled={!effectiveReason || refundAmount <= 0}
                className="flex-1 py-2.5 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                <RotateCcw className="w-4 h-4" /> Review Refund
              </button>
            </div>
          </div>
        )}

        {/* ═══ CONFIRM STEP ═══ */}
        {step === 'confirm' && (
          <div className="p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              Confirm Refund
            </h2>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
              <p className="text-sm text-amber-800 font-medium mb-3">
                Please review before confirming. This action cannot be undone.
              </p>
              <div className="space-y-2 text-sm text-gray-700">
                <div className="flex justify-between">
                  <span>Patient:</span>
                  <span className="font-semibold">{bill.patient_name}</span>
                </div>
                <div className="flex justify-between">
                  <span>Refund Amount:</span>
                  <span className="font-bold text-orange-700">₹{refundAmount.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span>Type:</span>
                  <span className="font-medium">{refundType === 'full' ? 'Full Refund' : 'Partial Refund'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Reason:</span>
                  <span className="font-medium text-right max-w-[200px]">{effectiveReason}</span>
                </div>
                <div className="flex justify-between">
                  <span>Mode:</span>
                  <span className="font-medium">{REFUND_MODES.find(m => m.value === refundMode)?.label}</span>
                </div>
              </div>
            </div>

            {bill.gst_amount && bill.gst_amount > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-xs text-blue-700">
                <strong>GST Note:</strong> A proportional GST reversal of ₹{(Math.round((refundAmount / Number(bill.net_amount || 1)) * Number(bill.gst_amount) * 100) / 100).toFixed(2)} will be recorded in the credit note.
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep('form')}
                className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50">
                Back
              </button>
              <button onClick={handleRefund}
                className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center justify-center gap-2">
                <RotateCcw className="w-4 h-4" /> Confirm Refund
              </button>
            </div>
          </div>
        )}

        {/* ═══ PROCESSING STEP ═══ */}
        {step === 'processing' && (
          <div className="p-8 text-center">
            <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
            <h3 className="text-lg font-bold text-gray-900 mb-2">Processing Refund...</h3>
            <p className="text-sm text-gray-500">
              {bill.razorpay_payment_id && refundMode === 'original'
                ? 'Initiating Razorpay refund and recording transaction...'
                : 'Recording refund and generating credit note...'}
            </p>
          </div>
        )}

        {/* ═══ SUCCESS STEP ═══ */}
        {step === 'success' && result && (
          <div className="p-8">
            <div className="text-center mb-5">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="text-lg font-bold text-green-700 mb-2">Refund Processed</h3>
              <p className="text-sm text-gray-600">{result.message}</p>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2 mb-5">
              <div className="flex items-center gap-2 text-sm">
                <IndianRupee className="w-4 h-4 text-green-500" />
                <span className="text-gray-700">₹{refundAmount.toLocaleString('en-IN')} refunded</span>
              </div>
              {result.creditNoteId && (
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="w-4 h-4 text-green-500" />
                  <span className="text-gray-700">Credit note generated</span>
                </div>
              )}
              {result.razorpayRefundId && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-gray-700">Razorpay refund initiated (ID: {result.razorpayRefundId})</span>
                </div>
              )}
            </div>

            <button onClick={onClose}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm">
              Done
            </button>
          </div>
        )}

        {/* ═══ ERROR STEP ═══ */}
        {step === 'error' && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-red-700 mb-2">Refund Failed</h3>
            <p className="text-sm text-gray-600 mb-5">{error}</p>
            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm">
                Close
              </button>
              <button onClick={() => setStep('form')}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm">
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
