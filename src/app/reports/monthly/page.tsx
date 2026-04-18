'use client'
import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { getHospitalSettings } from '@/lib/utils'
import {
  TrendingUp, Printer, RefreshCw, ChevronLeft, ChevronRight,
  IndianRupee, Users, Stethoscope, BedDouble
} from 'lucide-react'

interface MonthDay {
  date:         string
  opd:          number
  ipd:          number
  cash:         number
  upi:          number
  card:         number
  total_revenue: number
  pending:      number
}

interface MonthSummary {
  year:          number
  month:         number
  days:          MonthDay[]
  total_opd:     number
  total_ipd:     number
  total_patients: number
  total_cash:    number
  total_upi:     number
  total_card:    number
  total_revenue: number
  total_pending: number
}

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']

// Exclude Sundays
function isSunday(dateStr: string) { return new Date(dateStr).getDay() === 0 }

export default function MonthlyReportPage() {
  const now    = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)  // 1-12
  const [data,  setData]  = useState<MonthSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  useEffect(() => { load() }, [year, month])

  async function load() {
    setLoading(true)

    const startDate = `${year}-${String(month).padStart(2,'0')}-01`
    const endDate   = new Date(year, month, 0).toISOString().split('T')[0]  // last day of month

    // All encounters in the month
    const { data: encs } = await supabase
      .from('encounters')
      .select('id, encounter_date, encounter_type')
      .gte('encounter_date', startDate)
      .lte('encounter_date', endDate)

    // All paid bills in the month
    const { data: bills } = await supabase
      .from('bills')
      .select('net_amount, payment_mode, status, created_at')
      .gte('created_at', startDate + 'T00:00:00')
      .lte('created_at', endDate + 'T23:59:59')

    // Build per-day breakdown
    const daysInMonth = new Date(year, month, 0).getDate()
    const dayMap: Record<string, MonthDay> = {}

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      if (isSunday(dateStr)) continue  // skip Sundays
      dayMap[dateStr] = { date: dateStr, opd: 0, ipd: 0, cash: 0, upi: 0, card: 0, total_revenue: 0, pending: 0 }
    }

    ;(encs || []).forEach((e: any) => {
      if (dayMap[e.encounter_date]) {
        if (e.encounter_type === 'IPD') dayMap[e.encounter_date].ipd++
        else                            dayMap[e.encounter_date].opd++
      }
    })

    ;(bills || []).forEach((b: any) => {
      const d = b.created_at.split('T')[0]
      if (!dayMap[d]) return
      const amt = Number(b.net_amount)
      if (b.status === 'paid') {
        if (b.payment_mode === 'cash')   dayMap[d].cash  += amt
        else if (b.payment_mode === 'upi')  dayMap[d].upi   += amt
        else if (b.payment_mode === 'card') dayMap[d].card  += amt
        dayMap[d].total_revenue += amt
      } else {
        dayMap[d].pending += amt
      }
    })

    const days = Object.values(dayMap).sort((a,b) => a.date.localeCompare(b.date))

    const summary: MonthSummary = {
      year, month, days,
      total_opd:      days.reduce((s,d) => s + d.opd, 0),
      total_ipd:      days.reduce((s,d) => s + d.ipd, 0),
      total_patients: days.reduce((s,d) => s + d.opd + d.ipd, 0),
      total_cash:     days.reduce((s,d) => s + d.cash, 0),
      total_upi:      days.reduce((s,d) => s + d.upi, 0),
      total_card:     days.reduce((s,d) => s + d.card, 0),
      total_revenue:  days.reduce((s,d) => s + d.total_revenue, 0),
      total_pending:  days.reduce((s,d) => s + d.pending, 0),
    }

    setData(summary)
    setLoading(false)
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y-1); setMonth(12) }
    else setMonth(m => m-1)
  }
  function nextMonth() {
    const todayYear  = new Date().getFullYear()
    const todayMonth = new Date().getMonth() + 1
    if (year > todayYear || (year === todayYear && month >= todayMonth)) return
    if (month === 12) { setYear(y => y+1); setMonth(1) }
    else setMonth(m => m+1)
  }
  const isCurrentMonth = year === new Date().getFullYear() && month === new Date().getMonth() + 1

  // Bar chart helper
  function Bar({ value, max }: { value: number; max: number }) {
    const pct = max > 0 ? Math.min(100, Math.round(value / max * 100)) : 0
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }}/>
        </div>
        <span className="text-xs text-gray-500 w-8 text-right tabular-nums">{value}</span>
      </div>
    )
  }

  return (
    <AppShell>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-blue-600"/> Monthly Report
            </h1>
            <p className="text-sm text-gray-500">Revenue and patient summary by month</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => window.print()}
              className="btn-secondary flex items-center gap-2 text-xs no-print">
              <Printer className="w-3.5 h-3.5"/> Print
            </button>
            <button onClick={load}
              className="btn-secondary flex items-center gap-2 text-xs no-print">
              <RefreshCw className="w-3.5 h-3.5"/> Refresh
            </button>
          </div>
        </div>

        {/* Month navigation */}
        <div className="card p-4 mb-5 flex items-center justify-between no-print">
          <button onClick={prevMonth}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            <ChevronLeft className="w-4 h-4 text-gray-600"/>
          </button>
          <div className="text-center">
            <div className="text-xl font-bold text-gray-900">
              {MONTH_NAMES[month-1]} {year}
            </div>
            <div className="text-xs text-gray-400">Sundays excluded</div>
          </div>
          <button onClick={nextMonth} disabled={isCurrentMonth}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
            <ChevronRight className="w-4 h-4 text-gray-600"/>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : data ? (
          <>
            {/* Print header */}
            <div className="print-only mb-6 text-center border-b-2 border-gray-800 pb-4">
              <div className="text-xl font-bold uppercase">{hs.hospitalName || 'NexMedicon Hospital'}</div>
              <div className="text-sm text-gray-600">{hs.address}</div>
              <div className="text-lg font-bold mt-2">Monthly Report — {MONTH_NAMES[month-1]} {year}</div>
            </div>

            {/* Summary tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
              {[
                { label:'Total Patients',  value: data.total_patients,  color:'text-blue-700   bg-blue-50',   icon: Users       },
                { label:'OPD Visits',      value: data.total_opd,       color:'text-indigo-700 bg-indigo-50', icon: Stethoscope },
                { label:'IPD Admissions',  value: data.total_ipd,       color:'text-purple-700 bg-purple-50', icon: BedDouble   },
                { label:'Total Revenue',   value:`₹${data.total_revenue.toLocaleString('en-IN')}`, color:'text-green-700 bg-green-50', icon: IndianRupee },
              ].map(({ label, value, color, icon: Icon }) => (
                <div key={label} className={`card p-4 ${color.split(' ')[1]}`}>
                  <div className={`text-2xl font-bold ${color.split(' ')[0]} mb-1`}>{value}</div>
                  <div className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                    <Icon className="w-3.5 h-3.5 opacity-60"/>{label}
                  </div>
                </div>
              ))}
            </div>

            {/* Revenue by mode */}
            <div className="card p-5 mb-5">
              <h2 className="section-title">Revenue by Payment Mode</h2>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label:'Cash',    value: data.total_cash,    cls:'bg-green-50  border-green-200  text-green-800'  },
                  { label:'UPI',     value: data.total_upi,     cls:'bg-blue-50   border-blue-200   text-blue-800'   },
                  { label:'Card',    value: data.total_card,    cls:'bg-purple-50 border-purple-200 text-purple-800' },
                  { label:'Pending', value: data.total_pending, cls:'bg-orange-50 border-orange-200 text-orange-800' },
                ].map(({ label, value, cls }) => (
                  <div key={label} className={`border rounded-xl p-4 text-center ${cls}`}>
                    <div className="text-xl font-bold font-mono">₹{value.toLocaleString('en-IN')}</div>
                    <div className="text-xs font-semibold mt-1">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Day-wise table */}
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Day-wise Breakdown</h2>
                <span className="text-xs text-gray-400">{data.days.filter(d=>d.opd+d.ipd>0).length} working days with activity</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['Date','Day','OPD','IPD','Cash','UPI','Card','Revenue','Pending'].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.days.map(day => {
                    const dayName = new Date(day.date).toLocaleDateString('en-IN', { weekday:'short' })
                    const hasActivity = day.opd + day.ipd + day.total_revenue > 0
                    return (
                      <tr key={day.date}
                        className={`border-b border-gray-50 ${hasActivity ? '' : 'opacity-40'}`}>
                        <td className="px-3 py-2 text-gray-700 font-medium text-xs">
                          {new Date(day.date).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}
                        </td>
                        <td className="px-3 py-2 text-gray-400 text-xs">{dayName}</td>
                        <td className="px-3 py-2">
                          {day.opd > 0 ? <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{day.opd}</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {day.ipd > 0 ? <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">{day.ipd}</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-green-700">{day.cash > 0 ? `₹${day.cash.toLocaleString('en-IN')}` : '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-blue-700">{day.upi  > 0 ? `₹${day.upi.toLocaleString('en-IN')}`  : '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-purple-700">{day.card > 0 ? `₹${day.card.toLocaleString('en-IN')}` : '—'}</td>
                        <td className="px-3 py-2 font-mono font-bold text-gray-900">
                          {day.total_revenue > 0 ? `₹${day.total_revenue.toLocaleString('en-IN')}` : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-orange-600">
                          {day.pending > 0 ? `₹${day.pending.toLocaleString('en-IN')}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                  {/* Totals */}
                  <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                    <td colSpan={2} className="px-3 py-2.5 text-xs text-gray-600 uppercase tracking-wide text-right">Month Total</td>
                    <td className="px-3 py-2.5 text-xs text-blue-700 font-bold">{data.total_opd}</td>
                    <td className="px-3 py-2.5 text-xs text-purple-700 font-bold">{data.total_ipd}</td>
                    <td className="px-3 py-2.5 font-mono text-green-700">₹{data.total_cash.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2.5 font-mono text-blue-700">₹{data.total_upi.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2.5 font-mono text-purple-700">₹{data.total_card.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2.5 font-mono text-gray-900">₹{data.total_revenue.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2.5 font-mono text-orange-600">₹{data.total_pending.toLocaleString('en-IN')}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Print footer */}
            <div className="print-only mt-6 pt-4 border-t text-center text-xs text-gray-500">
              Generated: {new Date().toLocaleString('en-IN')} · {hs.hospitalName}
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  )
}
