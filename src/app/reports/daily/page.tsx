'use client'
/**
 * src/app/reports/daily/page.tsx — v33 FIXES
 *
 * FIXES:
 *  #18 — Daily report was showing PREVIOUS DAY data. Root cause: the
 *         `todayStr` comparison used `toDateString()` (locale-dependent)
 *         while encounter_date is stored as ISO 'YYYY-MM-DD'. Fixed by
 *         using getIndiaToday() and comparing ISO date strings directly.
 *  #18 — Print PDF header "Daily Patient Report Revenue tracking…" and
 *         footer URL removed. Clean print-only styles added.
 *  #19 — PDF layout improved: clean header, clear tables, hospital branding.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings, getIndiaToday } from '@/lib/utils'
import {
  IndianRupee, Calendar, Printer, RefreshCw,
  TrendingUp, Users, Stethoscope, BedDouble,
  ChevronLeft, ChevronRight,
} from 'lucide-react'


interface DailyPatient {
  patient_id:     string
  patient_name:   string
  mrn:            string
  type:           'OPD' | 'IPD' | 'Other'
  encounter_id:   string
  encounter_date: string
  diagnosis:      string
  bills:          { id:string; net_amount:number; payment_mode:string; status:string }[]
  total_paid:     number
}

interface DayStats {
  date:           string
  opd_count:      number
  ipd_count:      number
  total_patients: number
  cash_revenue:   number
  upi_revenue:    number
  card_revenue:   number
  pending:        number
  total_revenue:  number
  patients:       DailyPatient[]
}

function prevDay(dateStr: string): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}
function nextDay(dateStr: string): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

const INR = (n: number) => `₹${n.toLocaleString('en-IN')}`

export default function DailyReportPage() {
  // FIX #18: Use getIndiaToday() — IST-aware. Previously used getDefaultDate()
  // which skipped Sundays unnecessarily and could drift from IST.
  const today = getIndiaToday()
  const [date,    setDate]    = useState(today)
  const [stats,   setStats]   = useState<DayStats | null>(null)
  const [loading, setLoading] = useState(true)

  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  useEffect(() => { loadDay(date) }, [date])

  async function loadDay(d: string) {
    setLoading(true)

    // Load encounters for the date
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

    // Load bills for the date — FIX: Use IST offset for accurate date filtering
    const { data: bills } = await supabase
      .from('bills')
      .select('id, patient_id, net_amount, payment_mode, status, created_at')
      .gte('created_at', `${d}T00:00:00+05:30`)
      .lte('created_at', `${d}T23:59:59+05:30`)

    const billsByPatient: Record<string, typeof bills> = {}
    ;(bills ?? []).forEach((b: any) => {
      if (!billsByPatient[b.patient_id]) billsByPatient[b.patient_id] = []
      billsByPatient[b.patient_id]!.push(b)
    })

    const patients: DailyPatient[] = encs.map((enc: any) => {
      const pt  = enc.patients ?? {}
      const pb  = billsByPatient[enc.patient_id] ?? []
      const paidBills = pb.filter((b: any) => b.status === 'paid')
      return {
        patient_id:     enc.patient_id,
        patient_name:   pt.full_name ?? 'Unknown',
        mrn:            pt.mrn ?? '-',
        type:           (enc.encounter_type === 'IPD' ? 'IPD' : 'OPD') as 'OPD' | 'IPD',
        encounter_id:   enc.id,
        encounter_date: enc.encounter_date,
        diagnosis:      enc.diagnosis ?? enc.chief_complaint ?? '-',
        bills:          pb.map((b: any) => ({ id: b.id, net_amount: Number(b.net_amount), payment_mode: b.payment_mode ?? '-', status: b.status })),
        total_paid:     paidBills.reduce((s: number, b: any) => s + Number(b.net_amount), 0),
      }
    })

    const paidBills = (bills ?? []).filter((b: any) => b.status === 'paid')
    const cash = paidBills.filter((b: any) => b.payment_mode === 'cash').reduce((s: any, b: any) => s + Number(b.net_amount), 0)
    const upi  = paidBills.filter((b: any) => b.payment_mode === 'upi') .reduce((s: any, b: any) => s + Number(b.net_amount), 0)
    const card = paidBills.filter((b: any) => b.payment_mode === 'card').reduce((s: any, b: any) => s + Number(b.net_amount), 0)
    const pend = (bills ?? []).filter((b: any) => b.status === 'pending').reduce((s: any, b: any) => s + Number(b.net_amount), 0)

    setStats({
      date: d,
      opd_count:      patients.filter(p => p.type === 'OPD').length,
      ipd_count:      patients.filter(p => p.type === 'IPD').length,
      total_patients: patients.length,
      cash_revenue:   cash, upi_revenue: upi, card_revenue: card, pending: pend,
      total_revenue:  cash + upi + card,
      patients,
    })
    setLoading(false)
  }

  function changeDate(newDate: string) {
    if (newDate > today) return
    setDate(newDate)
  }

  const isToday = date === today
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <AppShell>
      {/* FIX #18/#19: Custom print styles — no header, no URL, clean layout */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: white !important; -webkit-print-color-adjust: exact; }
          /* Remove browser print header/footer */
          @page { margin: 10mm; size: A4; }
          /* Do NOT show URL in footer — handled by @page margin */
          header, footer, nav, aside { display: none !important; }
          main { margin: 0 !important; padding: 0 !important; width: 100% !important; }
          .card { box-shadow: none !important; border: 1px solid #e5e7eb !important; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="p-6">
        {/* Header — hidden on print */}
        <div className="no-print flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <IndianRupee className="w-6 h-6 text-green-600" /> Daily Patient Report
            </h1>
            <p className="text-sm text-gray-500">{dateLabel}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => {
              // Open clean print window without browser header/footer/URL
              const printContent = document.querySelector('.print-only')?.outerHTML || ''
              const pageContent = document.querySelector('.card')?.parentElement?.innerHTML || ''
              const w = window.open('', '_blank')
              if (w) {
                w.document.write(`<!DOCTYPE html><html><head><title>Daily Report</title>
                <style>
                  body { font-family: Inter, Arial, sans-serif; color: #1e293b; padding: 20px; margin: 0; }
                  @page { margin: 15mm; size: A4; }
                  .no-print { display: none !important; }
                  .print-only { display: block !important; }
                  .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 16px; }
                  table { width: 100%; border-collapse: collapse; font-size: 11px; }
                  th { background: #f8fafc; text-align: left; padding: 8px 12px; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; }
                  td { padding: 6px 12px; border-bottom: 1px solid #f1f5f9; }
                  .section-title { font-size: 14px; font-weight: 700; color: #1e293b; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0; margin-bottom: 12px; }
                  .grid { display: grid; gap: 12px; }
                  .grid-cols-4 { grid-template-columns: repeat(4, 1fr); }
                  .grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
                  .font-mono { font-family: monospace; }
                  .font-bold { font-weight: bold; }
                  .text-center { text-align: center; }
                </style></head><body>
                  <div style="text-align:center;border-bottom:3px solid #1d4ed8;padding-bottom:12px;margin-bottom:20px;">
                    <div style="font-size:20px;font-weight:700;">${hs.hospitalName || 'NexMedicon Hospital'}</div>
                    ${hs.address ? `<div style="font-size:11px;color:#555;margin-top:2px;">${hs.address}</div>` : ''}
                    ${hs.phone ? `<div style="font-size:11px;color:#555;">${hs.phone}</div>` : ''}
                    <div style="font-size:15px;font-weight:700;margin-top:10px;color:#1d4ed8;">Daily Report — ${dateLabel}</div>
                  </div>
                  ${pageContent}
                  <div style="margin-top:24px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between;">
                    <span>Generated: ${new Date().toLocaleString('en-IN')}</span>
                    <span>${hs.hospitalName || 'NexMedicon HMS'}</span>
                  </div>
                </body></html>`)
                w.document.close()
                setTimeout(() => w.print(), 500)
              }
            }}
              className="btn-secondary flex items-center gap-2 text-xs">
              <Printer className="w-3.5 h-3.5" /> Print Report
            </button>
            <button onClick={() => loadDay(date)}
              className="btn-secondary flex items-center gap-2 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </div>

        {/* Date navigation — hidden on print */}
        <div className="no-print card p-4 mb-5 flex items-center gap-3">
          <button onClick={() => changeDate(prevDay(date))}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <div className="flex-1 text-center">
            <input type="date" className="input w-48 text-center font-semibold"
              value={date} max={today}
              onChange={e => changeDate(e.target.value)} />
          </div>
          <button onClick={() => changeDate(nextDay(date))} disabled={isToday}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
          {!isToday && (
            <button onClick={() => setDate(today)} className="text-xs text-blue-600 hover:underline font-medium">
              Today
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : stats ? (
          <>
            {/* FIX #19: Clean print-only header — no generic title, just hospital name */}
            <div className="print-only mb-6 pb-4" style={{ borderBottom: '3px solid #1d4ed8' }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:20, fontWeight:700, color:'#111' }}>{hs.hospitalName || 'NexMedicon Hospital'}</div>
                {hs.address && <div style={{ fontSize:11, color:'#555', marginTop:2 }}>{hs.address}</div>}
                {hs.phone  && <div style={{ fontSize:11, color:'#555' }}>{hs.phone}</div>}
                <div style={{ fontSize:15, fontWeight:700, marginTop:10, color:'#1d4ed8' }}>
                  Daily Report — {dateLabel}
                </div>
              </div>
            </div>

            {/* Summary tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
              {[
                { label: 'Total Patients',  value: stats.total_patients,  icon: Users,       color: 'bg-blue-50   text-blue-700'   },
                { label: 'OPD Visits',      value: stats.opd_count,       icon: Stethoscope, color: 'bg-indigo-50 text-indigo-700' },
                { label: 'IPD Admissions',  value: stats.ipd_count,       icon: BedDouble,   color: 'bg-purple-50 text-purple-700' },
                { label: "Today's Revenue", value: INR(stats.total_revenue), icon: IndianRupee, color: 'bg-green-50 text-green-700' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className={`card p-4 ${color.split(' ')[0]}`}>
                  <div className={`text-2xl font-bold ${color.split(' ')[1]} mb-1`}>{value}</div>
                  <div className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                    <Icon className="w-3.5 h-3.5 opacity-60" />{label}
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
                    <div className="text-xl font-bold font-mono">{INR(value)}</div>
                    <div className="text-xs font-semibold mt-1">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-patient table */}
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">
                  Patient Details — {dateLabel}
                </h2>
                <span className="text-xs text-gray-400">{stats.patients.length} patient{stats.patients.length !== 1 ? 's' : ''}</span>
              </div>
              {stats.patients.length === 0 ? (
                <div className="py-16 text-center text-gray-400">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p>No patients recorded on this date</p>
                  {isToday && <p className="text-sm mt-1 text-gray-400">Patients will appear here after consultations are saved.</p>}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['#','Patient','MRN','Type','Diagnosis','Cash','UPI','Card','Total','Pending'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.patients.map((p, i) => {
                      const cash = p.bills.filter(b => b.payment_mode === 'cash' && b.status === 'paid').reduce((s, b) => s + b.net_amount, 0)
                      const upi  = p.bills.filter(b => b.payment_mode === 'upi'  && b.status === 'paid').reduce((s, b) => s + b.net_amount, 0)
                      const card = p.bills.filter(b => b.payment_mode === 'card' && b.status === 'paid').reduce((s, b) => s + b.net_amount, 0)
                      const pend = p.bills.filter(b => b.status === 'pending').reduce((s, b) => s + b.net_amount, 0)
                      return (
                        <tr key={p.encounter_id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{i+1}</td>
                          <td className="px-4 py-2.5">
                            <Link href={`/patients/${p.patient_id}`}
                              className="font-semibold text-gray-900 hover:text-blue-600 hover:underline no-print">
                              {p.patient_name}
                            </Link>
                            <span className="print-only font-semibold">{p.patient_name}</span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{p.mrn}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.type === 'IPD' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                              {p.type}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 text-xs max-w-[140px] truncate">{p.diagnosis}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-green-700">{cash > 0 ? INR(cash) : '—'}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-blue-700">{upi  > 0 ? INR(upi)  : '—'}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-purple-700">{card > 0 ? INR(card) : '—'}</td>
                          <td className="px-4 py-2.5 font-mono font-bold text-gray-900">
                            {p.total_paid > 0 ? INR(p.total_paid) : <span className="text-gray-300">₹0</span>}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-orange-600">{pend > 0 ? INR(pend) : '—'}</td>
                        </tr>
                      )
                    })}
                    {/* Totals row */}
                    <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                      <td colSpan={5} className="px-4 py-2.5 text-right text-xs text-gray-600 uppercase tracking-wide">Day Total</td>
                      <td className="px-4 py-2.5 font-mono text-green-700">{INR(stats.cash_revenue)}</td>
                      <td className="px-4 py-2.5 font-mono text-blue-700">{INR(stats.upi_revenue)}</td>
                      <td className="px-4 py-2.5 font-mono text-purple-700">{INR(stats.card_revenue)}</td>
                      <td className="px-4 py-2.5 font-mono text-gray-900">{INR(stats.total_revenue)}</td>
                      <td className="px-4 py-2.5 font-mono text-orange-600">{INR(stats.pending)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* FIX #19: Clean print footer — no URL, no generic text */}
            <div className="print-only" style={{ marginTop: 24, paddingTop: 12, borderTop: '1px solid #e5e7eb', textAlign: 'center', fontSize: 10, color: '#9ca3af' }}>
              Generated: {new Date().toLocaleString('en-IN')} · Confidential — {hs.hospitalName}
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  )
}