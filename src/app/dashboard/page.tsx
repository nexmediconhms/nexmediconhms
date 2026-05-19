'use client'
/**
 * src/app/dashboard/page.tsx
 *
 * Revenue-first dashboard using your ACTUAL schema:
 * - encounters.encounter_date  (renamed by v30 migration)
 * - encounters.patientid       (lowercase)
 * - bills: total, paid, due    (NOT net_amount/gross_amount)
 *
 * HOW TO USE:
 * Replace your existing src/app/dashboard/page.tsx with this file.
 * That's it — no other changes needed.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatCurrency, todayIST, tomorrowIST, daysFromNowIST } from '@/lib/business-logic'
import {
  IndianRupee, AlertCircle, Clock, Users,
  Calendar, RefreshCw, Bed, FileText,
  TrendingUp, BarChart2, Target, Zap, ChevronRight,
  Stethoscope, CheckCircle,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────

interface DashData {
  todayRevenue:      number
  todayTarget:       number
  weekRevenue:       number
  pendingBillsCount: number
  pendingBillsAmt:   number
  todayAppts:        number
  unconfirmedAppts:  number
  todayPatients:     number
  bedsAvailable:     number
  bedsOccupied:      number
  unbilledToday:     number
  followUpsToday:    number
}

interface ActionItem {
  id:       string
  type:     'urgent' | 'billing' | 'appointment' | 'info'
  emoji:    string
  title:    string
  sub:      string
  value?:   string
  href?:    string
}

// ── KPI Card ──────────────────────────────────────────────────

function TodayRevenueCard({
  data,
  loading,
}: {
  data:    DashData
  loading: boolean
}) {
  const pct = data.todayTarget > 0
    ? Math.min(Math.round((data.todayRevenue / data.todayTarget) * 100), 100)
    : 0

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br
                    from-blue-600 via-blue-700 to-indigo-800 p-5 text-white shadow-xl">
      {/* Decorative circles */}
      <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
      <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full bg-white/5" />

      <div className="relative">
        {/* Label */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <IndianRupee className="w-4 h-4 text-blue-200" />
            <span className="text-sm font-semibold text-blue-200">Today's Revenue</span>
          </div>
          <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
            {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
          </span>
        </div>

        {/* Main number */}
        {loading ? (
          <div className="h-12 bg-white/20 rounded-xl animate-pulse mb-3" />
        ) : (
          <>
            <div className="text-4xl font-black mb-1">{formatCurrency(data.todayRevenue)}</div>

            {/* Progress toward daily target */}
            {data.todayTarget > 0 && (
              <div className="mb-3">
                <div className="flex justify-between text-xs text-blue-200 mb-1">
                  <span>Target: {formatCurrency(data.todayTarget)}</span>
                  <span className="font-bold">{pct}%</span>
                </div>
                <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {/* 3-stat strip */}
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/20">
              <div className="text-center">
                <div className="text-xl font-bold">{data.todayAppts}</div>
                <div className="text-xs text-blue-200">Appts</div>
              </div>
              <div className="text-center border-x border-white/20">
                <div className="text-xl font-bold">{data.todayPatients}</div>
                <div className="text-xs text-blue-200">Seen</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold">{data.pendingBillsCount}</div>
                <div className="text-xs text-blue-200">Pending</div>
              </div>
            </div>

            {/* Alert: unconfirmed appointments */}
            {data.unconfirmedAppts > 0 && (
              <div className="mt-3 flex items-center gap-2 bg-amber-400/25 rounded-xl px-3 py-2">
                <AlertCircle className="w-4 h-4 text-amber-300 flex-shrink-0" />
                <p className="text-xs text-amber-100 font-medium">
                  {data.unconfirmedAppts} unconfirmed — ≈{formatCurrency(data.unconfirmedAppts * 500)} at risk
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Revenue Pillar Card ───────────────────────────────────────

function PillarCard({
  icon: Icon, title, value, sub, className, onClick,
}: {
  icon:      any
  title:     string
  value:     string
  sub:       string
  className: string
  onClick?:  () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 min-w-0 rounded-2xl p-4 text-left border
                  transition-all hover:scale-[1.02] hover:shadow-md ${className}`}
    >
      <Icon className="w-5 h-5 mb-2 opacity-70" />
      <div className="text-xl font-black">{value}</div>
      <div className="text-xs font-bold mt-0.5 leading-snug">{title}</div>
      <div className="text-[11px] opacity-60 mt-0.5 leading-tight">{sub}</div>
    </button>
  )
}

// ── Action Feed Item ──────────────────────────────────────────

function ActionItem({ item, onClick }: { item: ActionItem; onClick?: () => void }) {
  const BG: Record<string, string> = {
    urgent:      'bg-red-50 border-red-200',
    billing:     'bg-orange-50 border-orange-200',
    appointment: 'bg-blue-50 border-blue-200',
    info:        'bg-gray-50 border-gray-200',
  }

  return (
    <div
      className={`flex items-center gap-3 border rounded-xl p-3 cursor-pointer
                  transition-all hover:shadow-sm hover:scale-[1.01] ${BG[item.type]}`}
      onClick={onClick}
    >
      <span className="text-xl flex-shrink-0">{item.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">{item.title}</div>
        <div className="text-xs text-gray-500 truncate">{item.sub}</div>
      </div>
      {item.value && (
        <div className="text-sm font-bold text-gray-800 flex-shrink-0">{item.value}</div>
      )}
      {onClick && <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

// ── Next OPD Patient Widget ───────────────────────────────────
function NextOPDPatientCard() {
  const [nextPatient, setNextPatient] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function loadNext() {
      const today = todayIST()
      const nowTime = new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
      })

      // Get the next appointment that hasn't been completed yet
      const { data } = await supabase
        .from('appointments')
        .select('id, patient_id, patient_name, mrn, mobile, date, time, type, status, notes')
        .eq('date', today)
        .neq('status', 'cancelled')
        .neq('status', 'completed')
        .order('time', { ascending: true })
        .limit(5)

      if (data && data.length > 0) {
        // Find the next upcoming (time >= now) or the first unfinished one
        const upcoming = data.find(a => (a.time || '00:00') >= nowTime) || data[0]
        setNextPatient(upcoming)
      }
      setLoading(false)
    }
    loadNext()
    const interval = setInterval(loadNext, 60000) // refresh every minute
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 rounded-2xl p-4 animate-pulse">
        <div className="h-16 bg-purple-100/50 rounded-xl" />
      </div>
    )
  }

  if (!nextPatient) {
    return (
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span className="text-sm font-bold text-green-700">All Patients Seen</span>
        </div>
        <p className="text-xs text-green-600">No more OPD patients waiting today.</p>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
            <Stethoscope className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-xs font-bold text-purple-600 uppercase tracking-wide">Next Patient</span>
            <div className="text-sm font-bold text-gray-900">{nextPatient.patient_name}</div>
          </div>
        </div>
        <span className="text-xs font-mono bg-white/70 text-purple-700 px-2 py-1 rounded-lg border border-purple-200">
          {nextPatient.time || '—'}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-600 mb-2">
        <span className="font-mono">{nextPatient.mrn}</span>
        <span>·</span>
        <span>{nextPatient.type || 'OPD'}</span>
        {nextPatient.mobile && (
          <>
            <span>·</span>
            <span className="font-mono">{nextPatient.mobile}</span>
          </>
        )}
      </div>
      {nextPatient.notes && (
        <div className="text-xs text-gray-500 bg-white/50 rounded-lg px-2 py-1 mb-2 truncate">
          📝 {nextPatient.notes}
        </div>
      )}
      <button
        onClick={() => router.push(`/patients/${nextPatient.patient_id}`)}
        className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-2 px-3 rounded-xl transition-colors"
      >
        <Stethoscope className="w-3.5 h-3.5" /> Start Consultation
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Doctor Alerts Section (Abnormal lab values) ───────────────
function DoctorAlertsSection() {
  const [alerts, setAlerts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadAlerts() {
      const { data } = await supabase
        .from('doctor_alerts')
        .select('*')
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(10)
      setAlerts(data || [])
      setLoading(false)
    }
    loadAlerts()
  }, [])

  async function markRead(id: string) {
    await supabase.from('doctor_alerts').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id)
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  if (loading || alerts.length === 0) return null

  return (
    <div>
      <h2 className="text-xs font-bold text-red-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <AlertCircle className="w-3.5 h-3.5" /> Lab Alerts — Abnormal Values
      </h2>
      <div className="space-y-2">
        {alerts.map(alert => {
          const alertData = alert.alert_data || {}
          const abnormals = alertData.abnormal_values || []
          return (
            <div key={alert.id} className={`bg-white border rounded-xl p-4 ${
              alert.severity === 'critical' ? 'border-red-300 bg-red-50/30' : 'border-orange-200 bg-orange-50/30'
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      alert.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                    }`}>
                      {alert.severity === 'critical' ? '🚨 CRITICAL' : '⚠️ WARNING'}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">{alert.patient_name}</span>
                    <span className="text-xs text-gray-400">{alert.mrn}</span>
                  </div>
                  <div className="text-xs text-gray-600 mb-1">
                    {alertData.report_name} {alertData.lab_partner ? `· Lab: ${alertData.lab_partner}` : ''}
                  </div>
                  {abnormals.length > 0 && (
                    <ul className="space-y-0.5">
                      {abnormals.slice(0, 3).map((v: string, i: number) => (
                        <li key={i} className="text-xs text-red-700 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                          {v}
                        </li>
                      ))}
                      {abnormals.length > 3 && (
                        <li className="text-xs text-gray-500">+{abnormals.length - 3} more</li>
                      )}
                    </ul>
                  )}
                </div>
                <button onClick={() => markRead(alert.id)}
                  className="text-xs text-gray-400 hover:text-green-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-green-50">
                  <CheckCircle className="w-3.5 h-3.5" /> Done
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [data,    setData]    = useState<DashData>({
    todayRevenue: 0, todayTarget: 0, weekRevenue: 0,
    pendingBillsCount: 0, pendingBillsAmt: 0,
    todayAppts: 0, unconfirmedAppts: 0, todayPatients: 0,
    bedsAvailable: 0, bedsOccupied: 0, unbilledToday: 0, followUpsToday: 0,
  })
  const [actions,  setActions]  = useState<ActionItem[]>([])
  const [loading,  setLoading]  = useState(true)
  const [lastTime, setLastTime] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const today  = todayIST()
    const weekAgo = daysFromNowIST(-7)

    try {
      await Promise.all([
        loadRevenue(today, weekAgo),
        loadAppointments(today),
        loadBeds(),
        loadUnbilled(today),
        loadFollowUps(today),
      ])
    } catch (e) {
      console.error('[dashboard] load error:', e)
    }

    setLastTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5 * 60 * 1000)  // refresh every 5 min
    return () => clearInterval(interval)
  }, [load])

  // ── Data loaders ────────────────────────────────────────────

  async function loadRevenue(today: string, weekAgo: string) {
    const [todayBills, weekBills, targetSetting] = await Promise.all([
      supabase.from('bills')
        .select('total, paid, due, status')
        .gte('createdat', today + 'T00:00:00')
        .lte('createdat', today + 'T23:59:59'),

      supabase.from('bill_payments')
        .select('amount')
        .gte('createdat', weekAgo + 'T00:00:00'),

      supabase.from('clinicsettings')
        .select('value')
        .eq('key', 'daily_revenue_target')
        .single(),
    ])

    const bills        = todayBills.data || []
    const todayRevenue = bills.reduce((s, b) => s + Number(b.paid || 0), 0)
    const pending      = bills.filter(b => b.status !== 'paid')
    const weekRevenue  = (weekBills.data || []).reduce((s, p) => s + Number(p.amount || 0), 0)

    setData(d => ({
      ...d,
      todayRevenue,
      weekRevenue,
      todayTarget:       Number(targetSetting.data?.value || 0),
      pendingBillsCount: pending.length,
      pendingBillsAmt:   pending.reduce((s, b) => s + Number(b.due || 0), 0),
    }))

    // Billing actions
    const newActions: ActionItem[] = []
    if (pending.length > 0) {
      const totalDue = pending.reduce((s, b) => s + Number(b.due || 0), 0)
      newActions.push({
        id:    'pending-bills',
        type:  'billing',
        emoji: '💰',
        title: `${pending.length} patients left without paying today`,
        sub:   'Collect before closing',
        value: formatCurrency(totalDue),
        href:  '/billing',
      })
    }
    setActions(prev => [
      ...prev.filter(a => a.id !== 'pending-bills'),
      ...newActions,
    ])
  }

  async function loadAppointments(today: string) {
    const [appts, seen] = await Promise.all([
      // Use appointments.date (appointments table has 'date' column — correct)
      supabase.from('appointments')
        .select('id, status')
        .eq('date', today)
        .neq('status', 'cancelled'),

      // Use encounters.encounter_date (renamed by v30 migration from 'date')
      supabase.from('encounters')
        .select('id')
        .eq('encounter_date', today),
    ])

    const all         = appts.data || []
    const confirmed   = all.filter(a => a.status === 'confirmed').length
    const unconfirmed = all.filter(a => a.status === 'scheduled' || !a.status).length

    setData(d => ({
      ...d,
      todayAppts:      all.length,
      unconfirmedAppts: unconfirmed,
      todayPatients:   (seen.data || []).length,
    }))

    if (unconfirmed > 0) {
      setActions(prev => [
        ...prev.filter(a => a.id !== 'unconfirmed'),
        {
          id:    'unconfirmed',
          type:  'appointment',
          emoji: '📅',
          title: `${unconfirmed} appointment${unconfirmed > 1 ? 's' : ''} not confirmed today`,
          sub:   'Call to confirm or they may not show up',
          value: `≈${formatCurrency(unconfirmed * 500)} at risk`,
          href:  '/appointments',
        },
      ])
    }
  }

  async function loadBeds() {
    const { data: beds } = await supabase
      .from('beds')
      .select('status')

    const available = (beds || []).filter(b => b.status === 'available').length
    const occupied  = (beds || []).filter(b => b.status === 'occupied').length

    setData(d => ({ ...d, bedsAvailable: available, bedsOccupied: occupied }))
  }

  async function loadUnbilled(today: string) {
    // Encounters today
    const { data: encounters } = await supabase
      .from('encounters')
      .select('id, patientid')
      .eq('encounter_date', today)   // uses renamed column

    // Bills today
    const { data: bills } = await supabase
      .from('bills')
      .select('patientid')
      .gte('createdat', today + 'T00:00:00')
      .lte('createdat', today + 'T23:59:59')

    if (!encounters?.length) return

    const billedPatients = new Set((bills || []).map(b => b.patientid))
    const unbilled = encounters.filter(e => !billedPatients.has(e.patientid))

    setData(d => ({ ...d, unbilledToday: unbilled.length }))

    if (unbilled.length > 0) {
      setActions(prev => [
        ...prev.filter(a => a.id !== 'unbilled'),
        {
          id:    'unbilled',
          type:  'billing',
          emoji: '⚠️',
          title: `${unbilled.length} consultation${unbilled.length > 1 ? 's' : ''} not billed yet`,
          sub:   'Revenue leakage — generate bills now',
          value: `≈${formatCurrency(unbilled.length * 300)}`,
          href:  '/billing/new',
        },
      ])
    }
  }

  async function loadFollowUps(today: string) {
    const { count } = await supabase
      .from('prescriptions')
      .select('id', { count: 'exact', head: true })
      .eq('followupdate', today)

    if ((count || 0) > 0) {
      setData(d => ({ ...d, followUpsToday: count || 0 }))
      setActions(prev => [
        ...prev.filter(a => a.id !== 'followups'),
        {
          id:    'followups',
          type:  'urgent',
          emoji: '🔴',
          title: `${count} follow-up patient${(count || 0) > 1 ? 's' : ''} due today`,
          sub:   'Check if they have appointments scheduled',
          href:  '/reminders',
        },
      ])
    }
  }

  // Sort actions: urgent first, then billing, then appointment
  const sortedActions = [...actions].sort((a, b) => {
    const order = { urgent: 0, billing: 1, appointment: 2, info: 3 }
    return order[a.type] - order[b.type]
  })

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {new Date().getHours() < 12 ? 'Good morning!' :
               new Date().getHours() < 17 ? 'Good afternoon!' : 'Good evening!'} 👋
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date().toLocaleDateString('en-IN', {
                weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
              })}
            </p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-gray-500
                       bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-xl"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {lastTime || 'Refresh'}
          </button>
        </div>

        {/* ═══ MAIN GRID: 2-column on lg, single on mobile ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

          {/* ── LEFT COLUMN (Revenue + Quick Actions) ── */}
          <div className="lg:col-span-5 space-y-5">
            {/* TODAY'S REVENUE KPI */}
            <TodayRevenueCard data={data} loading={loading} />

            {/* 3 REVENUE PILLARS */}
            <div>
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                Revenue Opportunities
              </h2>
              <div className="flex gap-3">
                <PillarCard
                  icon={Target}
                  title="Fill Empty Slots"
                  value={data.bedsAvailable > 0 ? `${data.bedsAvailable} beds` : 'All full'}
                  sub="Available for admission"
                  className="text-emerald-800 bg-emerald-50 border-emerald-200"
                  onClick={() => router.push('/beds')}
                />
                <PillarCard
                  icon={AlertCircle}
                  title="Pending Bills"
                  value={formatCurrency(data.pendingBillsAmt)}
                  sub={`${data.pendingBillsCount} patients`}
                  className="text-orange-800 bg-orange-50 border-orange-200"
                  onClick={() => router.push('/billing')}
                />
                <PillarCard
                  icon={TrendingUp}
                  title="This Week"
                  value={formatCurrency(data.weekRevenue)}
                  sub="Collected"
                  className="text-blue-800 bg-blue-50 border-blue-200"
                  onClick={() => router.push('/analytics')}
                />
              </div>
            </div>

            {/* QUICK ACTIONS */}
            <div>
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                Quick Actions
              </h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: Users,       label: 'New Patient',   href: '/patients/new',   color: 'text-blue-600',   bg: 'bg-blue-50'   },
                  { icon: Calendar,    label: 'Appointment',   href: '/appointments',   color: 'text-purple-600', bg: 'bg-purple-50' },
                  { icon: IndianRupee, label: 'New Bill',      href: '/billing',        color: 'text-green-600',  bg: 'bg-green-50'  },
                  { icon: Bed,         label: 'Admit Patient', href: '/ipd',            color: 'text-red-600',    bg: 'bg-red-50'    },
                  { icon: FileText,    label: 'Prescription',  href: '/opd',            color: 'text-teal-600',   bg: 'bg-teal-50'   },
                  { icon: BarChart2,   label: 'Analytics',     href: '/analytics',      color: 'text-indigo-600', bg: 'bg-indigo-50' },
                ].map(({ icon: Icon, label, href, color, bg }) => (
                  <button
                    key={href}
                    onClick={() => router.push(href)}
                    className="flex flex-col items-center gap-2 bg-white border border-gray-200
                               rounded-2xl p-4 hover:shadow-md hover:border-gray-300
                               transition-all hover:scale-[1.03]"
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bg}`}>
                      <Icon className={`w-5 h-5 ${color}`} />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 text-center leading-tight">
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN (Actions + Alerts + Summary) ── */}
          <div className="lg:col-span-7 space-y-5">

            {/* NEXT OPD PATIENT — at a glance */}
            <NextOPDPatientCard />

            {/* ACTION FEED */}
            {sortedActions.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                  Action Required
                </h2>
                <div className="space-y-2">
                  {sortedActions.map(item => (
                    <ActionItem
                      key={item.id}
                      item={item}
                      onClick={item.href ? () => router.push(item.href!) : undefined}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* DOCTOR ALERTS — Abnormal Lab Values */}
            <DoctorAlertsSection />

            {/* TODAY SUMMARY */}
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
              <h2 className="text-sm font-bold text-gray-700 mb-3">Today at a Glance</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {[
                  { label: 'Appointments',       value: data.todayAppts,     icon: Calendar,    c: 'text-blue-500',   bg: 'bg-blue-50'   },
                  { label: 'Patients Seen',      value: data.todayPatients,  icon: Stethoscope, c: 'text-green-500',  bg: 'bg-green-50'  },
                  { label: 'Beds Occupied',      value: data.bedsOccupied,   icon: Bed,         c: 'text-red-500',    bg: 'bg-red-50'    },
                  { label: 'Follow-ups Due',     value: data.followUpsToday, icon: Clock,       c: 'text-orange-500', bg: 'bg-orange-50' },
                  { label: 'Unbilled',           value: data.unbilledToday,  icon: AlertCircle, c: 'text-amber-500',  bg: 'bg-amber-50'  },
                ].map(({ label, value, icon: Icon, c, bg }) => (
                  <div key={label} className={`flex flex-col items-center p-3 rounded-xl ${bg} border border-gray-100`}>
                    <Icon className={`w-5 h-5 ${c} mb-1`} />
                    <span className={`text-xl font-bold ${value > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                      {value}
                    </span>
                    <span className="text-[10px] text-gray-500 text-center leading-tight mt-0.5">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}