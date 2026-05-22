'use client'
/**
 * src/components/dashboard/RevenueEngine.tsx
 *
 * Revenue Engine Dashboard Widget
 *
 * Shows at-a-glance revenue pipeline health:
 *   - Missed patients (no-shows today)
 *   - Follow-up conversion rate (scheduled → fulfilled)
 *   - Lost revenue estimation
 *   - Pending bills count + amount
 *   - Unbilled consultations (revenue leakage)
 *
 * Designed as a drop-in component for the main dashboard page.
 * Fetches data independently with its own loading state.
 *
 * USAGE:
 *   import RevenueEngine from '@/components/dashboard/RevenueEngine'
 *   <RevenueEngine />
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { todayIST, daysFromNowIST, formatCurrency } from '@/lib/business-logic'
import {
  TrendingDown, UserX, AlertTriangle, IndianRupee,
  ArrowRight, RefreshCw, Target, Users, Clock,
} from 'lucide-react'

interface RevenueEngineData {
  // Missed patients (no-shows)
  noShowCount: number
  noShowNames: { name: string; time: string }[]
  estimatedLostRevenue: number

  // Follow-up conversion
  followUpsScheduled: number
  followUpsFulfilled: number
  followUpsMissed: number
  followUpConversionRate: number

  // Pending bills
  pendingBillsCount: number
  pendingBillsAmount: number

  // Unbilled consultations
  unbilledCount: number
  unbilledPatients: { name: string; id: string }[]
}

export default function RevenueEngine() {
  const router = useRouter()
  const [data, setData] = useState<RevenueEngineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today')

  useEffect(() => {
    loadData()
  }, [period])

  async function loadData() {
    setLoading(true)
    const today = todayIST()

    try {
      const [noShows, followUps, pendingBills, unbilled] = await Promise.all([
        loadNoShows(today),
        loadFollowUpConversion(today),
        loadPendingBills(),
        loadUnbilledConsultations(today),
      ])

      setData({
        ...noShows,
        ...followUps,
        ...pendingBills,
        ...unbilled,
      })
    } catch (err) {
      console.error('[RevenueEngine] load error:', err)
    }

    setLoading(false)
  }

  async function loadNoShows(today: string) {
    const dateRange = period === 'today' ? today
      : period === 'week' ? daysFromNowIST(-7)
      : daysFromNowIST(-30)

    let query = supabase
      .from('appointments')
      .select('id, patient_name, time, date')
      .eq('status', 'no-show')

    if (period === 'today') {
      query = query.eq('date', today)
    } else {
      query = query.gte('date', dateRange).lte('date', today)
    }

    const { data: noShows } = await query.order('date', { ascending: false }).limit(20)
    const avgFee = 500

    return {
      noShowCount: (noShows || []).length,
      noShowNames: (noShows || []).slice(0, 5).map(n => ({
        name: n.patient_name || 'Unknown',
        time: n.time || '',
      })),
      estimatedLostRevenue: (noShows || []).length * avgFee,
    }
  }

  async function loadFollowUpConversion(today: string) {
    const fromDate = period === 'today' ? today
      : period === 'week' ? daysFromNowIST(-7)
      : daysFromNowIST(-30)

    const { data: followUps } = await supabase
      .from('follow_ups')
      .select('id, status')
      .gte('recommended_date', fromDate)
      .lte('recommended_date', today)

    const all = followUps || []
    const fulfilled = all.filter(f => f.status === 'fulfilled').length
    const missed = all.filter(f => f.status === 'missed').length
    const total = all.length

    return {
      followUpsScheduled: total,
      followUpsFulfilled: fulfilled,
      followUpsMissed: missed,
      followUpConversionRate: total > 0 ? Math.round((fulfilled / total) * 100) : 0,
    }
  }

  async function loadPendingBills() {
    const { data: bills } = await supabase
      .from('bills')
      .select('id, due, total, paid')
      .in('status', ['pending', 'unpaid', 'partial'])
      .limit(100)

    const totalDue = (bills || []).reduce(
      (sum, b) => sum + Number(b.due || (Number(b.total || 0) - Number(b.paid || 0))),
      0
    )

    return {
      pendingBillsCount: (bills || []).length,
      pendingBillsAmount: totalDue,
    }
  }

  async function loadUnbilledConsultations(today: string) {
    const targetDate = period === 'today' ? today : daysFromNowIST(-1)

    // Encounters for the target date
    const { data: encounters } = await supabase
      .from('encounters')
      .select('id, patient_id')
      .eq('encounter_date', targetDate)

    // Bills for the target date
    const { data: bills } = await supabase
      .from('bills')
      .select('patient_id')
      .gte('created_at', targetDate + 'T00:00:00')
      .lte('created_at', targetDate + 'T23:59:59')

    const billedPatients = new Set((bills || []).map(b => b.patient_id))
    const unbilled = (encounters || []).filter(e => !billedPatients.has(e.patient_id))

    // Get patient names for unbilled
    let unbilledPatients: { name: string; id: string }[] = []
    if (unbilled.length > 0) {
      const patientIds = unbilled.map(u => u.patient_id).slice(0, 5)
      const { data: patients } = await supabase
        .from('patients')
        .select('id, full_name')
        .in('id', patientIds)

      unbilledPatients = (patients || []).map(p => ({
        name: p.full_name || 'Unknown',
        id: p.id,
      }))
    }

    return {
      unbilledCount: unbilled.length,
      unbilledPatients,
    }
  }

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-rose-50 to-orange-50 border border-rose-200 rounded-2xl p-5 animate-pulse">
        <div className="h-6 bg-rose-100/60 rounded-lg w-48 mb-4" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-20 bg-rose-100/40 rounded-xl" />
          <div className="h-20 bg-rose-100/40 rounded-xl" />
          <div className="h-20 bg-rose-100/40 rounded-xl" />
          <div className="h-20 bg-rose-100/40 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="bg-gradient-to-br from-rose-50 to-orange-50 border border-rose-200 rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-rose-100 rounded-lg flex items-center justify-center">
            <TrendingDown className="w-4 h-4 text-rose-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900">Revenue Engine</h2>
            <p className="text-[10px] text-gray-500">Pipeline health & leakage detection</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(['today', 'week', 'month'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`text-[10px] font-semibold px-2 py-1 rounded-lg transition-all ${
                period === p
                  ? 'bg-rose-600 text-white'
                  : 'bg-white text-gray-500 hover:bg-rose-100'
              }`}>
              {p === 'today' ? 'Today' : p === 'week' ? '7d' : '30d'}
            </button>
          ))}
          <button onClick={loadData} className="ml-1 p-1 rounded-lg hover:bg-white/60">
            <RefreshCw className="w-3 h-3 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Missed Patients (No-Shows) */}
        <div className="bg-white/70 border border-red-100 rounded-xl p-3 cursor-pointer hover:shadow-sm transition-all"
          onClick={() => router.push('/appointments')}>
          <div className="flex items-center gap-1.5 mb-1">
            <UserX className="w-3.5 h-3.5 text-red-500" />
            <span className="text-[10px] font-bold text-red-700 uppercase tracking-wide">No-Shows</span>
          </div>
          <div className="text-2xl font-black text-red-700">{data.noShowCount}</div>
          <div className="text-[10px] text-red-500">
            ≈ {formatCurrency(data.estimatedLostRevenue)} lost
          </div>
        </div>

        {/* Follow-up Conversion */}
        <div className="bg-white/70 border border-amber-100 rounded-xl p-3 cursor-pointer hover:shadow-sm transition-all"
          onClick={() => router.push('/reminders')}>
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">Follow-up</span>
          </div>
          <div className="text-2xl font-black text-amber-700">
            {data.followUpConversionRate}%
          </div>
          <div className="text-[10px] text-amber-500">
            {data.followUpsFulfilled}/{data.followUpsScheduled} converted
          </div>
        </div>

        {/* Pending Bills */}
        <div className="bg-white/70 border border-orange-100 rounded-xl p-3 cursor-pointer hover:shadow-sm transition-all"
          onClick={() => router.push('/billing')}>
          <div className="flex items-center gap-1.5 mb-1">
            <IndianRupee className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-[10px] font-bold text-orange-700 uppercase tracking-wide">Pending</span>
          </div>
          <div className="text-2xl font-black text-orange-700">{data.pendingBillsCount}</div>
          <div className="text-[10px] text-orange-500">
            {formatCurrency(data.pendingBillsAmount)} uncollected
          </div>
        </div>

        {/* Unbilled Consultations */}
        <div className="bg-white/70 border border-purple-100 rounded-xl p-3 cursor-pointer hover:shadow-sm transition-all"
          onClick={() => router.push('/billing?view=new')}>
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-purple-500" />
            <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wide">Unbilled</span>
          </div>
          <div className="text-2xl font-black text-purple-700">{data.unbilledCount}</div>
          <div className="text-[10px] text-purple-500">
            consultations not billed
          </div>
        </div>
      </div>

      {/* Detail Lists */}
      {data.noShowCount > 0 && (
        <div className="bg-white/50 rounded-xl p-3 mb-3">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">
            Missed Patients
          </div>
          <div className="space-y-1">
            {data.noShowNames.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-700 font-medium">{p.name}</span>
                <span className="text-gray-400 text-[10px]">{p.time || '—'}</span>
              </div>
            ))}
            {data.noShowCount > 5 && (
              <div className="text-[10px] text-gray-400 text-center pt-1">
                +{data.noShowCount - 5} more
              </div>
            )}
          </div>
        </div>
      )}

      {data.unbilledCount > 0 && (
        <div className="bg-white/50 rounded-xl p-3">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">
            Revenue Leakage — Unbilled Patients
          </div>
          <div className="space-y-1">
            {data.unbilledPatients.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-700 font-medium">{p.name}</span>
                <button onClick={() => router.push(`/billing?patientId=${p.id}&patientName=${encodeURIComponent(p.name)}&view=new`)}
                  className="text-blue-600 hover:text-blue-800 text-[10px] font-semibold flex items-center gap-0.5">
                  Bill Now <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div className="mt-3 bg-rose-100/50 rounded-xl px-3 py-2 flex items-center justify-between">
        <div className="text-[10px] text-rose-700">
          <strong>Total leakage:</strong> {formatCurrency(data.estimatedLostRevenue + data.pendingBillsAmount)}
          {' '}({period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'})
        </div>
        <button onClick={() => router.push('/analytics')}
          className="text-[10px] font-bold text-rose-600 hover:text-rose-800 flex items-center gap-0.5">
          Details <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}
