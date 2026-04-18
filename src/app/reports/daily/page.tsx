'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings } from '@/lib/utils'
import {
  IndianRupee, Calendar, Printer, RefreshCw,
  TrendingUp, Users, Stethoscope, BedDouble,
  ChevronLeft, ChevronRight, Download
} from 'lucide-react'

interface DailyPatient {
  patient_id:   string
  patient_name: string
  mrn:          string
  type:         'OPD' | 'IPD' | 'Other'
  encounter_id: string
  encounter_date: string
  diagnosis:    string
  bills:        { id:string; net_amount:number; payment_mode:string; status:string }[]
  total_paid:   number
}

interface DayStats {
  date:          string
  opd_count:     number
  ipd_count:     number
  total_patients: number
  cash_revenue:  number
  upi_revenue:   number
  card_revenue:  number
  pending:       number
  total_revenue: number
  patients:      DailyPatient[]
}

// Exclude Sundays from date navigation
function prevWorkday(dateStr: string): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - 1)
  if (d.getDay() === 0) d.setDate(d.getDate() - 1) // skip Sunday
  return d.toISOString().split('T')[0]
}
function nextWorkday(dateStr: string): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + 1)
  if (d.getDay() === 0) d.setDate(d.getDate() + 1) // skip Sunday
  return d.toISOString().split('T')[0]
}
function isSunday(dateStr: string): boolean {
  return new Date(dateStr).getDay() === 0
}
// Get today — skip back if Sunday
function getDefaultDate(): string {
  const today = new Date().toISOString().split('T')[0]
  return isSunday(today) ? prevWorkday(today) : today
}

export default function DailyReportPage() {
  const [date,    setDate]    = useState(getDefaultDate())
  const [stats,   setStats]   = useState<DayStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode,    setMode]    = useState<'day'|'range'>('day')
  const [rangeEnd,setRangeEnd]= useState(getDefaultDate())
  const [rangeStats, setRangeStats] = useState<DayStats[]>([])

  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  useEffect(() => { loadDay(date) }, [date])

  async function loadDay(d: string) {
    setLoading(true)

    // Encounters for the day
    const { data: encs } = await supabase
      .from('encounters')
      .select('id, patient_id, encounter_date, encounter_type, diagnosis, chief_complaint, patients(full_name, mrn)')
      .eq('encounter_date', d)
      .order('created_at', { ascending: true })

    if (!encs || encs.length === 0) {
      setStats({
        date: d, opd_count: 0, ipd_count: 0, total_patients: 0,
        cash_revenue: 0, upi_revenue: 0, card_revenue: 0, pending: 0,
        total_revenue: 0, patients: [],
      })
      setLoading(false)
      return
    }

    // Bills for the day
    const { data: bills } = await supabase
      .from('bills')
      .select('id, patient_id, net_amount, payment_mode, status, created_at')
      .gte('created_at', d + 'T00:00:00')
      .lte('created_at', d + 'T23:59:59')

    const billsByPatient: Record<string, typeof bills> = {}
    ;(bills ?? []).forEach((b: any) => {
      if (!billsByPatient[b.patient_id]) billsByPatient[b.patient_id] = []
      billsByPatient[b.patient_id]!.push(b)
    })

    const patients: DailyPatient[] = encs.map((enc: any) => {
      const pt = enc.patients ?? {}
      const pb = billsByPatient[enc.patient_id] ?? []
      const paidBills = pb.filter((b: any) => b.status === 'paid')
      return {
        patient_id:     enc.patient_id,
        patient_name:   pt.full_name ?? 'Unknown',
        mrn:            pt.mrn ?? '-',
        type:           (enc.encounter_type === 'IPD' ? 'IPD' : 'OPD') as 'OPD'|'IPD',
        encounter_id:   enc.id,
        encounter_date: enc.encounter_date,
        diagnosis:      enc.diagnosis ?? enc.chief_complaint ?? '-',
        bills:          pb.map((b: any) => ({
          id: b.id, net_amount: Number(b.net_amount),
          payment_mode: b.payment_mode ?? '-', status: b.status,
        })),
        total_paid: paidBills.reduce((s: number, b: any) => s + Number(b.net_amount), 0),
      }
    })

    const paidBills = (bills ?? []).filter((b: any) => b.status === 'paid')
    const cash_revenue = paidBills.filter((b:any)=>b.payment_mode==='cash').reduce((s:any,b:any)=>s+Number(b.net_amount),0)
    const upi_revenue  = paidBills.filter((b:any)=>b.payment_mode==='upi').reduce((s:any,b:any)=>s+Number(b.net_amount),0)
    const card_revenue = paidBills.filter((b:any)=>b.payment_mode==='card').reduce((s:any,b:any)=>s+Number(b.net_amount),0)
    const pending      = (bills??[]).filter((b:any)=>b.status==='pending').reduce((s:any,b:any)=>s+Number(b.net_amount),0)

    setStats({
      date: d,
      opd_count:     patients.filter(p => p.type === 'OPD').length,
      ipd_count:     patients.filter(p => p.type === 'IPD').length,
      total_patients: patients.length,
      cash_revenue, upi_revenue, card_revenue, pending,
      total_revenue: cash_revenue + upi_revenue + card_revenue,
      patients,
    })
    setLoading(false)
  }

  function changeDate(newDate: string) {
    if (isSunday(newDate)) return // don't navigate to Sunday
    if (newDate > new Date().toISOString().split('T')[0]) return
    setDate(newDate)
  }

  const today = getDefaultDate()
  const isToday = date === today

  return (
    <AppShell>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <IndianRupee className="w-6 h-6 text-green-600"/> Daily Patient Report
            </h1>
            <p className="text-sm text-gray-500">Revenue tracking and patient visit breakdown</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => window.print()}
              className="btn-secondary flex items-center gap-2 text-xs no-print">
              <Printer className="w-3.5 h-3.5"/> Print Report
            </button>
            <button onClick={() => loadDay(date)}
              className="btn-secondary flex items-center gap-2 text-xs no-print">
              <RefreshCw className="w-3.5 h-3.5"/> Refresh
            </button>
          </div>
        </div>

        {/* Date navigation */}
        <div className="card p-4 mb-5 flex items-center gap-3 no-print">
          <button onClick={() => changeDate(prevWorkday(date))}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-600"/>
          </button>
          <div className="flex-1 text-center">
            <input
              type="date"
              className="input w-48 text-center font-semibold"
              value={date}
              max={today}
              onChange={e => {
                if (!isSunday(e.target.value)) changeDate(e.target.value)
              }}
            />
            {isSunday(date) && (
              <p className="text-xs text-orange-600 mt-1">Sundays excluded — showing previous working day</p>
            )}
          </div>
          <button onClick={() => changeDate(nextWorkday(date))}
            disabled={date >= today}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40">
            <ChevronRight className="w-4 h-4 text-gray-600"/>
          </button>
          {!isToday && (
            <button onClick={() => changeDate(today)}
              className="text-xs text-blue-600 hover:underline font-medium">
              Today
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : stats ? (
          <>
            {/* Print header */}
            <div className="print-only mb-6 text-center border-b-2 border-gray-800 pb-4">
              <div className="text-xl font-bold uppercase">{hs.hospitalName || 'NexMedicon Hospital'}</div>
              <div className="text-sm text-gray-600">{hs.address}</div>
              <div className="text-lg font-bold mt-2">Daily Report — {formatDate(stats.date)}</div>
            </div>

            {/* Summary tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
              {[
                { label:'Total Patients',  value: stats.total_patients,  icon: Users,       color: 'bg-blue-50   text-blue-700'   },
                { label:'OPD Visits',      value: stats.opd_count,       icon: Stethoscope, color: 'bg-indigo-50 text-indigo-700' },
                { label:'IPD Admissions',  value: stats.ipd_count,       icon: BedDouble,   color: 'bg-purple-50 text-purple-700' },
                { label:"Today's Revenue", value:`₹${stats.total_revenue.toLocaleString('en-IN')}`, icon: IndianRupee, color: 'bg-green-50 text-green-700' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className={`card p-4 ${color.split(' ')[0]}`}>
                  <div className={`text-2xl font-bold ${color.split(' ')[1]} mb-1`}>{value}</div>
                  <div className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                    <Icon className="w-3.5 h-3.5 opacity-60"/>{label}
                  </div>
                </div>
              ))}
            </div>

            {/* Revenue breakdown */}
            <div className="card p-5 mb-5">
              <h2 className="section-title">Revenue Breakdown</h2>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label:'Cash',    value: stats.cash_revenue,  cls:'bg-green-50  border-green-200  text-green-800'  },
                  { label:'UPI',     value: stats.upi_revenue,   cls:'bg-blue-50   border-blue-200   text-blue-800'   },
                  { label:'Card',    value: stats.card_revenue,  cls:'bg-purple-50 border-purple-200 text-purple-800' },
                  { label:'Pending', value: stats.pending,       cls:'bg-orange-50 border-orange-200 text-orange-800' },
                ].map(({ label, value, cls }) => (
                  <div key={label} className={`border rounded-xl p-4 text-center ${cls}`}>
                    <div className="text-xl font-bold font-mono">₹{value.toLocaleString('en-IN')}</div>
                    <div className="text-xs font-semibold mt-1">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-patient table */}
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">
                  Patient-wise Details — {formatDate(stats.date)}
                </h2>
                <span className="text-xs text-gray-400">{stats.patients.length} patient{stats.patients.length !== 1 ? 's' : ''}</span>
              </div>
              {stats.patients.length === 0 ? (
                <div className="py-16 text-center text-gray-400">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-20"/>
                  <p>No patients recorded on this date</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['#','Patient','MRN','Type','Diagnosis','Bills','Cash','UPI','Card','Total Paid','Pending'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.patients.map((p, i) => {
                      const cash = p.bills.filter(b=>b.payment_mode==='cash'&&b.status==='paid').reduce((s,b)=>s+b.net_amount,0)
                      const upi  = p.bills.filter(b=>b.payment_mode==='upi'&&b.status==='paid').reduce((s,b)=>s+b.net_amount,0)
                      const card = p.bills.filter(b=>b.payment_mode==='card'&&b.status==='paid').reduce((s,b)=>s+b.net_amount,0)
                      const pend = p.bills.filter(b=>b.status==='pending').reduce((s,b)=>s+b.net_amount,0)
                      return (
                        <tr key={p.encounter_id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{i+1}</td>
                          <td className="px-4 py-2.5">
                            <Link href={`/patients/${p.patient_id}`}
                              className="font-semibold text-gray-900 hover:text-blue-600 hover:underline">
                              {p.patient_name}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{p.mrn}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              p.type === 'IPD' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                            }`}>{p.type}</span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 text-xs max-w-[140px] truncate">{p.diagnosis}</td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs text-center">{p.bills.length}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-green-700">{cash > 0 ? `₹${cash.toLocaleString('en-IN')}` : '—'}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-blue-700">{upi  > 0 ? `₹${upi.toLocaleString('en-IN')}` : '—'}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-purple-700">{card > 0 ? `₹${card.toLocaleString('en-IN')}` : '—'}</td>
                          <td className="px-4 py-2.5 font-mono font-bold text-gray-900">
                            {p.total_paid > 0 ? `₹${p.total_paid.toLocaleString('en-IN')}` : <span className="text-gray-300">₹0</span>}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-orange-600">
                            {pend > 0 ? `₹${pend.toLocaleString('en-IN')}` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                    {/* Totals row */}
                    <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                      <td colSpan={6} className="px-4 py-2.5 text-right text-xs text-gray-600 uppercase tracking-wide">Day Total</td>
                      <td className="px-4 py-2.5 font-mono text-green-700">₹{stats.cash_revenue.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2.5 font-mono text-blue-700">₹{stats.upi_revenue.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2.5 font-mono text-purple-700">₹{stats.card_revenue.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2.5 font-mono text-gray-900">₹{stats.total_revenue.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2.5 font-mono text-orange-600">₹{stats.pending.toLocaleString('en-IN')}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* Print footer */}
            <div className="print-only mt-6 pt-4 border-t border-gray-300 text-center text-xs text-gray-500">
              Generated: {new Date().toLocaleString('en-IN')} · {hs.hospitalName}
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  )
}
