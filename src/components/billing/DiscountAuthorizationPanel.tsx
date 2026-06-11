'use client'

/**
 * src/components/billing/DiscountAuthorizationPanel.tsx
 *
 * Request discounts (with role-based auto-approval) and view/approve pending requests.
 *
 * Usage:
 *   <DiscountAuthorizationPanel bill={bill} onDiscountApplied={() => reload()} />
 *   <DiscountAuthorizationPanel pendingView isAdmin onApproval={() => reload()} />
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Percent, CheckCircle, XCircle, AlertCircle, Loader2,
  ShieldCheck, Clock, RefreshCw,
} from 'lucide-react'

interface Bill {
  id: string
  invoice_number?: string
  patient_name?: string
  net_amount?: number
  total?: number
  discount?: number
}

interface DiscountAuthorizationPanelProps {
  bill?: Bill
  onDiscountApplied?: () => void
  /** Show pending approvals view instead of request form */
  pendingView?: boolean
  isAdmin?: boolean
  onApproval?: () => void
}

const CATEGORIES = [
  { value: 'regular_patient', label: 'Regular Patient' },
  { value: 'staff_relative', label: 'Staff / Relative' },
  { value: 'financial_hardship', label: 'Financial Hardship' },
  { value: 'senior_citizen', label: 'Senior Citizen' },
  { value: 'package_deal', label: 'Package Deal' },
  { value: 'referral', label: 'Referral Discount' },
  { value: 'other', label: 'Other' },
]

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

export default function DiscountAuthorizationPanel({
  bill, onDiscountApplied, pendingView, isAdmin, onApproval,
}: DiscountAuthorizationPanelProps) {
  // ── Pending approvals view ─────────────────────────────────────
  if (pendingView) return <PendingApprovals isAdmin={isAdmin} onApproval={onApproval} />

  // ── Request form view ──────────────────────────────────────────
  if (!bill) return null

  const billTotal = Number(bill.net_amount || bill.total || 0)
  const existingDiscount = Number(bill.discount || 0)

  const [mode, setMode] = useState<'percent' | 'amount'>('percent')
  const [value, setValue] = useState('')
  const [category, setCategory] = useState('regular_patient')
  const [reason, setReason] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<any>(null)

  const discountAmt = mode === 'percent'
    ? Math.round((billTotal * (Number(value) || 0)) / 100 * 100) / 100
    : Number(value) || 0
  const discountPct = mode === 'amount'
    ? Math.round(((Number(value) || 0) / billTotal) * 100 * 100) / 100
    : Number(value) || 0

  async function handleRequest() {
    if (!bill) return
    if (discountAmt <= 0) { setError('Enter a valid discount'); return }
    if (!reason.trim() || reason.trim().length < 3) { setError('Reason is required'); return }

    setProcessing(true)
    setError('')

    try {
      const body: any = {
        bill_id: bill.id,
        reason: reason.trim(),
        category,
      }
      if (mode === 'percent') body.discount_percent = Number(value)
      else body.discount_amount = Number(value)

      const res = await fetch('/api/billing/discount-authorization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.error || 'Failed to apply discount')
        setProcessing(false)
        return
      }

      setResult(data)
      if (data.auto_approved) setTimeout(() => onDiscountApplied?.(), 1500)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setProcessing(false)
  }

  if (existingDiscount > 0) {
    return (
      <div className="border rounded-xl p-4 bg-green-50 border-green-200">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-500" />
          <div>
            <p className="text-sm font-medium text-green-800">Discount Applied: {inr(existingDiscount)}</p>
            <p className="text-xs text-green-600">({Math.round((existingDiscount / billTotal) * 100)}% of {inr(billTotal)})</p>
          </div>
        </div>
      </div>
    )
  }

  if (result) {
    return (
      <div className="border rounded-xl p-5 text-center">
        {result.auto_approved ? (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <p className="font-semibold text-green-700">Discount Applied</p>
            <p className="text-sm text-gray-600 mt-1">
              {inr(result.discount.amount)} ({result.discount.percent}%) — auto-approved
            </p>
          </>
        ) : (
          <>
            <Clock className="w-12 h-12 text-amber-500 mx-auto mb-3" />
            <p className="font-semibold text-amber-700">Sent for Approval</p>
            <p className="text-sm text-gray-600 mt-1">{result.message}</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Percent className="w-5 h-5 text-blue-600" />
        <h3 className="font-semibold text-gray-900 text-sm">Apply Discount</h3>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <button onClick={() => setMode('percent')}
            className={`flex-1 py-2 rounded-lg text-xs font-medium border ${mode === 'percent' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500'}`}>
            By Percentage
          </button>
          <button onClick={() => setMode('amount')}
            className={`flex-1 py-2 rounded-lg text-xs font-medium border ${mode === 'amount' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500'}`}>
            By Amount
          </button>
        </div>

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            {mode === 'percent' ? '%' : '₹'}
          </span>
          <input type="number" value={value} onChange={e => setValue(e.target.value)}
            placeholder={mode === 'percent' ? 'e.g. 10' : 'e.g. 500'}
            className="w-full pl-8 pr-4 py-2 border rounded-lg text-sm font-semibold" />
        </div>

        {discountAmt > 0 && (
          <p className="text-xs text-gray-500">
            Discount: {inr(discountAmt)} ({discountPct}%) — New total: {inr(Math.max(0, billTotal - discountAmt))}
          </p>
        )}

        <select value={category} onChange={e => setCategory(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg text-sm">
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        <input type="text" value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Reason for discount" className="w-full px-3 py-2 border rounded-lg text-sm" />

        {error && (
          <div className="flex items-start gap-2 p-2 bg-red-50 rounded-lg border border-red-200">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <button onClick={handleRequest}
          disabled={processing || discountAmt <= 0 || !reason.trim()}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
          {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Percent className="w-4 h-4" />}
          Apply Discount
        </button>
      </div>
    </div>
  )
}

// ── Pending Approvals Sub-component ──────────────────────────────────

function PendingApprovals({ isAdmin, onApproval }: { isAdmin?: boolean; onApproval?: () => void }) {
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/billing/discount-authorization?pending=true')
      if (res.ok) {
        const data = await res.json()
        setRequests(data.requests || [])
      }
    } catch { /* non-fatal */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAction(billId: string, action: 'approve' | 'reject') {
    setActionLoading(billId)
    try {
      const res = await fetch('/api/billing/discount-authorization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill_id: billId, action }),
      })
      if (res.ok) {
        load()
        onApproval?.()
      }
    } catch { /* non-fatal */ }
    setActionLoading(null)
  }

  if (loading) {
    return <div className="text-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" /></div>
  }

  if (requests.length === 0) {
    return (
      <div className="border rounded-xl p-6 text-center">
        <ShieldCheck className="w-8 h-8 text-green-400 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No pending discount approvals</p>
      </div>
    )
  }

  return (
    <div className="border rounded-xl">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-gray-900 text-sm">Pending Discount Approvals</h3>
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{requests.length}</span>
        </div>
        <button onClick={load} className="p-1.5 hover:bg-gray-100 rounded-lg">
          <RefreshCw className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <div className="divide-y">
        {requests.map(r => (
          <div key={r.bill_id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{r.invoice_number}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Bill: {inr(r.bill_total)} — Requested: {inr(r.request?.discount_amount || 0)} ({r.request?.discount_percent}%)
                </p>
                <p className="text-xs text-gray-500">
                  By: {r.request?.requested_by} ({r.request?.requested_role}) — {r.request?.category}
                </p>
                <p className="text-xs text-gray-600 mt-1 italic">"{r.request?.reason}"</p>
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <button onClick={() => handleAction(r.bill_id, 'approve')}
                    disabled={actionLoading === r.bill_id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">
                    {actionLoading === r.bill_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                    Approve
                  </button>
                  <button onClick={() => handleAction(r.bill_id, 'reject')}
                    disabled={actionLoading === r.bill_id}
                    className="flex items-center gap-1 px-3 py-1.5 border border-red-300 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 disabled:opacity-50">
                    <XCircle className="w-3 h-3" />
                    Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}