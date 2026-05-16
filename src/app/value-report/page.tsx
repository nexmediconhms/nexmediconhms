'use client'
/**
 * src/app/value-report/page.tsx
 * Monthly Value Report — shows what NexMedicon saved/earned for the clinic
 */

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { formatCurrency } from '@/lib/business-logic'
import { RefreshCw, AlertCircle, Clock, Users, Bell, FileText, Receipt } from 'lucide-react'

interface Report {
  month:              string
  noshowsPrevented:   number
  noshowsValue:       number
  patientsRecalled:   number
  recallValue:        number
  unbilledCaught:     number
  unbilledValue:      number
  hoursSaved:         number
  totalValue:         number
  totalRevenue:       number
  metrics: {
    remindersSent:    number
    prescriptions:    number
    bills:            number
    totalEncounters:  number
  }
}

export default function ValueReportPage() {
  const thisMonth = new Date().toISOString().slice(0, 7)
  const [month,   setMonth]   = useState(thisMonth)
  const [report,  setReport]  = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function loadReport(m: string) {
    setLoading(true); setError('')
    try {
      const res  = await fetch(`/api/value-report?month=${m}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setReport(data)
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }

  useEffect(() => { loadReport(month) }, [month])

  const monthLabel = report
    ? new Date(report.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : ''

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Value Report</h1>
            <p className="text-sm text-gray-500">What NexMedicon saved & earned for you</p>
          </div>
          <button onClick={() => loadReport(month)}
            className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200">
            <RefreshCw className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* Month picker */}
        <div className="flex gap-3">
          <input
            type="month"
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={month}
            max={thisMonth}
            onChange={e => setMonth(e.target.value)}
          />
          <button onClick={() => loadReport(month)}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold">
            Generate
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl p-3 text-sm">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            {[1,2,3,4].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
          </div>
        ) : report && (
          <>
            {/* Big summary banner */}
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-5 text-white">
              <div className="text-sm font-semibold text-blue-200 mb-1">
                NexMedicon delivered in {monthLabel}
              </div>
              <div className="text-5xl font-black mb-1">
                {formatCurrency(report.totalValue)}
              </div>
              <div className="text-blue-200 text-sm">total value recovered + saved</div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/20 pt-4">
                <div>
                  <div className="text-2xl font-black">{report.hoursSaved}h</div>
                  <div className="text-xs text-blue-200">Staff time saved</div>
                </div>
                <div>
                  <div className="text-2xl font-black">{formatCurrency(report.totalRevenue)}</div>
                  <div className="text-xs text-blue-200">Total revenue collected</div>
                </div>
              </div>
            </div>

            {/* Value breakdown */}
            <div className="space-y-3">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Value Breakdown</h2>

              {[
                {
                  icon: Bell, title: 'No-shows Prevented', color: 'text-green-700 bg-green-50 border-green-200',
                  value: `${report.noshowsPrevented} patients`,
                  sub: `From ${report.metrics.remindersSent} reminders sent`,
                  earned: formatCurrency(report.noshowsValue),
                },
                {
                  icon: Users, title: 'Lapsed Patients Recalled', color: 'text-purple-700 bg-purple-50 border-purple-200',
                  value: `${report.patientsRecalled} patients`,
                  sub: 'Via campaigns and follow-ups',
                  earned: formatCurrency(report.recallValue),
                },
                {
                  icon: AlertCircle, title: 'Unbilled Visits Caught', color: 'text-orange-700 bg-orange-50 border-orange-200',
                  value: `${report.unbilledCaught} encounters`,
                  sub: 'Revenue leakage detected and stopped',
                  earned: formatCurrency(report.unbilledValue),
                },
                {
                  icon: Clock, title: 'Staff Hours Saved', color: 'text-blue-700 bg-blue-50 border-blue-200',
                  value: `${report.hoursSaved} hours`,
                  sub: 'Digital Rx, bills & automated reminders',
                  earned: `= ${Math.round(report.hoursSaved / 8)} working days`,
                },
              ].map(({ icon: Icon, title, color, value, sub, earned }) => (
                <div key={title} className={`border rounded-2xl p-4 ${color}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white/60 flex items-center justify-center">
                      <Icon className="w-4.5 h-4.5" />
                    </div>
                    <div className="flex-1">
                      <div className="text-lg font-black">{value}</div>
                      <div className="text-xs font-semibold opacity-80">{title}</div>
                      <div className="text-xs opacity-60 mt-0.5">{sub}</div>
                    </div>
                    <div className="text-sm font-black opacity-80 flex-shrink-0">{earned}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Activity metrics */}
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
              <h2 className="text-sm font-bold text-gray-700 mb-3">Activity This Month</h2>
              <div className="space-y-2">
                {[
                  { label: 'Reminders Sent',        value: report.metrics.remindersSent,   icon: Bell,      c: 'text-green-500'  },
                  { label: 'Prescriptions Written',  value: report.metrics.prescriptions,   icon: FileText,  c: 'text-blue-500'   },
                  { label: 'Bills Generated',        value: report.metrics.bills,           icon: Receipt,   c: 'text-purple-500' },
                  { label: 'Total Consultations',    value: report.metrics.totalEncounters, icon: Users,     c: 'text-teal-500'   },
                ].map(({ label, value, icon: Icon, c }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Icon className={`w-4 h-4 ${c}`} />
                      {label}
                    </div>
                    <span className="text-sm font-bold">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Copy report */}
            <button
              onClick={() => {
                const text =
                  `NexMedicon Value Report — ${monthLabel}\n` +
                  `✅ ${report.noshowsPrevented} no-shows prevented (${formatCurrency(report.noshowsValue)})\n` +
                  `✅ ${report.patientsRecalled} patients recalled (${formatCurrency(report.recallValue)})\n` +
                  `✅ ${report.unbilledCaught} unbilled visits caught (${formatCurrency(report.unbilledValue)})\n` +
                  `✅ ${report.hoursSaved} hours saved\n` +
                  `💰 Total revenue collected: ${formatCurrency(report.totalRevenue)}\n` +
                  `📈 Total value delivered: ${formatCurrency(report.totalValue)}`
                navigator.clipboard?.writeText(text).then(() => alert('Report copied!'))
              }}
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white
                         py-3 rounded-2xl font-bold text-sm"
            >
              📋 Copy Report to Share
            </button>
          </>
        )}
      </div>
    </AppShell>
  )
}