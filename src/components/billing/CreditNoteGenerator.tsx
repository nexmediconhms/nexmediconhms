'use client'

/**
 * src/components/billing/CreditNoteGenerator.tsx
 *
 * Generate credit notes for bill cancellations, refunds, or corrections.
 * Shows GST reversal breakdown (CGST + SGST).
 *
 * Usage:
 *   <CreditNoteGenerator
 *     bill={selectedBill}
 *     onClose={() => setShow(false)}
 *     onGenerated={() => reload()}
 *   />
 */

import { useState } from 'react'
import {
  X, FileText, CheckCircle, AlertCircle, Loader2, IndianRupee,
} from 'lucide-react'

interface Bill {
  id: string
  invoice_number?: string
  patient_id: string
  patient_name?: string
  net_amount?: number
  total?: number
  paid?: number
  status: string
}

interface CreditNoteGeneratorProps {
  bill: Bill
  onClose: () => void
  onGenerated: () => void
}

const TYPES = [
  { value: 'cancellation', label: 'Bill Cancellation' },
  { value: 'refund', label: 'Refund Issued' },
  { value: 'correction', label: 'Billing Correction' },
  { value: 'discount', label: 'Post-billing Discount' },
  { value: 'other', label: 'Other' },
]

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

export default function CreditNoteGenerator({ bill, onClose, onGenerated }: CreditNoteGeneratorProps) {
  const billTotal = Number(bill.net_amount || bill.total || 0)

  const [amount, setAmount] = useState(String(billTotal))
  const [reason, setReason] = useState('')
  const [type, setType] = useState('cancellation')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<any>(null)

  async function handleGenerate() {
    const amtNum = Number(amount)
    if (!amtNum || amtNum <= 0) { setError('Enter a valid amount'); return }
    if (amtNum > billTotal) { setError(`Amount cannot exceed bill total ${inr(billTotal)}`); return }
    if (!reason.trim() || reason.trim().length < 5) { setError('Reason is required (min 5 characters)'); return }

    setProcessing(true)
    setError('')

    try {
      const res = await fetch('/api/billing/credit-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bill_id: bill.id,
          amount: amtNum,
          reason: reason.trim(),
          type,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.error || 'Failed to generate credit note')
        setProcessing(false)
        return
      }

      setResult(data)
      setTimeout(() => onGenerated(), 2000)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setProcessing(false)
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <p className="text-lg font-bold text-green-700">Credit Note Generated</p>
          <p className="text-sm text-gray-600 mt-2 font-mono">{result.credit_note_number}</p>
          <div className="mt-4 bg-gray-50 rounded-lg p-4 text-sm text-left space-y-1">
            <p><span className="text-gray-500">Amount:</span> <span className="font-semibold">{inr(result.credit_note.amount)}</span></p>
            {result.gst_reversal?.gst_amount > 0 && (
              <>
                <p><span className="text-gray-500">GST Reversal:</span> {inr(result.gst_reversal.gst_amount)}</p>
                <p className="text-xs text-gray-400">CGST: {inr(result.gst_reversal.cgst)} + SGST: {inr(result.gst_reversal.sgst)}</p>
              </>
            )}
            <p><span className="text-gray-500">Original Bill:</span> {result.original_bill?.invoice_number}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-600" />
            <div>
              <h2 className="text-lg font-bold text-gray-900">Generate Credit Note</h2>
              <p className="text-xs text-gray-500">{bill.invoice_number} — {bill.patient_name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500">Bill Total</p>
            <p className="text-2xl font-bold text-gray-900">{inr(billTotal)}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Credit Note Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              {TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Credit Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">₹</span>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full pl-8 pr-4 py-2.5 border rounded-lg text-lg font-semibold"
                max={billTotal}
                min={0}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">Max: {inr(billTotal)}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Reason (required)</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why is this credit note being issued?"
              className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
              rows={3}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        <div className="p-5 border-t flex gap-3">
          <button onClick={onClose} disabled={processing}
            className="flex-1 py-3 border rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleGenerate} disabled={processing || !reason.trim() || Number(amount) <= 0}
            className="flex-1 py-3 bg-cyan-600 text-white rounded-xl text-sm font-semibold hover:bg-cyan-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Generate Credit Note
          </button>
        </div>
      </div>
    </div>
  )
}