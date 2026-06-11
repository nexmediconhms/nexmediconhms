'use client'

/**
 * src/components/billing/DepositCollector.tsx
 *
 * Collect advance deposit payments for IPD admissions.
 *
 * Features:
 *   - Collect deposit with payment mode selection
 *   - Shows existing deposits for the admission
 *   - Deposit receipt number generation
 *   - Deposit summary (collected, adjusted, available)
 *
 * Usage:
 *   <DepositCollector
 *     patientId="uuid"
 *     patientName="Jane Doe"
 *     admissionId="uuid"
 *     onDepositCollected={() => reload()}
 *   />
 *
 * ─── ADDITIVE ────────────────────────────────────────────────────────
 * New component. Can be embedded in IPD admission page or IPD billing page.
 * ─────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react'
import {
  IndianRupee, Plus, CheckCircle, AlertCircle, Loader2,
  Banknote, Smartphone, CreditCard, RefreshCw, Clock, ArrowDownCircle,
} from 'lucide-react'

interface DepositCollectorProps {
  patientId: string
  patientName: string
  admissionId?: string
  onDepositCollected?: () => void
  compact?: boolean
}

interface Deposit {
  id: string
  amount: number
  payment_mode: string
  receipt_number: string | null
  status: string
  adjusted_amount: number
  refund_amount: number
  collected_by: string | null
  created_at: string
}

interface DepositSummary {
  totalCollected: number
  totalAdjusted: number
  totalRefunded: number
  availableBalance: number
  count: number
}

const MODES = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'upi', label: 'UPI', icon: Smartphone },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'cheque', label: 'Cheque', icon: IndianRupee },
]

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

function statusBadge(status: string) {
  switch (status) {
    case 'collected':
      return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200"><CheckCircle className="w-3 h-3" />Available</span>
    case 'partially_adjusted':
      return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"><Clock className="w-3 h-3" />Partial</span>
    case 'fully_adjusted':
      return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200"><ArrowDownCircle className="w-3 h-3" />Adjusted</span>
    case 'refunded':
      return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">Refunded</span>
    default:
      return <span className="text-xs text-gray-400">{status}</span>
  }
}

export default function DepositCollector({
  patientId,
  patientName,
  admissionId,
  onDepositCollected,
  compact = false,
}: DepositCollectorProps) {
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [summary, setSummary] = useState<DepositSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('cash')
  const [paymentRef, setPaymentRef] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successReceipt, setSuccessReceipt] = useState('')

  const loadDeposits = useCallback(async () => {
    setLoading(true)
    try {
      const param = admissionId ? `admissionId=${admissionId}` : `patientId=${patientId}`
      const res = await fetch(`/api/billing/deposits?${param}`)
      if (res.ok) {
        const data = await res.json()
        setDeposits(data.deposits || [])
        setSummary(data.summary || null)
      }
    } catch { /* non-fatal */ }
    setLoading(false)
  }, [patientId, admissionId])

  useEffect(() => { loadDeposits() }, [loadDeposits])

  async function handleCollect() {
    const amtNum = Number(amount)
    if (!amtNum || amtNum <= 0) {
      setError('Enter a valid amount')
      return
    }
    setSaving(true)
    setError('')
    setSuccessReceipt('')

    try {
      const res = await fetch('/api/billing/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          admission_id: admissionId || null,
          amount: amtNum,
          payment_mode: mode,
          payment_ref: paymentRef || undefined,
          notes: notes || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.error || 'Failed to collect deposit')
        setSaving(false)
        return
      }

      setSuccessReceipt(data.receipt_number || '')
      setAmount('')
      setPaymentRef('')
      setNotes('')
      setShowForm(false)
      loadDeposits()
      onDepositCollected?.()
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setSaving(false)
  }

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className={`border rounded-xl bg-white ${compact ? 'p-3' : 'p-5'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
            <IndianRupee className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Advance Deposits</h3>
            {summary && (
              <p className="text-xs text-gray-500">
                Available: <span className="font-semibold text-green-600">{inr(summary.availableBalance)}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadDeposits}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => { setShowForm(!showForm); setError(''); setSuccessReceipt('') }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700"
          >
            <Plus className="w-3.5 h-3.5" />
            Collect Deposit
          </button>
        </div>
      </div>

      {/* Success message */}
      {successReceipt && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-green-700">Deposit collected successfully</p>
            <p className="text-xs text-green-600 mt-0.5">Receipt: {successReceipt}</p>
          </div>
        </div>
      )}

      {/* Collect form */}
      {showForm && (
        <div className="mb-4 border rounded-xl p-4 bg-amber-50 border-amber-200">
          <p className="text-sm font-medium text-amber-800 mb-3">
            Collecting advance deposit for {patientName}
          </p>

          <div className="space-y-3">
            {/* Amount */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 text-sm">₹</span>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="Enter deposit amount"
                className="w-full pl-8 pr-4 py-2.5 border border-amber-300 rounded-lg text-lg font-semibold focus:ring-2 focus:ring-amber-500"
                autoFocus
              />
            </div>

            {/* Payment mode */}
            <div className="grid grid-cols-4 gap-2">
              {MODES.map(m => {
                const Icon = m.icon
                const isActive = mode === m.value
                return (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs transition-all ${
                      isActive
                        ? 'border-amber-500 bg-white text-amber-700 font-medium shadow-sm'
                        : 'border-amber-200 text-amber-600/70 hover:border-amber-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {m.label}
                  </button>
                )
              })}
            </div>

            {/* Reference */}
            {mode !== 'cash' && (
              <input
                type="text"
                value={paymentRef}
                onChange={e => setPaymentRef(e.target.value)}
                placeholder={mode === 'upi' ? 'UPI Ref / Transaction ID' : mode === 'cheque' ? 'Cheque Number' : 'Reference'}
                className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm"
              />
            )}

            {/* Notes */}
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm"
            />

            {error && (
              <div className="flex items-start gap-2 p-2 bg-red-50 rounded-lg border border-red-200">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => { setShowForm(false); setError('') }}
                className="flex-1 py-2 border border-amber-300 rounded-lg text-sm text-amber-700 hover:bg-amber-100"
              >
                Cancel
              </button>
              <button
                onClick={handleCollect}
                disabled={saving || !amount || Number(amount) <= 0}
                className="flex-1 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Collect {amount ? inr(Number(amount)) : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary tiles */}
      {summary && summary.count > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          <div className="text-center p-2 bg-green-50 rounded-lg">
            <p className="text-xs text-green-600">Collected</p>
            <p className="text-sm font-bold text-green-700">{inr(summary.totalCollected)}</p>
          </div>
          <div className="text-center p-2 bg-blue-50 rounded-lg">
            <p className="text-xs text-blue-600">Adjusted</p>
            <p className="text-sm font-bold text-blue-700">{inr(summary.totalAdjusted)}</p>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">Refunded</p>
            <p className="text-sm font-bold text-gray-600">{inr(summary.totalRefunded)}</p>
          </div>
          <div className="text-center p-2 bg-amber-50 rounded-lg border border-amber-200">
            <p className="text-xs text-amber-600">Available</p>
            <p className="text-sm font-bold text-amber-700">{inr(summary.availableBalance)}</p>
          </div>
        </div>
      )}

      {/* Deposits list */}
      {loading ? (
        <div className="text-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
        </div>
      ) : deposits.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-3">No deposits collected yet</p>
      ) : (
        <div className="space-y-2">
          {deposits.map(d => (
            <div key={d.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{inr(d.amount)}</p>
                  <p className="text-xs text-gray-500">
                    {d.payment_mode} · {d.receipt_number || '—'} ·{' '}
                    {new Date(d.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </p>
                </div>
              </div>
              <div className="text-right">
                {statusBadge(d.status)}
                {d.adjusted_amount > 0 && d.status !== 'fully_adjusted' && (
                  <p className="text-xs text-gray-400 mt-0.5">Adj: {inr(d.adjusted_amount)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}