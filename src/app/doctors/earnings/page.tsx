'use client'
/**
 * src/app/doctors/earnings/page.tsx
 *
 * Doctor Earnings & Settlement Dashboard
 *
 * Add to navigation: /doctors/earnings
 */

import { useEffect, useState, useCallback } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatCurrency, todayIST } from '@/lib/business-logic'
import {
  Stethoscope, IndianRupee, RefreshCw, ChevronDown,
  CheckCircle, AlertCircle, BarChart2, Calendar,
} from 'lucide-react'

interface DoctorEarning {
  doctorid:      string
  doctorname:    string
  opdCount:      number
  ipdCount:      number
  opdRevenue:    number
  ipdRevenue:    number
  collected:     number
  sharePct:      number
  totalRevenue:  number
  doctorEarning: number
  clinicShare:   number
}

// ── Doctor Card ───────────────────────────────────────────────

function DoctorCard({ earning }: { earning: DoctorEarning }) {
  const [expanded, setExpanded] = useState(false)
  const [settling,  setSettling] = useState(false)
  const [settled,   setSettled]  = useState(false)

  async function handleSettle() {
    setSettling(true)
    try {
      const { error } = await supabase.from('doctor_settlements').insert({
        doctorid:        earning.doctorid !== 'unknown' ? earning.doctorid : null,
        doctorname:      earning.doctorname,
        opd_count:       earning.opdCount,
        ipd_count:       earning.ipdCount,
        opd_revenue:     earning.opdRevenue,
        ipd_revenue:     earning.ipdRevenue,
        doctor_share_pct: earning.sharePct,
        doctor_earning:  earning.doctorEarning,
        clinic_share:    earning.clinicShare,
        status:          'approved',
        approved_by:     'admin',
      })
      if (error) throw error
      setSettled(true)
    } catch (e: any) {
      alert('Settlement failed: ' + (e.message || 'Unknown error'))
    }
    setSettling(false)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <Stethoscope className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <div className="font-bold text-gray-900">{earning.doctorname}</div>
            <div className="text-xs text-gray-500">
              {earning.opdCount} OPD · {earning.ipdCount} IPD
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-lg font-black text-blue-700">
              {formatCurrency(earning.doctorEarning)}
            </div>
            <div className="text-xs text-gray-400">Doctor share ({earning.sharePct}%)</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {/* Revenue cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 rounded-xl p-3">
              <div className="text-xs text-blue-600 font-semibold mb-1">OPD Revenue</div>
              <div className="text-xl font-black text-blue-900">
                {formatCurrency(earning.opdRevenue)}
              </div>
              <div className="text-xs text-blue-500">{earning.opdCount} patients</div>
            </div>
            <div className="bg-purple-50 rounded-xl p-3">
              <div className="text-xs text-purple-600 font-semibold mb-1">IPD Revenue</div>
              <div className="text-xl font-black text-purple-900">
                {formatCurrency(earning.ipdRevenue)}
              </div>
              <div className="text-xs text-purple-500">{earning.ipdCount} admissions</div>
            </div>
          </div>

          {/* Share breakdown */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total Revenue</span>
              <span className="font-bold">{formatCurrency(earning.totalRevenue)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Doctor Share ({earning.sharePct}%)</span>
              <span className="font-bold text-green-700">{formatCurrency(earning.doctorEarning)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-gray-200 pt-2">
              <span className="text-gray-500">Clinic Share</span>
              <span className="font-bold text-blue-700">{formatCurrency(earning.clinicShare)}</span>
            </div>
          </div>

          {/* Settle button */}
          {settled ? (
            <div className="flex items-center gap-2 bg-green-50 rounded-xl p-3 text-green-700">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-semibold">Settlement recorded successfully</span>
            </div>
          ) : (
            <button
              onClick={handleSettle}
              disabled={settling}
              className="w-full bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl
                         font-semibold text-sm transition-colors disabled:opacity-50"
            >
              {settling ? 'Recording…' : `✅ Settle ${formatCurrency(earning.doctorEarning)}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

export default function DoctorEarningsPage() {
  const today = todayIST()
  const firstOfMonth = today.slice(0, 8) + '01'

  const [from,     setFrom]     = useState(firstOfMonth)
  const [to,       setTo]       = useState(today)
  const [earnings, setEarnings] = useState<DoctorEarning[]>([])
  const [totals,   setTotals]   = useState<any>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const load = useCallback(async () => {
    if (!from || !to) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/doctor/earnings?from=${from}&to=${to}`)
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to load')
      }
      const data = await res.json()
      setEarnings(data.earnings || [])
      setTotals(data.totals)
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }, [from, to])

  useEffect(() => { load() }, [load])

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Doctor Earnings</h1>
            <p className="text-sm text-gray-500">Revenue share & settlement tracking</p>
          </div>
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200">
            <RefreshCw className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* Date range */}
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
            <input
              type="date"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
            <input
              type="date"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </div>
          <button
            onClick={load}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold h-[38px]"
          >
            Load
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl p-3 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* Totals */}
        {totals && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Revenue',  value: formatCurrency(totals.totalRevenue),  color: 'text-gray-900'  },
              { label: 'Doctor Share',   value: formatCurrency(totals.doctorEarning), color: 'text-green-700' },
              { label: 'Clinic Share',   value: formatCurrency(totals.clinicShare),   color: 'text-blue-700'  },
              { label: 'OPD + IPD',      value: `${totals.opdCount + totals.ipdCount}`, color: 'text-purple-700' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                <div className={`text-xl font-black ${color}`}>{value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Doctor cards */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : earnings.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No earnings data for this period</p>
            <p className="text-xs mt-1">
              Make sure encounters have doctor names (doctorid / doctorname) assigned
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {earnings.map(e => <DoctorCard key={e.doctorid} earning={e} />)}
          </div>
        )}
      </div>
    </AppShell>
  )
}