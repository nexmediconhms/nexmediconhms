'use client'

/**
 * src/components/billing/OutstandingReport.tsx
 *
 * Outstanding / Aging Report dashboard showing overdue bills
 * grouped by aging buckets (current, 1-7, 8-15, 16-30, 31-60, 61-90, 90+).
 *
 * Usage:
 *   <OutstandingReport />
 *   <OutstandingReport module="IPD" onPayBill={(id) => openPayment(id)} />
 */

import { useCallback, useEffect, useState } from 'react'
import {
  IndianRupee, RefreshCw, Loader2, AlertTriangle, Clock,
  TrendingUp, Filter, Printer,
} from 'lucide-react'

interface OutstandingBill {
  id: string
  invoice_number: string
  patient_id: string
  patient_name: string
  mrn: string
  bill_date: string
  total: number
  paid: number
  due: number
  status: string
  module: string
  days_overdue: number
  aging_bucket: string
}

interface AgingBucket {
  count: number
  amount: number
}

interface OutstandingReportProps {
  module?: 'OPD' | 'IPD' | 'all'
  onPayBill?: (billId: string) => void
  maxHeight?: string
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

const BUCKET_COLORS: Record<string, string> = {
  'current': 'bg-green-50 text-green-700 border-green-200',
  '1-7 days': 'bg-blue-50 text-blue-700 border-blue-200',
  '8-15 days': 'bg-yellow-50 text-yellow-700 border-yellow-200',
  '16-30 days': 'bg-amber-50 text-amber-700 border-amber-200',
  '31-60 days': 'bg-orange-50 text-orange-700 border-orange-200',
  '61-90 days': 'bg-red-50 text-red-700 border-red-200',
  '90+ days': 'bg-red-100 text-red-800 border-red-300',
}

export default function OutstandingReport({ module = 'all', onPayBill, maxHeight }: OutstandingReportProps) {
  const [bills, setBills] = useState<OutstandingBill[]>([])
  const [buckets, setBuckets] = useState<Record<string, AgingBucket>>({})
  const [totalOutstanding, setTotalOutstanding] = useState(0)
  const [totalBills, setTotalBills] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filterBucket, setFilterBucket] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/billing/outstanding-report?module=${module}`)
      if (res.ok) {
        const data = await res.json()
        setBills(data.bills || [])
        setBuckets(data.aging_buckets || {})
        setTotalOutstanding(data.total_outstanding || 0)
        setTotalBills(data.total_bills || 0)
      }
    } catch { /* non-fatal */ }
    setLoading(false)
  }, [module])

  useEffect(() => { load() }, [load])

  const filtered = filterBucket
    ? bills.filter(b => b.aging_bucket === filterBucket)
    : bills

  return (
    <div className="border rounded-xl bg-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Outstanding Report</h3>
            <p className="text-xs text-gray-500">{totalBills} bills · {module !== 'all' ? module : 'All modules'}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400">
            <Printer className="w-4 h-4" />
          </button>
          <button onClick={load} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Total Outstanding */}
      <div className="p-4 bg-red-50 border-b">
        <div className="text-center">
          <p className="text-xs text-red-600 font-medium uppercase">Total Outstanding</p>
          <p className="text-3xl font-bold text-red-700 mt-1">{inr(totalOutstanding)}</p>
        </div>
      </div>

      {/* Aging Buckets */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase">Aging Buckets</span>
          {filterBucket && (
            <button onClick={() => setFilterBucket(null)} className="text-xs text-blue-600 hover:underline ml-auto">
              Clear filter
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {Object.entries(buckets).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setFilterBucket(filterBucket === key ? null : key)}
              className={`text-center p-2 rounded-lg border text-xs transition-all ${
                filterBucket === key ? 'ring-2 ring-blue-500' : ''
              } ${BUCKET_COLORS[key] || 'bg-gray-50 text-gray-700 border-gray-200'}`}
            >
              <p className="font-medium">{key}</p>
              <p className="font-bold text-sm mt-0.5">{inr(val.amount)}</p>
              <p className="text-[10px] opacity-70">{val.count} bills</p>
            </button>
          ))}
        </div>
      </div>

      {/* Bills list */}
      <div style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}>
        {loading ? (
          <div className="text-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <AlertTriangle className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">
              {filterBucket ? `No bills in "${filterBucket}" bucket` : 'No outstanding bills'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Invoice</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Patient</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Total</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Due</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Days</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Aging</th>
                {onPayBill && <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(b => (
                <tr key={b.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2.5">
                    <p className="text-xs font-mono font-medium text-gray-900">{b.invoice_number}</p>
                    <p className="text-[10px] text-gray-400">{new Date(b.bill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="text-xs text-gray-900">{b.patient_name}</p>
                    <p className="text-[10px] text-gray-400">{b.mrn}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-600">{inr(b.total)}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-red-600">{inr(b.due)}</td>
                  <td className="px-4 py-2.5 text-center text-xs text-gray-500">{b.days_overdue}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${BUCKET_COLORS[b.aging_bucket] || ''}`}>
                      {b.aging_bucket}
                    </span>
                  </td>
                  {onPayBill && (
                    <td className="px-4 py-2.5 text-center">
                      <button onClick={() => onPayBill(b.id)}
                        className="text-xs text-green-600 hover:underline font-medium">
                        Pay
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}