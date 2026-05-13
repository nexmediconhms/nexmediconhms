'use client'
/**
 * src/app/reports/lab-revenue/page.tsx
 *
 * Lab Revenue Report — Pathology Split
 *
 * Features:
 *   - Filter by month (with nav)
 *   - Filter by payment mode (cash/upi/card/all)
 *   - Show hospital amount vs lab amount per report
 *   - Net payment to hospital & net payment to lab
 *   - Summary view + Detail (report-by-report) view toggle
 *   - Partner-wise breakdown
 *   - Print / Export
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import {
  FlaskConical, IndianRupee, Printer, RefreshCw,
  ChevronLeft, ChevronRight, TrendingUp, Filter,
} from 'lucide-react'

interface LabReportRow {
  id: string
  report_date: string
  patient_name: string
  mrn: string
  lab_name: string
  total_amount: number
  hospital_amount: number
  lab_amount: number
  payment_mode: string
  payment_status: string
  partner_name: string | null
  entries: any[]
}

interface PartnerSummary {
  name: string
  total: number
  hospital: number
  lab: number
  count: number
}

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']

export default function LabRevenuePage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [modeFilter, setModeFilter] = useState<'all' | 'cash' | 'upi' | 'card'>('all')
  const [viewMode, setViewMode] = useState<'summary' | 'detail'>('summary')
  const [reports, setReports] = useState<LabReportRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [year, month])

  async function load() {
    setLoading(true)
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]

    const { data } = await supabase
      .from('lab_reports')
      .select(`
        id, report_date, lab_name, total_amount, hospital_amount, lab_amount,
        payment_mode, payment_status, entries,
        patients!inner ( full_name, mrn ),
        lab_partners ( name )
      `)
      .gte('report_date', startDate)
      .lte('report_date', endDate)
      .order('report_date', { ascending: false })

    const mapped: LabReportRow[] = (data || []).map((r: any) => ({
      id: r.id,
      report_date: r.report_date,
      patient_name: r.patients?.full_name || '—',
      mrn: r.patients?.mrn || '—',
      lab_name: r.lab_name || '—',
      total_amount: Number(r.total_amount) || 0,
      hospital_amount: Number(r.hospital_amount) || 0,
      lab_amount: Number(r.lab_amount) || 0,
      payment_mode: r.payment_mode || 'cash',
      payment_status: r.payment_status || 'paid',
      partner_name: r.lab_partners?.name || null,
      entries: r.entries || [],
    }))

    setReports(mapped)
    setLoading(false)
  }

  // Filter by payment mode
  const filtered = reports.filter(r => modeFilter === 'all' || r.payment_mode === modeFilter)

  // Computed totals
  const totalAmount = filtered.reduce((s, r) => s + r.total_amount, 0)
  const totalHospital = filtered.reduce((s, r) => s + r.hospital_amount, 0)
  const totalLab = filtered.reduce((s, r) => s + r.lab_amount, 0)
  const totalCash = filtered.filter(r => r.payment_mode === 'cash').reduce((s, r) => s + r.total_amount, 0)
  const totalUpi = filtered.filter(r => r.payment_mode === 'upi').reduce((s, r) => s + r.total_amount, 0)
  const totalCard = filtered.filter(r => r.payment_mode === 'card').reduce((s, r) => s + r.total_amount, 0)

  // Partner-wise summary
  const partnerMap: Record<string, PartnerSummary> = {}
  filtered.forEach(r => {
    const name = r.partner_name || 'No Partner (100% Hospital)'
    if (!partnerMap[name]) partnerMap[name] = { name, total: 0, hospital: 0, lab: 0, count: 0 }
    partnerMap[name].total += r.total_amount
    partnerMap[name].hospital += r.hospital_amount
    partnerMap[name].lab += r.lab_amount
    partnerMap[name].count += 1
  })
  const partnerSummaries = Object.values(partnerMap).sort((a, b) => b.total - a.total)

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1)) return
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FlaskConical className="w-6 h-6 text-indigo-600" /> Lab Revenue Report
            </h1>
            <p className="text-sm text-gray-500">Hospital vs Lab split — pathology revenue sharing</p>
          </div>
          <div className="flex gap-2 no-print">
            <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2 text-xs">
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button onClick={load} className="btn-secondary flex items-center gap-2 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </div>

        {/* Month nav + filters */}
        <div className="card p-4 mb-5 flex items-center justify-between no-print">
          <button onClick={prevMonth} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <div className="text-center">
            <div className="text-xl font-bold text-gray-900">{MONTH_NAMES[month - 1]} {year}</div>
            <div className="text-xs text-gray-400">{filtered.length} lab reports</div>
          </div>
          <button onClick={nextMonth} disabled={isCurrentMonth}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap gap-2 mb-5 items-center no-print">
          <Filter className="w-4 h-4 text-gray-400" />
          <span className="text-xs text-gray-500 font-semibold">Payment:</span>
          {(['all', 'cash', 'upi', 'card'] as const).map(m => (
            <button key={m} onClick={() => setModeFilter(m)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full capitalize transition-all
                ${modeFilter === m ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {m === 'all' ? 'All' : m}
            </button>
          ))}
          <span className="text-xs text-gray-300 mx-2">|</span>
          <span className="text-xs text-gray-500 font-semibold">View:</span>
          <button onClick={() => setViewMode('summary')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${viewMode === 'summary' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            Summary
          </button>
          <button onClick={() => setViewMode('detail')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${viewMode === 'detail' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            Detail
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Summary tiles */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
              <div className="card p-3 bg-gray-50 text-center">
                <div className="text-xl font-bold font-mono text-gray-800">{inr(totalAmount)}</div>
                <div className="text-xs text-gray-500">Total Revenue</div>
              </div>
              <div className="card p-3 bg-green-50 text-center">
                <div className="text-xl font-bold font-mono text-green-700">{inr(totalHospital)}</div>
                <div className="text-xs text-green-600">Net to Hospital</div>
              </div>
              <div className="card p-3 bg-blue-50 text-center">
                <div className="text-xl font-bold font-mono text-blue-700">{inr(totalLab)}</div>
                <div className="text-xs text-blue-600">Net to Lab</div>
              </div>
              <div className="card p-3 bg-emerald-50 text-center">
                <div className="text-xl font-bold font-mono text-emerald-700">{inr(totalCash)}</div>
                <div className="text-xs text-emerald-600">Cash</div>
              </div>
              <div className="card p-3 bg-indigo-50 text-center">
                <div className="text-xl font-bold font-mono text-indigo-700">{inr(totalUpi)}</div>
                <div className="text-xs text-indigo-600">UPI</div>
              </div>
              <div className="card p-3 bg-purple-50 text-center">
                <div className="text-xl font-bold font-mono text-purple-700">{inr(totalCard)}</div>
                <div className="text-xs text-purple-600">Card</div>
              </div>
            </div>

            {/* SUMMARY VIEW */}
            {viewMode === 'summary' && (
              <div className="card p-5 mb-5">
                <h3 className="font-semibold text-gray-800 mb-4">Partner-wise Summary</h3>
                {partnerSummaries.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No lab reports in this month.</p>
                ) : (
                  <div className="space-y-3">
                    {partnerSummaries.map(ps => (
                      <div key={ps.name} className="border border-gray-100 rounded-xl p-4 flex items-center gap-4">
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">{ps.name}</div>
                          <div className="text-xs text-gray-500">{ps.count} report{ps.count !== 1 ? 's' : ''} · Total: {inr(ps.total)}</div>
                        </div>
                        <div className="text-center px-3">
                          <div className="text-sm font-bold text-green-700 font-mono">{inr(ps.hospital)}</div>
                          <div className="text-xs text-green-600">Hospital</div>
                        </div>
                        <div className="text-center px-3">
                          <div className="text-sm font-bold text-blue-700 font-mono">{inr(ps.lab)}</div>
                          <div className="text-xs text-blue-600">Lab Payable</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* DETAIL VIEW */}
            {viewMode === 'detail' && (
              <div className="card overflow-hidden">
                {filtered.length === 0 ? (
                  <div className="p-12 text-center text-gray-400">No lab reports found for this period.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        {['Date', 'Patient', 'Lab', 'Tests', 'Total', 'Hospital', 'Lab Share', 'Mode'].map(h => (
                          <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(r => (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-3 py-2.5 text-xs text-gray-500">{formatDate(r.report_date)}</td>
                          <td className="px-3 py-2.5 font-medium text-gray-800">{r.patient_name}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-600">{r.partner_name || r.lab_name || '—'}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-500">{r.entries.length}</td>
                          <td className="px-3 py-2.5 font-mono font-bold text-gray-900">{inr(r.total_amount)}</td>
                          <td className="px-3 py-2.5 font-mono text-green-700">{inr(r.hospital_amount)}</td>
                          <td className="px-3 py-2.5 font-mono text-blue-700">{inr(r.lab_amount)}</td>
                          <td className="px-3 py-2.5 text-xs capitalize">{r.payment_mode}</td>
                        </tr>
                      ))}
                      {/* Totals */}
                      <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                        <td colSpan={4} className="px-3 py-3 text-xs text-gray-600 text-right uppercase">Month Total</td>
                        <td className="px-3 py-3 font-mono text-gray-900">{inr(totalAmount)}</td>
                        <td className="px-3 py-3 font-mono text-green-700">{inr(totalHospital)}</td>
                        <td className="px-3 py-3 font-mono text-blue-700">{inr(totalLab)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Navigation link */}
            <div className="mt-5 text-center no-print">
              <Link href="/settings/lab-partners" className="text-xs text-indigo-600 hover:underline">
                Configure Lab Partners & Revenue Splits →
              </Link>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
