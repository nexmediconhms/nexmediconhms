'use client'
/**
 * src/components/billing/PaymentHistoryPanel.tsx
 *
 * Patient Payment History Panel — FIXED rendering & date-range filter
 *
 * BUG FIXES:
 *   1. Previously rendered blank because bills were loaded without JOIN to
 *      bill_payments, and the component expected payment records
 *   2. Date-range filter now properly converts IST dates to UTC boundaries
 *   3. Empty state is handled gracefully (shows helpful message, not blank)
 *   4. Null-safe access on all payment fields prevents type errors
 *   5. Payment mode is always displayed (fallback to 'N/A' instead of null)
 *
 * USAGE:
 *   <PaymentHistoryPanel patientId="uuid" />
 *   <PaymentHistoryPanel patientId="uuid" showDateFilter />
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  IndianRupee, Calendar, Search, RefreshCw,
  CheckCircle, Clock, AlertCircle, CreditCard,
  Smartphone, Banknote, Filter, X,
} from 'lucide-react'

interface Payment {
  id: string
  bill_id: string
  patient_id: string
  amount: number
  payment_mode: string
  reference: string | null
  received_by: string | null
  notes: string | null
  created_at: string
  display_date: string
}

interface Bill {
  id: string
  patient_id: string
  patient_name: string | null
  mrn: string | null
  invoice_number: string | null
  items: { label: string; amount: number }[]
  subtotal: number
  discount: number
  gst_amount: number
  net_amount: number
  total: number
  paid: number
  due: number
  payment_mode: string | null
  status: string
  notes: string | null
  created_at: string
  paid_at: string | null
  display_date: string
}

interface Summary {
  total_payments: number
  total_bills: number
  total_paid: number
  total_billed: number
  total_due: number
  mode_breakdown: Record<string, { count: number; amount: number }>
}

interface PaymentHistoryPanelProps {
  patientId: string
  showDateFilter?: boolean
  compact?: boolean
}

const MODE_ICONS: Record<string, any> = {
  cash: Banknote,
  upi: Smartphone,
  card: CreditCard,
}

const MODE_COLORS: Record<string, string> = {
  cash: 'bg-green-100 text-green-700',
  upi: 'bg-blue-100 text-blue-700',
  card: 'bg-purple-100 text-purple-700',
  insurance: 'bg-yellow-100 text-yellow-700',
  other: 'bg-gray-100 text-gray-700',
}

export default function PaymentHistoryPanel({
  patientId,
  showDateFilter = true,
  compact = false,
}: PaymentHistoryPanelProps) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Date filter state
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [filtersActive, setFiltersActive] = useState(false)

  // Load payment history
  const loadPaymentHistory = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      // Get auth token
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      if (!token) {
        setError('Not authenticated')
        setLoading(false)
        return
      }

      // Build query params
      const params = new URLSearchParams({ patientId })
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)

      const res = await fetch(`/api/billing/payment-history?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || `HTTP ${res.status}`)
        setLoading(false)
        return
      }

      const data = await res.json()
      setPayments(data.payments || [])
      setBills(data.bills || [])
      setSummary(data.summary || null)
      setFiltersActive(!!(startDate || endDate))
    } catch (err: any) {
      setError(err.message || 'Failed to load payment history')
    }

    setLoading(false)
  }, [patientId, startDate, endDate])

  useEffect(() => {
    if (patientId) loadPaymentHistory()
  }, [patientId, loadPaymentHistory])

  // Apply date filter
  function applyFilter() {
    loadPaymentHistory()
  }

  // Clear date filter
  function clearFilter() {
    setStartDate('')
    setEndDate('')
    setFiltersActive(false)
    // Will trigger reload via useEffect
  }

  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-center py-8 text-gray-400">
        <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
        <p className="text-sm">Loading payment history…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span>{error}</span>
        <button onClick={loadPaymentHistory} className="ml-auto text-xs underline">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Date Range Filter */}
      {showDateFilter && (
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="w-4 h-4 text-gray-400" />
          <input
            type="date"
            className="input text-xs px-2 py-1.5 w-36"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            placeholder="From"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            className="input text-xs px-2 py-1.5 w-36"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            placeholder="To"
          />
          <button
            onClick={applyFilter}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1"
          >
            <Filter className="w-3 h-3" /> Filter
          </button>
          {filtersActive && (
            <button
              onClick={clearFilter}
              className="text-xs text-gray-500 hover:text-red-500 flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
          <button
            onClick={loadPaymentHistory}
            className="ml-auto text-gray-400 hover:text-gray-600"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary Stats */}
      {summary && !compact && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-green-700">{inr(summary.total_paid)}</div>
            <div className="text-xs text-gray-600">Total Paid</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-blue-700">{inr(summary.total_billed)}</div>
            <div className="text-xs text-gray-600">Total Billed</div>
          </div>
          <div className="bg-orange-50 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-orange-700">{inr(summary.total_due)}</div>
            <div className="text-xs text-gray-600">Outstanding</div>
          </div>
        </div>
      )}

      {/* Bills List */}
      {bills.length === 0 && payments.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <IndianRupee className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">No payment records found</p>
          {filtersActive && (
            <p className="text-xs mt-1">Try adjusting the date range or clearing filters.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {bills.map(bill => {
            const ModeIcon = MODE_ICONS[bill.payment_mode || ''] || IndianRupee
            const modeColor = MODE_COLORS[bill.payment_mode || ''] || MODE_COLORS.other
            const statusColor = bill.status === 'paid'
              ? 'bg-green-100 text-green-700'
              : bill.status === 'partial'
                ? 'bg-orange-100 text-orange-700'
                : 'bg-yellow-100 text-yellow-700'

            return (
              <div
                key={bill.id}
                className="border border-gray-100 rounded-lg p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">
                      {inr(bill.net_amount)}
                    </span>
                    {bill.invoice_number && (
                      <span className="text-xs text-gray-400 font-mono">
                        #{bill.invoice_number}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${modeColor}`}>
                      <ModeIcon className="w-3 h-3 inline mr-1" />
                      {bill.payment_mode || 'N/A'}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}`}>
                      {bill.status === 'paid' && <CheckCircle className="w-3 h-3 inline mr-0.5" />}
                      {bill.status === 'unpaid' && <Clock className="w-3 h-3 inline mr-0.5" />}
                      {bill.status}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-gray-500">
                  {bill.display_date}
                  {bill.discount > 0 && (
                    <span className="ml-2 text-orange-600">
                      Discount: {inr(bill.discount)}
                    </span>
                  )}
                  {bill.due > 0 && (
                    <span className="ml-2 text-red-600 font-medium">
                      Due: {inr(bill.due)}
                    </span>
                  )}
                </div>

                {/* Bill items */}
                {!compact && bill.items.length > 0 && (
                  <div className="text-xs text-gray-500 mt-1 truncate">
                    {bill.items.map(i => i.label).join(', ')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Individual Payments (if different from bills — e.g., partial payments) */}
      {payments.length > 0 && payments.length !== bills.length && !compact && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-gray-600 uppercase mb-2">
            Individual Payment Records ({payments.length})
          </h4>
          <div className="space-y-1">
            {payments.map(p => (
              <div key={p.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">{inr(p.amount)}</span>
                  <span className={`px-1.5 py-0.5 rounded ${MODE_COLORS[p.payment_mode] || MODE_COLORS.other}`}>
                    {p.payment_mode || 'N/A'}
                  </span>
                </div>
                <span className="text-gray-400">{p.display_date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment Mode Breakdown */}
      {summary && !compact && Object.keys(summary.mode_breakdown).length > 0 && (
        <div className="bg-gray-50 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-gray-600 uppercase mb-2">Payment Mode Breakdown</h4>
          <div className="flex flex-wrap gap-3">
            {Object.entries(summary.mode_breakdown).map(([mode, data]) => (
              <div key={mode} className="text-xs">
                <span className={`inline-block px-2 py-0.5 rounded-full font-medium ${MODE_COLORS[mode] || MODE_COLORS.other}`}>
                  {mode.toUpperCase()}: {inr(data.amount)} ({data.count})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}