'use client'
import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import {
  Users, Stethoscope, BedDouble, Calendar,
  TrendingUp, TrendingDown, Minus, AlertCircle,
  CheckCircle, Baby, RefreshCw
} from 'lucide-react'

// ── Horizontal bar ───────────────────────────────────────────
function Bar({ value, max, color = '#3b82f6' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width 0.4s ease' }} />
      </div>
      <span className="text-xs text-gray-500 w-6 text-right tabular-nums">{value}</span>
    </div>
  )
}

// ── KPI tile ─────────────────────────────────────────────────
function Tile({ label, value, sub, icon: Icon, color, trend }: {
  label: string; value: string | number; sub: string; icon: any
  color: 'blue'|'green'|'purple'|'orange'|'pink'|'teal'; trend?: 'up'|'down'|'flat'
}) {
  const bg = { blue:'bg-blue-50', green:'bg-green-50', purple:'bg-purple-50', orange:'bg-orange-50', pink:'bg-pink-50', teal:'bg-teal-50' }
  const ic = { blue:'text-blue-600', green:'text-green-600', purple:'text-purple-600', orange:'text-orange-600', pink:'text-pink-600', teal:'text-teal-600' }
  const vl = { blue:'text-blue-700', green:'text-green-700', purple:'text-purple-700', orange:'text-orange-700', pink:'text-pink-700', teal:'text-teal-700' }
  return (
    <div className={`card p-5 ${bg[color]}`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-white/70 ${ic[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend === 'up'   && <TrendingUp   className="w-4 h-4 text-green-500" />}
        {trend === 'down' && <TrendingDown  className="w-4 h-4 text-red-400" />}
        {trend === 'flat' && <Minus         className="w-4 h-4 text-gray-300" />}
      </div>
      <div className={`text-3xl font-bold mb-1 ${vl[color]}`}>{value}</div>
      <div className="text-xs font-semibold text-gray-700">{label}</div>
      <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
    </div>
  )
}

export default function ReportsPage() {
  const [loading,         setLoading]         = useState(true)
  const [todayRevenue,    setTodayRevenue]    = useState(0)
  const [weekRevenue,     setWeekRevenue]     = useState(0)
  const [monthRevenue,    setMonthRevenue]    = useState(0)

  const [totalPatients,    setTotalPatients]    = useState(0)
  const [todayOPD,         setTodayOPD]         = useState(0)
  const [weekOPD,          setWeekOPD]          = useState(0)
  const [monthOPD,         setMonthOPD]         = useState(0)
  const [availBeds,        setAvailBeds]        = useState(0)
  const [occupiedBeds,     setOccupiedBeds]     = useState(0)
  const [totalBeds,        setTotalBeds]        = useState(0)
  const [ancCount,         setAncCount]         = useState(0)
  const [overdueCount,     setOverdueCount]     = useState(0)
  const [opdByDay,         setOpdByDay]         = useState<{date:string;count:number}[]>([])
  const [topDx,            setTopDx]            = useState<{dx:string;count:number}[]>([])
  const [bloodGroups,      setBloodGroups]      = useState<{bg:string;count:number}[]>([])
  const [wardStats,        setWardStats]        = useState<{ward:string;total:number;occupied:number}[]>([])
  const [overdueList,      setOverdueList]      = useState<any[]>([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const now       = new Date()
    const todayStr  = now.toISOString().split('T')[0]
    const weekAgo   = new Date(now.getTime() -  7 * 86400000).toISOString().split('T')[0]
    const monthAgo  = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]

    // Load billing revenue
    const today2   = new Date().toISOString().split('T')[0]
    const weekAgo2 = new Date(Date.now() - 7*86400000).toISOString().split('T')[0]
    const mthAgo2  = new Date(Date.now() - 30*86400000).toISOString().split('T')[0]
    supabase.from('bills').select('net_amount,created_at').eq('status','paid').then(({data}) => {
      const bills = data || []
      setTodayRevenue(bills.filter((b:any)=>b.created_at>=today2+'T00:00:00').reduce((s:number,b:any)=>s+Number(b.net_amount),0))
      setWeekRevenue(bills.filter((b:any)=>b.created_at>=weekAgo2+'T00:00:00').reduce((s:number,b:any)=>s+Number(b.net_amount),0))
      setMonthRevenue(bills.filter((b:any)=>b.created_at>=mthAgo2+'T00:00:00').reduce((s:number,b:any)=>s+Number(b.net_amount),0))
    })

    await Promise.all([

      // patient total
      supabase.from('patients').select('*',{count:'exact',head:true})
        .then(({count}) => setTotalPatients(count||0)),

      // today's OPD
      supabase.from('encounters').select('*',{count:'exact',head:true})
        .eq('encounter_date', todayStr)
        .then(({count}) => setTodayOPD(count||0)),

      // week OPD
      supabase.from('encounters').select('*',{count:'exact',head:true})
        .gte('encounter_date', weekAgo)
        .then(({count}) => setWeekOPD(count||0)),

      // month OPD
      supabase.from('encounters').select('*',{count:'exact',head:true})
        .gte('encounter_date', monthAgo)
        .then(({count}) => setMonthOPD(count||0)),

      // beds
      supabase.from('beds').select('status, ward')
        .then(({data}) => {
          const beds = data || []
          setTotalBeds(beds.length)
          setAvailBeds(beds.filter(b=>b.status==='available').length)
          setOccupiedBeds(beds.filter(b=>b.status==='occupied').length)
          const map: Record<string,{total:number;occupied:number}> = {}
          beds.forEach(b => {
            if (!map[b.ward]) map[b.ward] = {total:0,occupied:0}
            map[b.ward].total++
            if (b.status==='occupied') map[b.ward].occupied++
          })
          setWardStats(Object.entries(map).map(([ward,s])=>({ward,...s})))
        }),

      // overdue follow-ups
      supabase.from('prescriptions')
        .select('follow_up_date, patient_id, patients(full_name, mrn)')
        .not('follow_up_date','is',null)
        .lt('follow_up_date', todayStr)
        .order('follow_up_date',{ascending:true})
        .limit(20)
        .then(({data}) => {
          setOverdueCount((data||[]).length)
          setOverdueList((data||[]).slice(0,8))
        }),

      // OPD by day (last 7)
      supabase.from('encounters').select('encounter_date')
        .gte('encounter_date', weekAgo)
        .then(({data}) => {
          const cnt: Record<string,number> = {}
          for (let i=6;i>=0;i--) {
            const d = new Date(now.getTime()-i*86400000).toISOString().split('T')[0]
            cnt[d] = 0
          }
          ;(data||[]).forEach((e:any)=>{ if (cnt[e.encounter_date]!==undefined) cnt[e.encounter_date]++ })
          setOpdByDay(Object.entries(cnt).map(([date,count])=>({date,count})))
        }),

      // top diagnoses last 30d
      supabase.from('encounters').select('diagnosis')
        .gte('encounter_date', monthAgo)
        .not('diagnosis','is',null)
        .then(({data}) => {
          const freq: Record<string,number> = {}
          ;(data||[]).forEach((e:any)=>{ if(e.diagnosis) freq[e.diagnosis.trim()]=(freq[e.diagnosis.trim()]||0)+1 })
          setTopDx(Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([dx,count])=>({dx,count})))
        }),

      // blood group distribution
      supabase.from('patients').select('blood_group').not('blood_group','is',null)
        .then(({data}) => {
          const freq: Record<string,number> = {}
          ;(data||[]).forEach((p:any)=>{ if(p.blood_group) freq[p.blood_group]=(freq[p.blood_group]||0)+1 })
          setBloodGroups(Object.entries(freq).sort((a,b)=>b[1]-a[1]).map(([bg,count])=>({bg,count})))
        }),

      // ANC count (encounters with ob_data containing lmp)
      supabase.from('encounters').select('id, ob_data')
        .not('ob_data','is',null)
        .then(({data}) => {
          const anc = (data||[]).filter((e:any)=>e.ob_data && e.ob_data.lmp)
          setAncCount(anc.length)
        }),
    ])
    setLoading(false)
  }

  const maxOPD   = Math.max(...opdByDay.map(d=>d.count), 1)
  const maxDx    = topDx[0]?.count  || 1
  const maxBG    = bloodGroups[0]?.count || 1
  const occPct   = totalBeds > 0 ? Math.round((occupiedBeds/totalBeds)*100) : 0
  // SVG donut: r=30, circumference = 2π×30 ≈ 188.5
  const CIRC     = 188.5
  const dashArr  = `${(occPct/100)*CIRC} ${CIRC}`

  function dayLabel(d: string) {
    return new Date(d).toLocaleDateString('en-IN',{weekday:'short'})
  }

  const bgColors: Record<string,string> = {
    'A+':'#ef4444','A-':'#f87171','B+':'#3b82f6','B-':'#60a5fa',
    'O+':'#22c55e','O-':'#4ade80','AB+':'#f59e0b','AB-':'#fbbf24',
  }

  return (
    <AppShell>
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
            <p className="text-sm text-gray-500">Live data — last updated {new Date().toLocaleTimeString('en-IN')}</p>
          </div>
          <button onClick={load} disabled={loading}
            className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-60">
            <RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`}/>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : (
          <div className="space-y-6">

            {/* ── KPI tiles ── */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
              <Tile label="Total Patients"  value={totalPatients}  sub="registered"        icon={Users}       color="blue"   trend="up"   />
              <Tile label="Today's OPD"     value={todayOPD}       sub="consultations"     icon={Stethoscope} color="green"  trend="flat" />
              <Tile label="This Week"       value={weekOPD}        sub="last 7 days"       icon={TrendingUp}  color="teal"              />
              <Tile label="This Month"      value={monthOPD}       sub="last 30 days"      icon={Calendar}    color="purple"            />
              <Tile label="Beds Available"  value={availBeds}      sub={`of ${totalBeds}`} icon={BedDouble}   color="orange"            />
              <Tile label="ANC Cases"       value={ancCount}       sub="antenatal records"  icon={Baby}        color="pink"              />
            </div>

            {/* ── OPD trend + Bed occupancy ── */}
            <div className="grid grid-cols-3 gap-5">

              {/* OPD bar chart */}
              <div className="col-span-2 card p-5">
                <h2 className="section-title">OPD Consultations — Last 7 Days</h2>
                {opdByDay.every(d=>d.count===0) ? (
                  <p className="text-sm text-gray-400 text-center py-8">No OPD encounters in the last 7 days.</p>
                ) : (
                  <div className="space-y-3 mt-2">
                    {opdByDay.map(d => (
                      <div key={d.date} className="flex items-center gap-3">
                        <span className="w-9 text-xs text-gray-400 font-medium text-right flex-shrink-0">{dayLabel(d.date)}</span>
                        <div className="flex-1 bg-gray-100 rounded-lg h-8 overflow-hidden relative">
                          {d.count > 0 && (
                            <div className="h-full bg-blue-500 rounded-lg flex items-center justify-end pr-2"
                              style={{width:`${Math.max((d.count/maxOPD)*100,8)}%`,transition:'width 0.4s ease'}}>
                              <span className="text-xs text-white font-semibold">{d.count}</span>
                            </div>
                          )}
                          {d.count === 0 && (
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-300">0</span>
                          )}
                        </div>
                        <span className="w-20 text-xs text-gray-400 flex-shrink-0">{formatDate(d.date)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bed occupancy */}
              <div className="card p-5">
                <h2 className="section-title">Bed Occupancy</h2>
                <div className="flex flex-col items-center mb-5">
                  <svg viewBox="0 0 80 80" className="w-28 h-28">
                    <circle cx="40" cy="40" r="30" fill="none" stroke="#f1f5f9" strokeWidth="11"/>
                    <circle cx="40" cy="40" r="30" fill="none"
                      stroke={occPct>85?'#ef4444':occPct>60?'#f59e0b':'#3b82f6'}
                      strokeWidth="11"
                      strokeDasharray={dashArr}
                      strokeDashoffset="47.1"
                      strokeLinecap="round"/>
                    <text x="40" y="37" textAnchor="middle" fontSize="15" fontWeight="800" fill="#1e293b">{occPct}%</text>
                    <text x="40" y="50" textAnchor="middle" fontSize="6.5" fill="#94a3b8">occupied</text>
                  </svg>
                  <div className="flex gap-4 text-xs mt-1 text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"/>Occ: {occupiedBeds}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-200 inline-block"/>Free: {availBeds}</span>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {wardStats.map(w => {
                    const pct = w.total > 0 ? w.occupied/w.total : 0
                    const col = pct > 0.8 ? '#ef4444' : pct > 0.5 ? '#f59e0b' : '#22c55e'
                    return (
                      <div key={w.ward}>
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span className="font-medium truncate pr-2">{w.ward}</span>
                          <span className="flex-shrink-0">{w.occupied}/{w.total}</span>
                        </div>
                        <Bar value={w.occupied} max={w.total} color={col}/>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ── Top Diagnoses + Blood Groups ── */}
            <div className="grid grid-cols-2 gap-5">

              <div className="card p-5">
                <h2 className="section-title">Top Diagnoses — Last 30 Days</h2>
                {topDx.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">
                    No diagnosis data yet. Enter diagnoses in OPD consultations.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {topDx.map((d,i) => (
                      <div key={d.dx}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-gray-700 truncate pr-2">{i+1}. {d.dx}</span>
                          <span className="text-gray-400 flex-shrink-0">{d.count}</span>
                        </div>
                        <Bar value={d.count} max={maxDx} color="#8b5cf6"/>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card p-5">
                <h2 className="section-title">Blood Group Distribution</h2>
                {bloodGroups.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No blood group data yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(bg => {
                      const count = bloodGroups.find(b=>b.bg===bg)?.count || 0
                      return (
                        <div key={bg}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-semibold" style={{color:bgColors[bg]}}>{bg}</span>
                            <span className="text-gray-400">{count}</span>
                          </div>
                          <Bar value={count} max={maxBG} color={bgColors[bg]}/>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Revenue Summary ── */}
        <div className="card p-5">
          <h2 className="section-title flex items-center gap-2">💰 Revenue Summary</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label:'Today',    value: todayRevenue  },
              { label:'This Week',value: weekRevenue   },
              { label:'30 Days',  value: monthRevenue  },
            ].map(({label,value}) => (
              <div key={label} className="bg-emerald-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-emerald-700">₹{value.toLocaleString('en-IN')}</div>
                <div className="text-xs text-gray-500 mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Overdue Follow-ups ── */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="w-4 h-4 text-orange-500"/>
                <h2 className="section-title mb-0">Overdue Follow-ups</h2>
                {overdueCount > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-100 text-orange-700 text-xs font-bold">
                    {overdueCount > 9 ? '9+' : overdueCount}
                  </span>
                )}
              </div>

              {overdueList.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-4 py-3">
                  <CheckCircle className="w-4 h-4"/> No overdue follow-ups — all patients are current.
                </div>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {['Patient','MRN','Follow-up Due','Days Overdue'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {overdueList.map((f:any, i) => {
                        const days = Math.floor((Date.now()-new Date(f.follow_up_date).getTime())/86400000)
                        return (
                          <tr key={i} className="border-b border-gray-50 hover:bg-orange-50 transition-colors">
                            <td className="py-2.5 px-3 font-medium text-gray-800">{(f.patients as any)?.full_name||'—'}</td>
                            <td className="py-2.5 px-3 font-mono text-xs text-gray-500">{(f.patients as any)?.mrn||'—'}</td>
                            <td className="py-2.5 px-3 text-gray-600">{formatDate(f.follow_up_date)}</td>
                            <td className="py-2.5 px-3">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                                ${days>14?'bg-red-100 text-red-700':days>7?'bg-yellow-100 text-yellow-700':'bg-gray-100 text-gray-600'}`}>
                                {days}d overdue
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {overdueCount > 8 && (
                    <p className="text-xs text-gray-400 px-3 pt-2">Showing 8 of {overdueCount} overdue follow-ups.</p>
                  )}
                </>
              )}
            </div>

          </div>
        )}
      </div>
    </AppShell>
  )
}
