'use client'

/**
 * src/components/billing/PatientLedger.tsx
 *
 * Patient Financial Ledger — Shows all financial transactions for a patient
 * with running balance and outstanding summary.
 *
 * Features:
 *   - All bills, payments, deposits, refunds, credit notes
 *   - Running balance column
 *   - Outstanding amount summary
 *   - Date range filter
 *   - Print-friendly layout
 *   - Color-coded entry types
 *
 * Usage:
 *   <PatientLedger patientId="uuid" />
 *
 * ─── ADDITIVE ────────────────────────────────────────────────────────
 * New component. Can be added as a tab on patient profile page
 * or rendered standalone on the billing page.
 * ─────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react'
import {
  IndianRupee, RefreshCw, Loader2, AlertCircle, Calendar,
  TrendingUp, TrendingDown, Printer, ArrowDown, ArrowUp,
  Receipt, FileText, ArrowDownCircle, Undo2,
} from 'lucide-react'

interface LedgerEntry {
  id: string
  date: string
  type: 'bill' | 'payment' | 'deposit' | 'deposit_adjustment' | 'refund' | 'credit_note'
  description: string
  reference: string
  debit: number
  credit: number
  balance: number
  meta?: Record<string, any>
}

interface LedgerSummary {
  totalBilled: number
  totalPaid: number
  totalDeposits: number
  totalDepositsAdjusted: number
  totalRefunds: number
  totalCreditNotes: number
  currentOutstanding: number
}

interface PatientInfo {
  id: string
  name?: string
  mrn?: string
  mobile?: string
}

interface PatientLedgerProps {
  patientId: string
  /** Show compact version (fewer columns, smaller text) */
  compact?: boolean
  /** Max height with scroll */
  maxHeight?: string
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const TYPE_CONFIG: Record<string, { label: string; icon: any; color: string; bgColor: string }> = {
  bill:               { label: 'Bill',       icon: FileText,       color: 'text-red-600',   bgColor: 'bg-red-50'    },
  payment:            { label: 'Payment',    icon: IndianRupee,    color: 'text-green-600', bgColor: 'bg-green-50'  },
  deposit:            { label: 'Deposit',    icon: ArrowDown,      color: 'text-amber-600', bgColor: 'bg-amber-50'  },
  deposit_adjustment: { label: 'Adjusted',   icon: ArrowDownCircle, color: 'text-blue-600', bgColor: 'bg-blue-50'  },
  refund:             { label: 'Refund',     icon: Undo2,          color: 'text-purple-600', bgColor: 'bg-purple-50'},
  credit_note:        { label: 'Credit Note', icon: Receipt,       color: 'text-cyan-600',  bgColor: 'bg-cyan-50'  },
}

export default function PatientLedger({ patientId, compact = false, maxHeight }: PatientLedgerProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [summary, setSummary] = useState<LedgerSummary | null>(null)
  const [patient, setPatient] = useState<PatientInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const loadLedger = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      let url = `/api/billing/patient-ledger?patientId=${patientId}`
      if (fromDate) url += `&from=${fromDate}`
      if (toDate) url += `&to=${toDate}`

      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to load ledger')
        setLoading(false)
        return
      }

      const data = await res.json()
      setEntries(data.entries || [])
      setSummary(data.summary || null)
      setPatient(data.patient || null)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    }
    setLoading(false)
  }, [patientId, fromDate, toDate])

  useEffect(() => { loadLedger() }, [loadLedger])

  function handlePrint() {
    window.print()
  }

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="border rounded-xl bg-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Financial Ledger</h3>
            {patient && (
              <p className="text-xs text-gray-500">
                {patient.name}{patient.mrn ? ` · ${patient.mrn}` : ''}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"
            title="Print"
          >
            <Printer className="w-4 h-4" />
          </button>
          <button
            onClick={loadLedger}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      {summary && (
        <div className="p-4 bg-gray-50 border-b">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center p-3 bg-white rounded-lg border">
              <TrendingUp className="w-4 h-4 text-red-400 mx-auto mb-1" />
              <p className="text-xs text-gray-500">Total Billed</p>
              <p className="text-sm font-bold text-gray-900">{inr(summary.totalBilled)}</p>
            </div>
            <div className="text-center p-3 bg-white rounded-lg border">
              <TrendingDown className="w-4 h-4 text-green-400 mx-auto mb-1" />
              <p className="text-xs text-gray-500">Total Paid</p>
              <p className="text-sm font-bold text-green-600">{inr(summary.totalPaid)}</p>
            </div>
            <div className="text-center p-3 bg-white rounded-lg border">
              <ArrowDown className="w-4 h-4 text-amber-400 mx-auto mb-1" />
              <p className="text-xs text-gray-500">Deposits</p>
              <p className="text-sm font-bold text-amber-600">{inr(summary.totalDeposits)}</p>
            </div>
            <div className={`text-center p-3 rounded-lg border ${
              summary.currentOutstanding > 0
                ? 'bg-red-50 border-red-200'
                : 'bg-green-50 border-green-200'
            }`}>
              <IndianRupee className={`w-4 h-4 mx-auto mb-1 ${
                summary.currentOutstanding > 0 ? 'text-red-500' : 'text-green-500'
              }`} />
              <p className="text-xs text-gray-500">Outstanding</p>
              <p className={`text-sm font-bold ${
                summary.currentOutstanding > 0 ? 'text-red-600' : 'text-green-600'
              }`}>
                {inr(summary.currentOutstanding)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Date filter */}
      <div className="px-4 py-3 border-b flex flex-wrap items-center gap-3">
        <Calendar className="w-4 h-4 text-gray-400" />
        <input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          className="px-2 py-1.5 border rounded-lg text-xs"
          placeholder="From"
        />
        <span className="text-gray-400 text-xs">to</span>
        <input
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          className="px-2 py-1.5 border rounded-lg text-xs"
          placeholder="To"
        />
        {(fromDate || toDate) && (
          <button
            onClick={() => { setFromDate(''); setToDate('') }}
            className="text-xs text-blue-600 hover:underline"
          >
            Clear
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {entries.length} entries
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Ledger table */}
      <div style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}>
        {loading ? (
          <div className="text-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
            <p className="text-sm text-gray-400 mt-2">Loading ledger...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8">
            <Receipt className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No financial records found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Description</th>
                {!compact && (
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Reference</th>
                )}
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-red-500 uppercase">Debit</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-green-500 uppercase">Credit</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((entry, idx) => {
                const cfg = TYPE_CONFIG[entry.type] || TYPE_CONFIG.bill
                const Icon = cfg.icon
                return (
                  <tr key={`${entry.id}-${idx}`} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(entry.date).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${cfg.bgColor} ${cfg.color}`}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 max-w-[200px] truncate" title={entry.description}>
                      {entry.description}
                    </td>
                    {!compact && (
                      <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">
                        {entry.reference || '—'}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-right text-xs font-semibold tabular-nums">
                      {entry.debit > 0 ? (
                        <span className="text-red-600">{inr(entry.debit)}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold tabular-nums">
                      {entry.credit > 0 ? (
                        <span className="text-green-600">{inr(entry.credit)}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold tabular-nums">
                      <span className={entry.balance > 0 ? 'text-red-700' : entry.balance < 0 ? 'text-green-700' : 'text-gray-500'}>
                        {entry.balance > 0 ? inr(entry.balance) : entry.balance < 0 ? `-${inr(Math.abs(entry.balance))}` : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {summary && summary.currentOutstanding > 0 && (
        <div className="p-4 border-t bg-red-50">
          <div className="flex items-center justify-between">
            <p className="text-sm text-red-700">
              <span className="font-medium">Current Outstanding:</span> Patient owes{' '}
              <span className="font-bold">{inr(summary.currentOutstanding)}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}