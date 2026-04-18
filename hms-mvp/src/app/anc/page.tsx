'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, calculateGA, getHospitalSettings } from '@/lib/utils'
import { Baby, AlertTriangle, Search, Calendar, Heart, Droplets, RefreshCw, Printer } from 'lucide-react'

interface ANCRecord {
  encounterId:    string
  patientId:      string
  patientName:    string
  mrn:            string
  age:            number
  mobile:         string
  encounterDate:  string
  lmp:            string
  edd:            string
  ga:             string
  gravida:        number
  para:           number
  fhs:            number | null
  liquor:         string
  presentation:   string
  fundal_height:  number | null
  risk:           'normal' | 'high' | 'watch'
  riskReasons:    string[]
  weeksToEDD:     number
}

function riskBadge(r: ANCRecord['risk']) {
  if (r === 'high')  return <span className="badge-red   text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3"/>High Risk</span>
  if (r === 'watch') return <span className="badge-yellow text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3"/>Watch</span>
  return <span className="badge-green text-xs">Normal</span>
}

function calcRisk(ob: any, age: number): { risk: ANCRecord['risk']; reasons: string[] } {
  const reasons: string[] = []
  if (age >= 35)                                  reasons.push('Advanced maternal age (≥35y)')
  if (ob.gravida >= 5)                            reasons.push('Grand multigravida (G5+)')
  if (ob.liquor === 'Reduced')                    reasons.push('Reduced liquor')
  if (ob.liquor === 'Absent')                     reasons.push('Absent liquor')
  if (ob.liquor === 'Increased')                  reasons.push('Polyhydramnios')
  if (ob.presentation === 'Breech')               reasons.push('Breech presentation')
  if (ob.presentation === 'Transverse')           reasons.push('Transverse lie')
  if (ob.fhs && (ob.fhs < 110 || ob.fhs > 160))  reasons.push(`Abnormal FHS (${ob.fhs} bpm)`)
  const risk: ANCRecord['risk'] = reasons.length >= 2 ? 'high' : reasons.length === 1 ? 'watch' : 'normal'
  return { risk, reasons }
}

export default function ANCPage() {
  const [records, setRecords] = useState<ANCRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [query,   setQuery]   = useState('')
  const [filter,  setFilter]  = useState<'all'|'high'|'watch'|'normal'|'due_soon'>('all')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)

    // Get all encounters that have ob_data with lmp set
    const { data: encs } = await supabase
      .from('encounters')
      .select('id, patient_id, encounter_date, ob_data, patients(full_name, mrn, age, mobile)')
      .not('ob_data', 'is', null)
      .order('encounter_date', { ascending: false })

    if (!encs) { setLoading(false); return }

    // Deduplicate: keep only the latest encounter per patient that has LMP
    const seen = new Set<string>()
    const rows: ANCRecord[] = []

    for (const e of encs) {
      const ob    = e.ob_data as any
      const pat   = e.patients as any
      if (!ob?.lmp || seen.has(e.patient_id)) continue
      seen.add(e.patient_id)

      const edd   = ob.edd || ''
      const ga    = calculateGA(ob.lmp)
      const weeksToEDD = edd
        ? Math.round((new Date(edd).getTime() - Date.now()) / (7 * 86400000))
        : 999
      const { risk, reasons } = calcRisk(ob, pat?.age || 0)

      rows.push({
        encounterId:   e.id,
        patientId:     e.patient_id,
        patientName:   pat?.full_name || '—',
        mrn:           pat?.mrn       || '—',
        age:           pat?.age       || 0,
        mobile:        pat?.mobile    || '—',
        encounterDate: e.encounter_date,
        lmp:           ob.lmp,
        edd,
        ga,
        gravida:       ob.gravida    || 0,
        para:          ob.para       || 0,
        fhs:           ob.fhs        || null,
        liquor:        ob.liquor     || '—',
        presentation:  ob.presentation || '—',
        fundal_height: ob.fundal_height || null,
        risk,
        riskReasons: reasons,
        weeksToEDD,
      })
    }

    // Sort: high risk first, then by EDD ascending
    rows.sort((a,b) => {
      const rOrder = { high:0, watch:1, normal:2 }
      if (rOrder[a.risk] !== rOrder[b.risk]) return rOrder[a.risk] - rOrder[b.risk]
      return a.weeksToEDD - b.weeksToEDD
    })

    setRecords(rows)
    setLoading(false)
  }

  const filtered = records.filter(r => {
    const q = query.toLowerCase()
    const matchQ = !q || r.patientName.toLowerCase().includes(q) || r.mrn.toLowerCase().includes(q) || r.mobile.includes(q)
    const matchF =
      filter === 'all'      ? true :
      filter === 'high'     ? r.risk === 'high' :
      filter === 'watch'    ? r.risk === 'watch' :
      filter === 'normal'   ? r.risk === 'normal' :
      filter === 'due_soon' ? r.weeksToEDD <= 4 && r.weeksToEDD >= 0 : true
    return matchQ && matchF
  })

  const counts = {
    all:      records.length,
    high:     records.filter(r=>r.risk==='high').length,
    watch:    records.filter(r=>r.risk==='watch').length,
    normal:   records.filter(r=>r.risk==='normal').length,
    due_soon: records.filter(r=>r.weeksToEDD<=4&&r.weeksToEDD>=0).length,
  }

  return (
    <AppShell>
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Baby className="w-6 h-6 text-pink-500"/> ANC Registry
            </h1>
            <p className="text-sm text-gray-500">All active antenatal patients — sorted by risk, then EDD</p>
          </div>
          <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2 text-xs no-print">
              <Printer className="w-3.5 h-3.5"/> Print List
            </button>
            <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-60">
            <RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`}/> Refresh
          </button>
        </div>

        {/* Summary pills */}
        <div className="flex gap-3 flex-wrap mb-5">
          {([
            { key:'all',      label:`All (${counts.all})`,           cls:'bg-gray-100 text-gray-700' },
            { key:'high',     label:`High Risk (${counts.high})`,    cls:'bg-red-100 text-red-700'   },
            { key:'watch',    label:`Watch (${counts.watch})`,       cls:'bg-yellow-100 text-yellow-700' },
            { key:'normal',   label:`Normal (${counts.normal})`,     cls:'bg-green-100 text-green-700' },
            { key:'due_soon', label:`Due ≤4 weeks (${counts.due_soon})`, cls:'bg-blue-100 text-blue-700' },
          ] as const).map(({key, label, cls}) => (
            <button key={key} onClick={() => setFilter(key as any)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${cls}
                ${filter === key ? 'ring-2 ring-offset-1 ring-blue-400' : 'opacity-70 hover:opacity-100'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="card p-4 mb-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
            <input className="input pl-9 bg-gray-50"
              placeholder="Search by name, MRN or mobile..."
              value={query} onChange={e=>setQuery(e.target.value)}/>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-pink-400 border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Baby className="w-12 h-12 mx-auto mb-3 opacity-20"/>
            <p className="font-medium">
              {records.length === 0
                ? 'No ANC patients yet. Enter LMP in OPD consultations to populate this registry.'
                : 'No patients match the current filter.'}
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Patient','G/P','Gestational Age','EDD / Weeks Left','FHS · Liquor','Presentation','Risk',''].map(h=>(
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.encounterId}
                    className={`border-b border-gray-50 hover:bg-gray-50 transition-colors
                      ${r.risk==='high'?'bg-red-50/40':r.risk==='watch'?'bg-yellow-50/30':''}`}>

                    {/* Patient */}
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{r.patientName}</div>
                      <div className="text-xs text-gray-400">{r.mrn} · {r.age}y · {r.mobile}</div>
                    </td>

                    {/* G/P */}
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                      G{r.gravida} P{r.para}
                    </td>

                    {/* GA */}
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-800 text-xs">{calculateGA(r.lmp)}</div>
                      <div className="text-xs text-gray-400">LMP: {formatDate(r.lmp)}</div>
                    </td>

                    {/* EDD */}
                    <td className="px-4 py-3">
                      {r.edd ? (
                        <>
                          <div className="font-medium text-gray-800 text-xs">{formatDate(r.edd)}</div>
                          <div className={`text-xs font-semibold mt-0.5 ${
                            r.weeksToEDD < 0 ? 'text-red-600' :
                            r.weeksToEDD <= 2 ? 'text-orange-600' :
                            r.weeksToEDD <= 4 ? 'text-yellow-600' : 'text-gray-400'
                          }`}>
                            {r.weeksToEDD < 0
                              ? `${Math.abs(r.weeksToEDD)}w overdue`
                              : r.weeksToEDD === 0 ? 'Due this week!'
                              : `${r.weeksToEDD}w to go`}
                          </div>
                        </>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>

                    {/* FHS + Liquor */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-xs">
                        {r.fhs
                          ? <span className={`flex items-center gap-0.5 font-semibold
                              ${r.fhs<110||r.fhs>160?'text-red-600':'text-green-700'}`}>
                              <Heart className="w-3 h-3"/>{r.fhs}
                            </span>
                          : <span className="text-gray-300">—</span>}
                      </div>
                      <div className={`text-xs mt-0.5 ${
                        r.liquor==='Reduced'||r.liquor==='Absent'?'text-red-600 font-semibold':
                        r.liquor==='Increased'?'text-orange-600 font-semibold':'text-gray-400'}`}>
                        <Droplets className="w-3 h-3 inline mr-0.5"/>{r.liquor}
                      </div>
                    </td>

                    {/* Presentation */}
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium
                        ${r.presentation==='Breech'||r.presentation==='Transverse'?'text-orange-600':'text-gray-600'}`}>
                        {r.presentation}
                      </span>
                      {r.fundal_height && (
                        <div className="text-xs text-gray-400 mt-0.5">FH: {r.fundal_height} cm</div>
                      )}
                    </td>

                    {/* Risk */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {riskBadge(r.risk)}
                        {r.riskReasons.slice(0,2).map(reason => (
                          <div key={reason} className="text-xs text-gray-500 leading-tight">{reason}</div>
                        ))}
                      </div>
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3">
                      <Link href={`/patients/${r.patientId}`}
                        className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
              {filtered.length} patient{filtered.length!==1?'s':''} shown
              {filter!=='all' && ` (filtered from ${records.length} total)`}
            </div>
          </div>
        )}
      </div>
      {/* Print-only ANC Registry */}
      <div className="print-only p-8">
        {(() => {
          const hs2 = typeof window !== 'undefined' ? getHospitalSettings() : {} as any
          return (
            <>
              <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
                <div className="text-xl font-bold uppercase">{hs2.hospitalName || 'NexMedicon Hospital'}</div>
                <div className="text-sm">{hs2.address}</div>
                <div className="text-lg font-bold mt-1">ANC Registry — {new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })}</div>
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    {['#','Patient','MRN','Age','LMP','EDD','GA','G/P','Risk','Reasons'].map(h => (
                      <th key={h} className="border border-gray-300 px-2 py-1 text-left font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={r.patientId} className={r.risk === 'high' ? 'bg-red-50' : r.risk === 'watch' ? 'bg-yellow-50' : ''}>
                      <td className="border border-gray-200 px-2 py-1">{i + 1}</td>
                      <td className="border border-gray-200 px-2 py-1 font-medium">{r.patientName}</td>
                      <td className="border border-gray-200 px-2 py-1 font-mono">{r.mrn}</td>
                      <td className="border border-gray-200 px-2 py-1">{r.age}y</td>
                      <td className="border border-gray-200 px-2 py-1">{formatDate(r.lmp)}</td>
                      <td className="border border-gray-200 px-2 py-1">{formatDate(r.edd)}</td>
                      <td className="border border-gray-200 px-2 py-1">{r.ga}</td>
                      <td className="border border-gray-200 px-2 py-1">{r.gravida !== undefined ? `G${r.gravida} P${r.para}` : '—'}</td>
                      <td className="border border-gray-200 px-2 py-1 font-semibold">
                        {r.risk === 'high' ? '🔴 HIGH' : r.risk === 'watch' ? '🟡 WATCH' : '🟢 Normal'}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">{r.riskReasons.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 text-xs text-gray-500 text-center">
                Total: {records.length} · High Risk: {records.filter(r=>r.risk==='high').length} · Watch: {records.filter(r=>r.risk==='watch').length} · Generated: {new Date().toLocaleString('en-IN')}
              </div>
            </>
          )
        })()}
      </div>
    </AppShell>
  )
}
