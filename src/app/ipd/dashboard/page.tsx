'use client'
/**
 * src/app/ipd/dashboard/page.tsx
 *
 * IPD Analytics Dashboard — Bird's-eye view of the entire IPD.
 *
 * Sections:
 *   1. Stat cards — beds, admissions, revenue, avg LOS
 *   2. Bed occupancy visual (ward-wise)
 *   3. Today's schedule — discharges, surgeries, follow-ups
 *   4. Pending tasks — unsigned consents, pending labs, unsettled bills, missed meds
 *   5. Revenue breakdown — this month, collections, outstanding
 *   6. Recent activity feed
 *
 * Reads from existing tables only. No new tables needed.
 * NEW FILE — does not modify any existing page or component.
 * Access via: /ipd/dashboard
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatDate, getIndiaToday } from '@/lib/utils'
import {
  BedDouble, Users, IndianRupee, Clock, Activity,
  AlertTriangle, CheckCircle, Calendar, Scissors,
  LogOut, Baby, Pill, Shield, FileText, TestTube,
  TrendingUp, Loader2, RefreshCw, ChevronRight,
  AlertCircle, Heart, BarChart3,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────
interface DashboardData {
  // Beds
  totalBeds: number
  occupiedBeds: number
  availableBeds: number
  cleaningBeds: number
  wardOccupancy: { ward: string; total: number; occupied: number }[]

  // Admissions
  activeAdmissions: number
  todayAdmissions: number
  todayDischarges: number
  avgLOS: number

  // Revenue
  monthRevenue: number
  monthCollected: number
  monthOutstanding: number
  todayRevenue: number

  // Today's schedule
  todaySurgeries: { patient: string; surgery: string; time: string; bed: string }[]
  pendingDischarges: { id: string; patient: string; bed: string; days: number; doctor: string }[]
  todayDeliveries: { patient: string; type: string; babySex: string; bed: string }[]

  // Pending tasks
  unsignedConsents: number
  pendingLabs: number
  unsettledBills: number
  missedMeds: number
  pendingLabDetails: { patient: string; test: string }[]
  unsettledBillDetails: { patient: string; balance: number }[]

  // Recent activity
  recentActivity: { type: string; text: string; time: string; icon: string }[]
}

const EMPTY_DATA: DashboardData = {
  totalBeds: 0, occupiedBeds: 0, availableBeds: 0, cleaningBeds: 0,
  wardOccupancy: [],
  activeAdmissions: 0, todayAdmissions: 0, todayDischarges: 0, avgLOS: 0,
  monthRevenue: 0, monthCollected: 0, monthOutstanding: 0, todayRevenue: 0,
  todaySurgeries: [], pendingDischarges: [], todayDeliveries: [],
  unsignedConsents: 0, pendingLabs: 0, unsettledBills: 0, missedMeds: 0,
  pendingLabDetails: [], unsettledBillDetails: [],
  recentActivity: [],
}

export default function IPDDashboardPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DashboardData>({ ...EMPTY_DATA })
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const today = getIndiaToday()
  const monthStart = today.slice(0, 7) + '-01'

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    const d: DashboardData = { ...EMPTY_DATA }

    try {
      // ═══ BEDS ═══
      const { data: beds } = await supabase.from('beds').select('id, bed_number, ward, status, patient_id, patient_name, admission_date')
      if (beds) {
        d.totalBeds = beds.length
        d.occupiedBeds = beds.filter(b => b.status === 'occupied').length
        d.availableBeds = beds.filter(b => b.status === 'available').length
        d.cleaningBeds = beds.filter(b => b.status === 'cleaning' || b.status === 'maintenance').length

        // Ward-wise occupancy
        const wards: Record<string, { total: number; occupied: number }> = {}
        beds.forEach(b => {
          const w = b.ward || 'General'
          if (!wards[w]) wards[w] = { total: 0, occupied: 0 }
          wards[w].total++
          if (b.status === 'occupied') wards[w].occupied++
        })
        d.wardOccupancy = Object.entries(wards).map(([ward, v]) => ({ ward, ...v }))
      }

      // ═══ ADMISSIONS ═══
      const { data: activeAdm } = await supabase.from('ipd_admissions')
        .select('id, patient_name, bed_number, ward, admission_date, admitting_doctor, expected_discharge')
        .eq('status', 'active')
      d.activeAdmissions = activeAdm?.length || 0

      const { count: todayAdmCount } = await supabase.from('ipd_admissions')
        .select('id', { count: 'exact', head: true })
        .eq('admission_date', today)
      d.todayAdmissions = todayAdmCount || 0

      const { count: todayDcCount } = await supabase.from('ipd_admissions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'discharged')
        .eq('discharge_date', today)
      d.todayDischarges = todayDcCount || 0

      // Average LOS (last 30 discharged)
      const { data: discharged } = await supabase.from('ipd_admissions')
        .select('admission_date, discharge_date')
        .eq('status', 'discharged')
        .not('discharge_date', 'is', null)
        .order('discharge_date', { ascending: false })
        .limit(30)
      if (discharged && discharged.length > 0) {
        const totalDays = discharged.reduce((sum, a) => {
          if (!a.admission_date || !a.discharge_date) return sum
          const days = Math.max(1, Math.ceil((new Date(a.discharge_date).getTime() - new Date(a.admission_date).getTime()) / 86400000))
          return sum + days
        }, 0)
        d.avgLOS = Math.round((totalDays / discharged.length) * 10) / 10
      }

      // Pending discharges (expected_discharge <= today)
      if (activeAdm) {
        d.pendingDischarges = activeAdm
          .filter(a => a.expected_discharge && a.expected_discharge <= today)
          .map(a => ({
            id: a.id,
            patient: a.patient_name || '—',
            bed: `${a.bed_number || ''} (${a.ward || ''})`,
            days: Math.max(1, Math.ceil((Date.now() - new Date(a.admission_date).getTime()) / 86400000)),
            doctor: a.admitting_doctor || '',
          }))
      }

      // ═══ TODAY'S SURGERIES ═══
      const { data: surgeries } = await supabase.from('surgery_records')
        .select('surgery_name, surgery_time, surgeon, patient_id, ipd_admission_id')
        .eq('surgery_date', today)
        .order('surgery_time')
      if (surgeries && surgeries.length > 0) {
        // Get patient names
        const patIds = [new Set(surgeries.map(s => s.patient_id).filter(Boolean))]
        const { data: pats } = patIds.length > 0
          ? await supabase.from('patients').select('id, full_name').in('id', patIds)
          : { data: [] }
        const patMap: Record<string, string> = {}
        ;(pats || []).forEach((p: any) => { patMap[p.id] = p.full_name })

        d.todaySurgeries = surgeries.map(s => ({
          patient: patMap[s.patient_id] || '—',
          surgery: s.surgery_name || '—',
          time: s.surgery_time || '—',
          bed: '',
        }))
      }

      // ═══ TODAY'S DELIVERIES ═══
      const { data: deliveries } = await supabase.from('delivery_records')
        .select('delivery_type, baby_sex, patient_id, baby_weight_kg')
        .eq('delivery_date', today)
      if (deliveries && deliveries.length > 0) {
        const patIds = [new Set(deliveries.map(dl => dl.patient_id).filter(Boolean))]
        const { data: pats } = patIds.length > 0
          ? await supabase.from('patients').select('id, full_name').in('id', patIds)
          : { data: [] }
        const patMap: Record<string, string> = {}
        ;(pats || []).forEach((p: any) => { patMap[p.id] = p.full_name })

        d.todayDeliveries = deliveries.map(dl => ({
          patient: patMap[dl.patient_id] || '—',
          type: dl.delivery_type || '—',
          babySex: dl.baby_sex || '—',
          bed: '',
        }))
      }

      // ═══ REVENUE ═══
      const { data: monthCharges } = await supabase.from('ipd_charges')
        .select('amount, charge_date')
        .gte('charge_date', monthStart)
      if (monthCharges) {
        d.monthRevenue = monthCharges.reduce((s, c) => s + (c.amount || 0), 0)
        d.todayRevenue = monthCharges
          .filter(c => c.charge_date === today)
          .reduce((s, c) => s + (c.amount || 0), 0)
      }

      const { data: monthBills } = await supabase.from('bills')
        .select('total, paid, balance, bill_module')
        .or('bill_module.eq.IPD,bill_module.is.null')
        .gte('bill_date', monthStart)
      if (monthBills) {
        d.monthCollected = monthBills.reduce((s, b) => s + (b.paid || 0), 0)
        d.monthOutstanding = monthBills.reduce((s, b) => s + (b.balance || 0), 0)
      }

      // ═══ PENDING TASKS ═══
      // Unsigned consents for active admissions
      if (activeAdm && activeAdm.length > 0) {
        const admIds = activeAdm.map(a => a.id)
        const { count: consentCount } = await supabase.from('consent_records')
          .select('id', { count: 'exact', head: true })
          .in('ipd_admission_id', admIds)
          .eq('status', 'signed')

        // Rough estimate: each admission should have at least 1 consent
        d.unsignedConsents = Math.max(0, d.activeAdmissions - (consentCount || 0))
      }

      // Pending labs for admitted patients
      if (activeAdm && activeAdm.length > 0) {
        const { data: pendLabs } = await supabase.from('lab_orders')
          .select('test_name, patient_id')
          .in('status', ['ordered', 'collected', 'processing'])
          .limit(20)
        if (pendLabs) {
          d.pendingLabs = pendLabs.length
          // Get patient names for first 5
          const patIds = [new Set(pendLabs.slice(0, 5).map(l => l.patient_id).filter(Boolean))]
          if (patIds.length > 0) {
            const { data: pats } = await supabase.from('patients').select('id, full_name').in('id', patIds)
            const patMap: Record<string, string> = {}
            ;(pats || []).forEach((p: any) => { patMap[p.id] = p.full_name })
            d.pendingLabDetails = pendLabs.slice(0, 5).map(l => ({
              patient: patMap[l.patient_id] || '—',
              test: l.test_name,
            }))
          }
        }
      }

      // Unsettled bills
      const { data: unsettled } = await supabase.from('bills')
        .select('patient_name, balance')
        .gt('balance', 0)
        .or('bill_module.eq.IPD,bill_module.is.null')
        .order('balance', { ascending: false })
        .limit(10)
      if (unsettled) {
        d.unsettledBills = unsettled.length
        d.unsettledBillDetails = unsettled.slice(0, 5).map(b => ({
          patient: b.patient_name || '—',
          balance: b.balance || 0,
        }))
      }

      // Missed medications today
      const { count: missedCount } = await supabase.from('medication_administrations')
        .select('id', { count: 'exact', head: true })
        .eq('scheduled_date', today)
        .eq('status', 'missed')
      d.missedMeds = missedCount || 0

      // ═══ RECENT ACTIVITY (last 10 events) ═══
      const activities: { type: string; text: string; time: string; icon: string }[] = []

      // Recent admissions
      const { data: recentAdm } = await supabase.from('ipd_admissions')
        .select('patient_name, admission_date, created_at')
        .order('created_at', { ascending: false }).limit(3)
      ;(recentAdm || []).forEach(a => {
        activities.push({ type: 'admission', text: `${a.patient_name} admitted`, time: a.created_at, icon: 'bed' })
      })

      // Recent discharges
      const { data: recentDc } = await supabase.from('ipd_admissions')
        .select('patient_name, discharge_date, updated_at')
        .eq('status', 'discharged')
        .order('updated_at', { ascending: false }).limit(3)
      ;(recentDc || []).forEach(a => {
        activities.push({ type: 'discharge', text: `${a.patient_name} discharged`, time: a.updated_at, icon: 'logout' })
      })

      // Recent deliveries
      const { data: recentDel } = await supabase.from('delivery_records')
        .select('baby_sex, delivery_type, created_at, patient_id')
        .order('created_at', { ascending: false }).limit(2)
      ;(recentDel || []).forEach(dl => {
        activities.push({ type: 'delivery', text: `${dl.delivery_type || 'Delivery'} — Baby ${dl.baby_sex || ''}`, time: dl.created_at, icon: 'baby' })
      })

      // Sort by time
      activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      d.recentActivity = activities.slice(0, 8)

    } catch (err: any) {
      console.error('Dashboard load error:', err)
    }

    setData(d)
    setLastRefresh(new Date())
    setLoading(false)
  }, [today, monthStart])

  useEffect(() => { loadDashboard() }, [loadDashboard])

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(loadDashboard, 120000)
    return () => clearInterval(interval)
  }, [loadDashboard])

  const occupancyPct = data.totalBeds > 0 ? Math.round((data.occupiedBeds / data.totalBeds) * 100) : 0

  const ICON_MAP: Record<string, any> = {
    bed: BedDouble, logout: LogOut, baby: Baby, surgery: Scissors,
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          <span className="ml-2 text-gray-500">Loading IPD Dashboard...</span>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-blue-500" /> IPD Dashboard
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Last updated: {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}
              · Auto-refreshes every 2 min
            </p>
          </div>
          <button onClick={loadDashboard} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center gap-1">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {/* ═══ ROW 1: STAT CARDS ═══ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <StatCard icon={BedDouble} label="Bed Occupancy" value={`${data.occupiedBeds}/${data.totalBeds}`}
            sub={`${occupancyPct}% occupied`}
            color={occupancyPct > 85 ? 'red' : occupancyPct > 60 ? 'amber' : 'green'} />
          <StatCard icon={Users} label="Active Admissions" value={data.activeAdmissions.toString()}
            sub={`${data.todayAdmissions} today · ${data.todayDischarges} discharged`} color="blue" />
          <StatCard icon={IndianRupee} label="This Month Revenue" value={`₹${(data.monthRevenue / 1000).toFixed(0)}K`}
            sub={`Collected: ₹${(data.monthCollected / 1000).toFixed(0)}K`} color="green" />
          <StatCard icon={Clock} label="Avg Length of Stay" value={`${data.avgLOS || '—'} days`}
            sub="Last 30 discharges" color="purple" />
        </div>

        {/* ═══ ROW 2: BED OCCUPANCY + TODAY'S SCHEDULE ═══ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          {/* Ward-wise occupancy */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <BedDouble className="w-4 h-4 text-blue-500" /> Ward-wise Bed Occupancy
            </h2>
            {data.wardOccupancy.length === 0 ? (
              <p className="text-xs text-gray-400">No wards found.</p>
            ) : (
              <div className="space-y-3">
                {data.wardOccupancy.map(w => {
                  const pct = w.total > 0 ? Math.round((w.occupied / w.total) * 100) : 0
                  return (
                    <div key={w.ward}>
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span className="font-medium">{w.ward}</span>
                        <span>{w.occupied}/{w.total} beds · {pct}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${
                          pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-amber-400' : 'bg-green-500'
                        }`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
                <div className="flex gap-3 text-[10px] text-gray-400 pt-1">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span> Available: {data.availableBeds}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Occupied: {data.occupiedBeds}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400"></span> Cleaning: {data.cleaningBeds}</span>
                </div>
              </div>
            )}
          </div>

          {/* Today's schedule */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-green-500" /> Today's Schedule
            </h2>

            {data.todaySurgeries.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] text-orange-600 font-semibold uppercase tracking-wide mb-1">Surgeries ({data.todaySurgeries.length})</p>
                {data.todaySurgeries.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-gray-100 last:border-0">
                    <Scissors className="w-3 h-3 text-orange-400" />
                    <span className="font-medium text-gray-700">{s.patient}</span>
                    <span className="text-gray-500">— {s.surgery}</span>
                    {s.time && <span className="ml-auto text-gray-400">{s.time}</span>}
                  </div>
                ))}
              </div>
            )}

            {data.todayDeliveries.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] text-pink-600 font-semibold uppercase tracking-wide mb-1">Deliveries ({data.todayDeliveries.length})</p>
                {data.todayDeliveries.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-gray-100 last:border-0">
                    <Baby className="w-3 h-3 text-pink-400" />
                    <span className="font-medium text-gray-700">{d.patient}</span>
                    <span className="text-gray-500">— {d.type} · Baby {d.babySex}</span>
                  </div>
                ))}
              </div>
            )}

            {data.pendingDischarges.length > 0 && (
              <div>
                <p className="text-[10px] text-red-600 font-semibold uppercase tracking-wide mb-1">Overdue Discharges ({data.pendingDischarges.length})</p>
                {data.pendingDischarges.map((p, i) => (
                  <Link key={i} href={`/ipd/discharge/${p.id}`}
                    className="flex items-center gap-2 text-xs py-1 border-b border-gray-100 last:border-0 hover:bg-red-50 rounded px-1">
                    <AlertTriangle className="w-3 h-3 text-red-400" />
                    <span className="font-medium text-gray-700">{p.patient}</span>
                    <span className="text-gray-500">— {p.bed} · {p.days}d</span>
                    <ChevronRight className="w-3 h-3 ml-auto text-gray-300" />
                  </Link>
                ))}
              </div>
            )}

            {data.todaySurgeries.length === 0 && data.todayDeliveries.length === 0 && data.pendingDischarges.length === 0 && (
              <p className="text-xs text-gray-400 py-4 text-center">No scheduled events for today.</p>
            )}
          </div>
        </div>

        {/* ═══ ROW 3: PENDING TASKS + REVENUE ═══ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          {/* Pending tasks */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> Pending Tasks
            </h2>
            <div className="space-y-2">
              <TaskRow icon={Shield} label="Unsigned Consents" count={data.unsignedConsents}
                color={data.unsignedConsents > 0 ? 'amber' : 'green'} href="/ipd" />
              <TaskRow icon={TestTube} label="Pending Lab Results" count={data.pendingLabs}
                color={data.pendingLabs > 0 ? 'amber' : 'green'} href="/lab" />
              <TaskRow icon={IndianRupee} label="Unsettled Bills" count={data.unsettledBills}
                color={data.unsettledBills > 0 ? 'red' : 'green'} href="/billing" />
              <TaskRow icon={Pill} label="Missed Medications Today" count={data.missedMeds}
                color={data.missedMeds > 0 ? 'red' : 'green'} />

              {/* Unsettled bill details */}
              {data.unsettledBillDetails.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase mb-1">Top Outstanding Balances</p>
                  {data.unsettledBillDetails.map((b, i) => (
                    <div key={i} className="flex justify-between text-xs py-0.5">
                      <span className="text-gray-600">{b.patient}</span>
                      <span className="text-red-600 font-medium">₹{b.balance.toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pending lab details */}
              {data.pendingLabDetails.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase mb-1">Awaiting Lab Results</p>
                  {data.pendingLabDetails.map((l, i) => (
                    <div key={i} className="flex justify-between text-xs py-0.5">
                      <span className="text-gray-600">{l.patient}</span>
                      <span className="text-amber-600">{l.test}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Revenue summary */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-500" /> Revenue Summary — {today.slice(0, 7)}
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-blue-700">₹{(data.monthRevenue / 1000).toFixed(1)}K</div>
                  <div className="text-[10px] text-blue-500">Total Charges</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-green-700">₹{(data.monthCollected / 1000).toFixed(1)}K</div>
                  <div className="text-[10px] text-green-500">Collected</div>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-red-700">₹{(data.monthOutstanding / 1000).toFixed(1)}K</div>
                  <div className="text-[10px] text-red-500">Outstanding</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-purple-700">₹{(data.todayRevenue / 1000).toFixed(1)}K</div>
                  <div className="text-[10px] text-purple-500">Today's Charges</div>
                </div>
              </div>

              {/* Collection ratio bar */}
              {data.monthRevenue > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Collection Rate</span>
                    <span>{Math.round((data.monthCollected / data.monthRevenue) * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (data.monthCollected / data.monthRevenue) * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══ ROW 4: RECENT ACTIVITY ═══ */}
        {data.recentActivity.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-500" /> Recent Activity
            </h2>
            <div className="space-y-2">
              {data.recentActivity.map((a, i) => {
                const Icon = ICON_MAP[a.icon] || Activity
                const colorMap: Record<string, string> = {
                  admission: 'text-blue-500 bg-blue-50',
                  discharge: 'text-green-500 bg-green-50',
                  delivery: 'text-pink-500 bg-pink-50',
                  surgery: 'text-orange-500 bg-orange-50',
                }
                const cls = colorMap[a.type] || 'text-gray-500 bg-gray-50'
                return (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center ${cls}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="text-gray-700 flex-1">{a.text}</span>
                    <span className="text-gray-400 text-[10px]">
                      {a.time ? formatDate(a.time.split('T')[0]) : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Quick links */}
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/ipd" className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100">IPD Census</Link>
          <Link href="/ipd/beds" className="text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100">Bed Management</Link>
          <Link href="/billing" className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100">Billing</Link>
          <Link href="/lab" className="text-xs px-3 py-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100">Lab</Link>
        </div>
      </div>
    </AppShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub: string; color: string
}) {
  const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
    blue:   { bg: 'bg-blue-50',   text: 'text-blue-700',   iconBg: 'bg-blue-100' },
    green:  { bg: 'bg-green-50',  text: 'text-green-700',  iconBg: 'bg-green-100' },
    red:    { bg: 'bg-red-50',    text: 'text-red-700',    iconBg: 'bg-red-100' },
    amber:  { bg: 'bg-amber-50',  text: 'text-amber-700',  iconBg: 'bg-amber-100' },
    purple: { bg: 'bg-purple-50', text: 'text-purple-700', iconBg: 'bg-purple-100' },
  }
  const c = colorMap[color] || colorMap.blue
  return (
    <div className={`${c.bg} rounded-xl p-4 border border-gray-100`}>
      <div className="flex items-center gap-3 mb-2">
        <span className={`w-9 h-9 rounded-lg ${c.iconBg} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${c.text}`} />
        </span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${c.text}`}>{value}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  )
}

function TaskRow({ icon: Icon, label, count, color, href }: {
  icon: any; label: string; count: number; color: string; href?: string
}) {
  const Wrapper = href ? Link : 'div'
  const wrapperProps = href ? { href } : {}
  return (
    <Wrapper {...wrapperProps as any}
      className={`flex items-center justify-between p-2 rounded-lg ${
        color === 'red' ? 'bg-red-50' : color === 'amber' ? 'bg-amber-50' : 'bg-green-50'
      } ${href ? 'hover:opacity-80 cursor-pointer' : ''}`}>
      <span className="flex items-center gap-2 text-xs text-gray-700">
        <Icon className={`w-4 h-4 ${
          color === 'red' ? 'text-red-500' : color === 'amber' ? 'text-amber-500' : 'text-green-500'
        }`} />
        {label}
      </span>
      <span className={`text-sm font-bold ${
        color === 'red' ? 'text-red-700' : color === 'amber' ? 'text-amber-700' : 'text-green-700'
      }`}>
        {count === 0 ? '✓' : count}
      </span>
    </Wrapper>
  )
}