'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime, ageFromDOB } from '@/lib/utils'
import {
  Users, BedDouble, CalendarClock, Stethoscope,
  UserPlus, ArrowRight, Clock, Baby, AlertTriangle,
  TrendingUp, Activity, IndianRupee, CalendarDays
} from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState({
    patients: 0, todayOPD: 0, availableBeds: 0,
    overdueFollowUps: 0, ancHighRisk: 0, occupiedBeds: 0,
  })
  const [recentPatients,    setRecentPatients]    = useState<any[]>([])
  const [recentEncounters,  setRecentEncounters]  = useState<any[]>([])
  const [overdueList,       setOverdueList]       = useState<any[]>([])
  const [todayRevenue,      setTodayRevenue]      = useState(0)
  const [todayAppts,        setTodayAppts]        = useState(0)
  const [time,              setTime]              = useState(new Date())

  useEffect(() => {
    loadData()
    const t = setInterval(() => setTime(new Date()), 1000)
    // Load today's appointments count from Supabase
    const tod = new Date().toISOString().split('T')[0]
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('date', tod)
      .neq('status', 'cancelled')
      .then(({ count, error }) => {
        if (!error) setTodayAppts(count || 0)
      })
    return () => clearInterval(t)
  }, [])

  async function loadData() {
    const today   = new Date().toISOString().split('T')[0]  // used for both revenue query and OPD filter
    // Revenue today (from billing table)
    supabase.from('bills').select('net_amount,created_at').eq('status','paid')
      .gte('created_at', today + 'T00:00:00').then(({data}) => {
        const rev = (data||[]).reduce((s:number,b:any)=>s+Number(b.net_amount),0)
        setTodayRevenue(rev)
      })

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

    const [
      { count: pCount },
      { count: opdCount },
      { data: beds },
      { count: overdueCount },
      { data: overdueRows },
      { data: patients },
      { data: encounters },
      { data: ancRows },
    ] = await Promise.all([
      supabase.from('patients').select('*', { count:'exact', head:true }),
      supabase.from('encounters').select('*', { count:'exact', head:true }).eq('encounter_date', today),
      supabase.from('beds').select('status'),
      supabase.from('prescriptions').select('*', { count:'exact', head:true })
        .not('follow_up_date','is',null).lt('follow_up_date', today),
      supabase.from('prescriptions')
        .select('follow_up_date, patients(full_name, mrn)')
        .not('follow_up_date','is',null).lt('follow_up_date', today)
        .order('follow_up_date', { ascending:true }).limit(4),
      supabase.from('patients').select('*').order('created_at', { ascending:false }).limit(5),
      supabase.from('encounters').select('*, patients(full_name, mrn)')
        .order('created_at', { ascending:false }).limit(5),
      supabase.from('encounters').select('id, ob_data, patient_id')
        .not('ob_data','is',null).gte('encounter_date', weekAgo),
    ])

    // Count high-risk ANC
    let ancHighRisk = 0
    ;(ancRows || []).forEach((e: any) => {
      const ob = e.ob_data || {}
      if (!ob.lmp) return
      const flags = [
        ob.liquor === 'Reduced' || ob.liquor === 'Absent',
        ob.presentation === 'Breech' || ob.presentation === 'Transverse',
        ob.fhs && (ob.fhs < 110 || ob.fhs > 160),
      ].filter(Boolean).length
      if (flags >= 1) ancHighRisk++
    })

    const bedArr = beds || []
    setStats({
      patients:          pCount || 0,
      todayOPD:          opdCount || 0,
      availableBeds:     bedArr.filter((b:any) => b.status === 'available').length,
      occupiedBeds:      bedArr.filter((b:any) => b.status === 'occupied').length,
      overdueFollowUps:  overdueCount || 0,
      ancHighRisk,
    })
    setRecentPatients(patients || [])
    setRecentEncounters(encounters || [])
    setOverdueList(overdueRows || [])
  }

  const tiles = [
    { label:"Today's OPD",      value: stats.todayOPD,         sub:'consultations today',  icon:Stethoscope,  bg:'bg-blue-50',   ic:'bg-blue-100 text-blue-600',    val:'text-blue-700',   href:'/opd'      },
    { label:'Total Patients',   value: stats.patients,         sub:'registered patients',  icon:Users,        bg:'bg-green-50',  ic:'bg-green-100 text-green-600',   val:'text-green-700',  href:'/patients' },
    { label:'Beds Available',   value: stats.availableBeds,    sub:`${stats.occupiedBeds} occupied`, icon:BedDouble, bg:'bg-purple-50', ic:'bg-purple-100 text-purple-600', val:'text-purple-700', href:'/beds' },
    { label:'Overdue Follow-ups',value: stats.overdueFollowUps, sub:'require follow-up',   icon:CalendarClock,bg:'bg-orange-50', ic:'bg-orange-100 text-orange-600',  val:'text-orange-700', href:'/reports' },
    { label:"Today's Revenue",  value:`₹${todayRevenue.toLocaleString('en-IN')}`, sub:'payments collected today', icon:IndianRupee, bg:'bg-emerald-50', ic:'bg-emerald-100 text-emerald-600', val:'text-emerald-700', href:'/billing' },
    { label:'OPD Queue',        value: stats.todayOPD,         sub:'patients in queue today',icon:Clock,       bg:'bg-sky-50',    ic:'bg-sky-100 text-sky-600',       val:'text-sky-700',    href:'/queue'    },
    { label:"Today's Appointments",value: todayAppts,             sub:'scheduled today',        icon:CalendarDays,bg:'bg-violet-50', ic:'bg-violet-100 text-violet-600', val:'text-violet-700', href:'/appointments' },
  ]

  return (
    <AppShell>
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {time.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
              {' · '}{time.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/patients/new" className="btn-secondary flex items-center gap-2">
              <UserPlus className="w-4 h-4"/> Register Patient
            </Link>
            <Link href="/opd" className="btn-primary flex items-center gap-2">
              <Stethoscope className="w-4 h-4"/> New Consultation
            </Link>
          </div>
        </div>

        {/* Alert banners */}
        {stats.overdueFollowUps > 0 && (
          <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0"/>
            <span className="text-orange-800">
              <strong>{stats.overdueFollowUps}</strong> patient{stats.overdueFollowUps!==1?'s':''} have overdue follow-up appointments.
            </span>
            <Link href="/reports" className="ml-auto text-orange-600 hover:underline text-xs font-semibold flex-shrink-0">View list →</Link>
          </div>
        )}
        {stats.ancHighRisk > 0 && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
            <Baby className="w-4 h-4 text-red-500 flex-shrink-0"/>
            <span className="text-red-800">
              <strong>{stats.ancHighRisk}</strong> high-risk ANC patient{stats.ancHighRisk!==1?'s':''} flagged this week.
            </span>
            <Link href="/anc" className="ml-auto text-red-600 hover:underline text-xs font-semibold flex-shrink-0">Review →</Link>
          </div>
        )}

        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {tiles.map(({ label, value, sub, icon:Icon, bg, ic, val, href }) => (
            <Link key={label} href={href}
              className={`card p-5 ${bg} hover:shadow-md transition-shadow cursor-pointer`}>
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${ic}`}>
                  <Icon className="w-5 h-5"/>
                </div>
                <TrendingUp className="w-4 h-4 text-gray-300"/>
              </div>
              <div className={`text-3xl font-bold mb-1 ${val}`}>{value}</div>
              <div className="text-xs font-semibold text-gray-700">{label}</div>
              <div className="text-xs text-gray-400">{sub}</div>
            </Link>
          ))}
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-3 gap-5">

          {/* Recent patients */}
          <div className="col-span-2 card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Recent Patients</h2>
              <Link href="/patients" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3"/>
              </Link>
            </div>
            {recentPatients.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-40"/>
                <p className="text-sm">No patients registered yet</p>
                <Link href="/patients/new" className="text-blue-600 text-xs hover:underline mt-1 block">Register first patient →</Link>
              </div>
            ) : (
              <div className="space-y-1">
                {recentPatients.map(p => {
                  const age = ageFromDOB(p.date_of_birth) ?? p.age
                  return (
                    <Link key={p.id} href={`/patients/${p.id}`}
                      className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-semibold text-blue-700">{p.full_name.charAt(0)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{p.full_name}</div>
                        <div className="text-xs text-gray-400">{p.mrn} · {age}y · {p.gender}</div>
                      </div>
                      <div className="text-xs text-gray-400 flex items-center gap-1 flex-shrink-0">
                        <Clock className="w-3 h-3"/>
                        {formatDateTime(p.created_at).split(',')[0]}
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-4">

            {/* Quick actions */}
            <div className="card p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Quick Actions</h2>
              <div className="space-y-2">
                {[
                  { href:'/patients/new',  icon:UserPlus,    label:'Register New Patient',   hoverCls:'hover:border-blue-300   hover:bg-blue-50',    ic:'group-hover:text-blue-500',   tx:'group-hover:text-blue-700'   },
                  { href:'/opd',           icon:Stethoscope, label:'Start OPD Consultation', hoverCls:'hover:border-green-300  hover:bg-green-50',   ic:'group-hover:text-green-500',  tx:'group-hover:text-green-700'  },
                  { href:'/appointments',  icon:CalendarDays,label:'Book Appointment',        hoverCls:'hover:border-purple-300 hover:bg-purple-50',  ic:'group-hover:text-purple-500', tx:'group-hover:text-purple-700' },
                  { href:'/billing',       icon:IndianRupee, label:'Collect Payment',         hoverCls:'hover:border-emerald-300 hover:bg-emerald-50', ic:'group-hover:text-emerald-500',tx:'group-hover:text-emerald-700'},
                  { href:'/beds',         icon:BedDouble,   label:'View Bed Board',          hoverCls:'hover:border-purple-300 hover:bg-purple-50', ic:'group-hover:text-purple-500', tx:'group-hover:text-purple-700' },
                  { href:'/anc',          icon:Baby,        label:'ANC Registry',            hoverCls:'hover:border-pink-300   hover:bg-pink-50',   ic:'group-hover:text-pink-500',   tx:'group-hover:text-pink-700'   },
                ].map(({ href, icon:Icon, label, hoverCls, ic, tx }) => (
                  <Link key={href} href={href}
                    className={`flex items-center gap-3 p-3 rounded-lg border border-dashed border-gray-200 transition-all group ${hoverCls}`}>
                    <Icon className={`w-4 h-4 text-gray-400 ${ic}`}/>
                    <span className={`text-sm text-gray-600 ${tx}`}>{label}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Overdue follow-ups */}
            {overdueList.length > 0 && (
              <div className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-orange-500"/>
                    Overdue Follow-ups
                  </h2>
                  <Link href="/reports" className="text-xs text-orange-600 hover:underline">All</Link>
                </div>
                <div className="space-y-2">
                  {overdueList.map((f:any, i) => {
                    const days = Math.floor((Date.now()-new Date(f.follow_up_date).getTime())/86400000)
                    return (
                      <div key={i} className="p-2.5 rounded-lg bg-orange-50 border border-orange-100">
                        <div className="text-sm font-medium text-gray-800 truncate">
                          {(f.patients as any)?.full_name || '—'}
                        </div>
                        <div className="text-xs text-gray-500 flex items-center justify-between">
                          <span>{formatDate(f.follow_up_date)}</span>
                          <span className="text-orange-600 font-semibold">{days}d overdue</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Recent consultations */}
            {recentEncounters.length > 0 && (
              <div className="card p-5">
                <h2 className="font-semibold text-gray-900 mb-3">Recent Consultations</h2>
                <div className="space-y-2">
                  {recentEncounters.map(e => (
                    <Link key={e.id} href={`/opd/${e.id}`}
                      className="block p-2.5 rounded-lg bg-gray-50 hover:bg-blue-50 transition-colors">
                      <div className="text-sm font-medium text-gray-800 truncate">{e.patients?.full_name}</div>
                      <div className="text-xs text-gray-400">
                        {e.patients?.mrn} · {e.chief_complaint?.slice(0,28) || 'General consultation'}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
