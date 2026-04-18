'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings } from '@/lib/utils'
import {
  IndianRupee, Printer, RefreshCw, Download,
  Users, Stethoscope, BedDouble, TrendingUp, Search
} from 'lucide-react'

interface PatientPayment {
  patient_id:   string
  patient_name: string
  mrn:          string
  encounter_type: 'OPD' | 'IPD' | 'Other'
  bills:        { id:string; net_amount:number; payment_mode:string; status:string; created_at:string }[]
  total_paid:   number
  total_pending: number
  last_visit:   string
}

function getDefaultRange() {
  const end   = new Date().toISOString().split('T')[0]
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  return { start, end }
}

export default function PaymentReportPage() {
  const def = getDefaultRange()
  const [from,     setFrom]     = useState(def.start)
  const [to,       setTo]       = useState(def.end)
  const [typeFilter, setTypeFilter] = useState<'all'|'OPD'|'IPD'>('all')
  const [modeFilter, setModeFilter] = useState<'all'|'cash'|'upi'|'card'|'pending'>('all')
  const [search,   setSearch]   = useState('')
  const [rows,     setRows]     = useState<PatientPayment[]>([])
  const [loading,  setLoading]  = useState(true)

  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  useEffect(() => { load() }, [from, to])

  async function load() {
    setLoading(true)

    // All bills in date range
    const { data: bills } = await supabase
      .from('bills')
      .select('id, patient_id, patient_name, mrn, net_amount, payment_mode, status, created_at, encounter_type')
      .gte('created_at', from + 'T00:00:00')
      .lte('created_at', to   + 'T23:59:59')
      .order('created_at', { ascending: false })

    // All encounters in date range for type detection
    const { data: encs } = await supabase
      .from('encounters')
      .select('patient_id, encounter_type, encounter_date')
      .gte('encounter_date', from)
      .lte('encounter_date', to)

    const encTypeMap: Record<string, 'OPD'|'IPD'> = {}
    ;(encs || []).forEach((e: any) => {
      encTypeMap[e.patient_id] = e.encounter_type === 'IPD' ? 'IPD' : 'OPD'
    })

    // Group bills by patient
    const map: Record<string, PatientPayment> = {}
    ;(bills || []).forEach((b: any) => {
      const pid = b.patient_id
      if (!pid) return
      if (!map[pid]) {
        map[pid] = {
          patient_id:     pid,
          patient_name:   b.patient_name,
          mrn:            b.mrn,
          encounter_type: b.encounter_type || encTypeMap[pid] || 'OPD',
          bills:          [],
          total_paid:     0,
          total_pending:  0,
          last_visit:     b.created_at,
        }
      }
      map[pid].bills.push({
        id: b.id, net_amount: Number(b.net_amount),
        payment_mode: b.payment_mode, status: b.status, created_at: b.created_at,
      })
      if (b.status === 'paid')    map[pid].total_paid    += Number(b.net_amount)
      if (b.status === 'pending') map[pid].total_pending += Number(b.net_amount)
      if (b.created_at > map[pid].last_visit) map[pid].last_visit = b.created_at
    })

    setRows(Object.values(map).sort((a, b) => b.last_visit.localeCompare(a.last_visit)))
    setLoading(false)
  }

  // Apply filters
  const filtered = rows.filter(r => {
    if (typeFilter !== 'all' && r.encounter_type !== typeFilter) return false
    if (modeFilter !== 'all') {
      const hasModeOrPending = modeFilter === 'pending'
        ? r.total_pending > 0
        : r.bills.some(b => b.payment_mode === modeFilter && b.status === 'paid')
      if (!hasModeOrPending) return false
    }
    if (search) {
      const s = search.toLowerCase()
      if (!r.patient_name.toLowerCase().includes(s) && !r.mrn.toLowerCase().includes(s)) return false
    }
    return true
  })

  const totalRevenue = filtered.reduce((s, r) => s + r.total_paid, 0)
  const totalPending = filtered.reduce((s, r) => s + r.total_pending, 0)
  const opdRevenue   = filtered.filter(r => r.encounter_type === 'OPD').reduce((s, r) => s + r.total_paid, 0)
  const ipdRevenue   = filtered.filter(r => r.encounter_type === 'IPD').reduce((s, r) => s + r.total_paid, 0)

  const modeBadge: Record<string, string> = {
    cash:  'bg-green-100 text-green-700',
    upi:   'bg-blue-100 text-blue-700',
    card:  'bg-purple-100 text-purple-700',
    pending: 'bg-orange-100 text-orange-700',
  }

  return (
    <AppShell>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <IndianRupee className="w-6 h-6 text-green-600"/> Patient Payment Report
            </h1>
            <p className="text-sm text-gray-500">Payments per patient — OPD &amp; IPD breakdown</p>
          </div>
          <button onClick={() => window.print()}
            className="btn-secondary flex items-center gap-2 text-xs no-print">
            <Printer className="w-3.5 h-3.5"/> Print Report
          </button>
        </div>

        {/* Filters */}
        <div className="card p-4 mb-5 no-print">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="label">From</label>
              <input type="date" className="input w-36" value={from} max={to}
                onChange={e => setFrom(e.target.value)}/>
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" className="input w-36" value={to} min={from}
                max={new Date().toISOString().split('T')[0]}
                onChange={e => setTo(e.target.value)}/>
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input w-28" value={typeFilter}
                onChange={e => setTypeFilter(e.target.value as any)}>
                <option value="all">All</option>
                <option value="OPD">OPD</option>
                <option value="IPD">IPD</option>
              </select>
            </div>
            <div>
              <label className="label">Payment Mode</label>
              <select className="input w-28" value={modeFilter}
                onChange={e => setModeFilter(e.target.value as any)}>
                <option value="all">All</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div className="flex-1 min-w-40">
              <label className="label">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"/>
                <input className="input pl-8" placeholder="Name or MRN…"
                  value={search} onChange={e => setSearch(e.target.value)}/>
              </div>
            </div>
            <button onClick={load} className="btn-secondary flex items-center gap-1.5 text-xs">
              <RefreshCw className="w-3.5 h-3.5"/> Refresh
            </button>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[
            { label:'Total Patients', value: filtered.length,                              color:'text-gray-700   bg-gray-50',   icon: Users       },
            { label:'OPD Revenue',    value:`₹${opdRevenue.toLocaleString('en-IN')}`,      color:'text-blue-700  bg-blue-50',    icon: Stethoscope },
            { label:'IPD Revenue',    value:`₹${ipdRevenue.toLocaleString('en-IN')}`,      color:'text-purple-700 bg-purple-50', icon: BedDouble   },
            { label:'Total Revenue',  value:`₹${totalRevenue.toLocaleString('en-IN')}`,    color:'text-green-700 bg-green-50',   icon: IndianRupee },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} className={`card p-4 ${color.split(' ')[1]}`}>
              <div className={`text-2xl font-bold ${color.split(' ')[0]} mb-1`}>{value}</div>
              <div className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                <Icon className="w-3.5 h-3.5 opacity-50"/>{label}
              </div>
            </div>
          ))}
        </div>

        {/* Print header */}
        <div className="print-only mb-4 text-center border-b-2 border-gray-800 pb-3">
          <div className="text-xl font-bold uppercase">{hs.hospitalName || 'NexMedicon Hospital'}</div>
          <div className="text-sm">{hs.address}</div>
          <div className="text-lg font-bold mt-1">
            Patient Payment Report — {formatDate(from)} to {formatDate(to)}
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              Patient-wise Payments
              {totalPending > 0 && (
                <span className="ml-3 text-xs font-normal text-orange-600">
                  ⚠ ₹{totalPending.toLocaleString('en-IN')} pending
                </span>
              )}
            </h2>
            <span className="text-xs text-gray-400">{filtered.length} patient{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-7 h-7 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <IndianRupee className="w-10 h-10 mx-auto mb-3 opacity-20"/>
              <p>No payment records for this period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['#','Patient','MRN','Type','Bills','Payment Modes','Total Paid','Pending','Last Visit'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const paidBills = r.bills.filter(b => b.status === 'paid')
                    const modes = Array.from(new Set(paidBills.map(b => b.payment_mode).filter(Boolean)))
                    return (
                      <tr key={r.patient_id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-400 text-xs">{i+1}</td>
                        <td className="px-4 py-3">
                          <Link href={`/patients/${r.patient_id}`}
                            className="font-semibold text-gray-900 hover:text-blue-600 hover:underline">
                            {r.patient_name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.mrn}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            r.encounter_type === 'IPD' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                          }`}>{r.encounter_type}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 text-center">{r.bills.length}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {modes.map(m => (
                              <span key={m} className={`text-xs px-1.5 py-0.5 rounded font-medium capitalize ${modeBadge[m] || 'bg-gray-100 text-gray-600'}`}>
                                {m}
                              </span>
                            ))}
                            {r.total_pending > 0 && (
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-orange-100 text-orange-700">
                                pending
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-gray-900">
                          {r.total_paid > 0 ? `₹${r.total_paid.toLocaleString('en-IN')}` : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-orange-600">
                          {r.total_pending > 0 ? `₹${r.total_pending.toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">{formatDate(r.last_visit.split('T')[0])}</td>
                      </tr>
                    )
                  })}
                  {/* Totals */}
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                    <td colSpan={6} className="px-4 py-3 text-right text-xs text-gray-600 uppercase tracking-wide">
                      Total ({filtered.length} patients)
                    </td>
                    <td className="px-4 py-3 font-mono text-green-700">₹{totalRevenue.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 font-mono text-orange-600">₹{totalPending.toLocaleString('en-IN')}</td>
                    <td/>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Print footer */}
        <div className="print-only mt-6 pt-3 border-t text-center text-xs text-gray-500">
          Generated: {new Date().toLocaleString('en-IN')} · {hs.hospitalName}
        </div>
      </div>
    </AppShell>
  )
}
