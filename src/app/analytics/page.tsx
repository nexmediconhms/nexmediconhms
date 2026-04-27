'use client'
import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import {
  TrendingUp, Activity, Clock, Users, RefreshCw,
  IndianRupee, Stethoscope, ArrowUp, ArrowDown, Minus,
  Calendar, PieChart,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────
interface RevenueBucket { label: string; amount: number }
interface DiagnosisCount { diagnosis: string; count: number }
interface HourBucket { hour: number; count: number }
interface RetentionData {
  totalPatients: number
  returningPatients: number
  newThisMonth: number
  avgVisitsPerPatient: number
  retentionRate: number
}

// ── Pure CSS Bar Chart ────────────────────────────────────────
function BarChart({ data, color = '#3b82f6', formatValue, height = 160 }: {
  data: { label: string; value: number }[]
  color?: string
  formatValue?: (v: number) => string
  height?: number
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div className="flex items-end gap-1 sm:gap-2" style={{ height }}>
      {data.map((d, i) => {
        const pct = Math.max((d.value / max) * 100, 2)
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            <span className="text-[10px] text-gray-500 font-mono tabular-nums">
              {formatValue ? formatValue(d.value) : d.value}
            </span>
            <div
              className="w-full rounded-t-md transition-all duration-500 min-w-[8px]"
              style={{ height: `${pct}%`, background: color, opacity: 0.85 }}
              title={`${d.label}: ${formatValue ? formatValue(d.value) : d.value}`}
            />
            <span className="text-[9px] text-gray-400 truncate max-w-full text-center leading-tight">
              {d.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Horizontal Bar (for diagnoses) ────────────────────────────
function HBar({ label, value, max, color = '#3b82f6' }: {
  label: string; value: number; max: number; color?: string
}) {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-700 w-36 truncate font-medium" title={label}>{label}</span>
      <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 flex items-center justify-end pr-2"
          style={{ width: `${Math.max(pct, 4)}%`, background: color }}
        >
          {pct > 15 && <span className="text-[10px] text-white font-bold">{value}</span>}
        </div>
      </div>
      {pct <= 15 && <span className="text-xs text-gray-500 w-6 text-right tabular-nums">{value}</span>}
    </div>
  )
}

// ── Donut Chart (for retention) ───────────────────────────────
function Donut({ percentage, label, color = '#3b82f6' }: {
  percentage: number; label: string; color?: string
}) {
  const radius = 45
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percentage / 100) * circumference
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#f3f4f6" strokeWidth="10" />
        <circle
          cx="60" cy="60" r={radius} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
          className="transition-all duration-700"
        />
        <text x="60" y="56" textAnchor="middle" className="text-2xl font-bold" fill="#1f2937" fontSize="22">
          {Math.round(percentage)}%
        </text>
        <text x="60" y="74" textAnchor="middle" fill="#6b7280" fontSize="10">
          {label}
        </text>
      </svg>
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────
function KPI({ label, value, sub, icon: Icon, color, trend }: {
  label: string; value: string | number; sub: string; icon: any
  color: string; trend?: 'up' | 'down' | 'flat'
}) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-gray-900">{value}</span>
          {trend === 'up' && <ArrowUp className="w-3.5 h-3.5 text-green-500" />}
          {trend === 'down' && <ArrowDown className="w-3.5 h-3.5 text-red-400" />}
          {trend === 'flat' && <Minus className="w-3.5 h-3.5 text-gray-300" />}
        </div>
        <div className="text-xs font-semibold text-gray-700">{label}</div>
        <div className="text-[10px] text-gray-400">{sub}</div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'30' | '90' | '365'>('30')

  // Revenue
  const [revenueTrend, setRevenueTrend] = useState<RevenueBucket[]>([])
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [prevRevenue, setPrevRevenue] = useState(0)

  // Diagnoses
  const [topDiagnoses, setTopDiagnoses] = useState<DiagnosisCount[]>([])

  // Peak hours
  const [hourlyData, setHourlyData] = useState<HourBucket[]>([])
  const [peakHour, setPeakHour] = useState('')

  // Retention
  const [retention, setRetention] = useState<RetentionData>({
    totalPatients: 0, returningPatients: 0, newThisMonth: 0,
    avgVisitsPerPatient: 0, retentionRate: 0,
  })

  // Encounter type breakdown
  const [encounterTypes, setEncounterTypes] = useState<{ type: string; count: number }[]>([])

  useEffect(() => { loadAnalytics() }, [period])

  async function loadAnalytics() {
    setLoading(true)
    const days = parseInt(period)
    const now = new Date()
    const startDate = new Date(now.getTime() - days * 86400000).toISOString()
    const prevStart = new Date(now.getTime() - days * 2 * 86400000).toISOString()

    await Promise.all([
      loadRevenue(startDate, prevStart, days),
      loadDiagnoses(startDate),
      loadPeakHours(startDate),
      loadRetention(startDate),
      loadEncounterTypes(startDate),
    ])

    setLoading(false)
  }

  async function loadRevenue(startDate: string, prevStart: string, days: number) {
    // Current period
    const { data: bills } = await supabase
      .from('bills')
      .select('net_amount,created_at')
      .eq('status', 'paid')
      .gte('created_at', startDate)
      .order('created_at', { ascending: true })

    const allBills = bills || []
    const total = allBills.reduce((s, b) => s + Number(b.net_amount), 0)
    setTotalRevenue(total)

    // Previous period for comparison
    const { data: prevBills } = await supabase
      .from('bills')
      .select('net_amount')
      .eq('status', 'paid')
      .gte('created_at', prevStart)
      .lt('created_at', startDate)

    setPrevRevenue((prevBills || []).reduce((s, b) => s + Number(b.net_amount), 0))

    // Group by week or day depending on period
    const bucketSize = days <= 30 ? 1 : days <= 90 ? 7 : 30 // days per bucket
    const buckets: Map<string, number> = new Map()

    allBills.forEach(b => {
      const d = new Date(b.created_at)
      let key: string
      if (bucketSize === 1) {
        key = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
      } else if (bucketSize === 7) {
        // Week number
        const weekStart = new Date(d)
        weekStart.setDate(d.getDate() - d.getDay())
        key = weekStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
      } else {
        key = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
      }
      buckets.set(key, (buckets.get(key) || 0) + Number(b.net_amount))
    })

    const trend: RevenueBucket[] = Array.from(buckets.entries()).map(([label, amount]) => ({ label, amount }))
    setRevenueTrend(trend)
  }

  async function loadDiagnoses(startDate: string) {
    const { data: encounters } = await supabase
      .from('encounters')
      .select('diagnosis')
      .gte('created_at', startDate)
      .not('diagnosis', 'is', null)

    const dxMap: Map<string, number> = new Map()
    ;(encounters || []).forEach(e => {
      if (!e.diagnosis || e.diagnosis.trim() === '') return
      // Split by comma/semicolon for multi-diagnosis entries
      const parts = e.diagnosis.split(/[,;]/).map((s: string) => s.trim()).filter(Boolean)
      parts.forEach((dx: string) => {
        const normalized = dx.charAt(0).toUpperCase() + dx.slice(1).toLowerCase()
        dxMap.set(normalized, (dxMap.get(normalized) || 0) + 1)
      })
    })

    const sorted = Array.from(dxMap.entries())
      .map(([diagnosis, count]) => ({ diagnosis, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    setTopDiagnoses(sorted)
  }

  async function loadPeakHours(startDate: string) {
    const { data: encounters } = await supabase
      .from('encounters')
      .select('created_at')
      .gte('created_at', startDate)

    const hourMap: Map<number, number> = new Map()
    // Initialize all hours 0-23
    for (let h = 0; h < 24; h++) hourMap.set(h, 0)

    ;(encounters || []).forEach(e => {
      const hour = new Date(e.created_at).getHours()
      hourMap.set(hour, (hourMap.get(hour) || 0) + 1)
    })

    // Only show clinic hours (7 AM - 10 PM)
    const filtered: HourBucket[] = []
    for (let h = 7; h <= 22; h++) {
      filtered.push({ hour: h, count: hourMap.get(h) || 0 })
    }
    setHourlyData(filtered)

    // Find peak
    const peak = filtered.reduce((max, b) => b.count > max.count ? b : max, filtered[0])
    if (peak && peak.count > 0) {
      const ampm = peak.hour >= 12 ? 'PM' : 'AM'
      const h12 = peak.hour > 12 ? peak.hour - 12 : peak.hour === 0 ? 12 : peak.hour
      setPeakHour(`${h12}:00 ${ampm}`)
    } else {
      setPeakHour('—')
    }
  }

  async function loadRetention(startDate: string) {
    // Get all patients with their encounter counts
    const { data: encounters } = await supabase
      .from('encounters')
      .select('patient_id')

    const { count: totalPatients } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true })

    // Count encounters per patient
    const patientVisits: Map<string, number> = new Map()
    ;(encounters || []).forEach(e => {
      patientVisits.set(e.patient_id, (patientVisits.get(e.patient_id) || 0) + 1)
    })

    const returning = Array.from(patientVisits.values()).filter(v => v > 1).length
    const total = totalPatients || 0
    const totalVisits = (encounters || []).length
    const avgVisits = total > 0 ? totalVisits / total : 0

    // New patients this month
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString()
    const { count: newCount } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', monthAgo)

    setRetention({
      totalPatients: total,
      returningPatients: returning,
      newThisMonth: newCount || 0,
      avgVisitsPerPatient: Math.round(avgVisits * 10) / 10,
      retentionRate: total > 0 ? Math.round((returning / total) * 100) : 0,
    })
  }

  async function loadEncounterTypes(startDate: string) {
    const { data: encounters } = await supabase
      .from('encounters')
      .select('encounter_type')
      .gte('created_at', startDate)

    const typeMap: Map<string, number> = new Map()
    ;(encounters || []).forEach(e => {
      const t = e.encounter_type || 'OPD'
      typeMap.set(t, (typeMap.get(t) || 0) + 1)
    })

    const sorted = Array.from(typeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)

    setEncounterTypes(sorted)
  }

  const revTrend = totalRevenue > prevRevenue ? 'up' : totalRevenue < prevRevenue ? 'down' : 'flat'
  const TYPE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Activity className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
              <p className="text-sm text-gray-500">Revenue trends, diagnoses, peak hours & retention</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as '30' | '90' | '365')}
              className="input text-xs py-1.5 px-3 w-auto"
            >
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last 12 months</option>
            </select>
            <button
              onClick={loadAnalytics}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500">Loading analytics...</p>
            </div>
          </div>
        )}

        {!loading && (
          <div className="space-y-6">

            {/* ── KPI Row ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KPI
                label="Revenue"
                value={`₹${totalRevenue.toLocaleString('en-IN')}`}
                sub={`${period} days · ${revTrend === 'up' ? '↑' : revTrend === 'down' ? '↓' : '→'} vs prev period`}
                icon={IndianRupee}
                color="bg-green-100 text-green-600"
                trend={revTrend}
              />
              <KPI
                label="Returning Patients"
                value={`${retention.retentionRate}%`}
                sub={`${retention.returningPatients} of ${retention.totalPatients} patients`}
                icon={Users}
                color="bg-blue-100 text-blue-600"
              />
              <KPI
                label="Peak Hour"
                value={peakHour}
                sub="Busiest consultation time"
                icon={Clock}
                color="bg-amber-100 text-amber-600"
              />
              <KPI
                label="New This Month"
                value={retention.newThisMonth}
                sub={`Avg ${retention.avgVisitsPerPatient} visits/patient`}
                icon={Stethoscope}
                color="bg-purple-100 text-purple-600"
              />
            </div>

            {/* ── Revenue Trend Chart ─────────────────────────── */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  Revenue Trend
                </h2>
                <span className="text-xs text-gray-400">
                  {period === '30' ? 'Daily' : period === '90' ? 'Weekly' : 'Monthly'}
                </span>
              </div>
              {revenueTrend.length > 0 ? (
                <BarChart
                  data={revenueTrend.map(r => ({ label: r.label, value: r.amount }))}
                  color="#10b981"
                  formatValue={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
                  height={180}
                />
              ) : (
                <div className="text-center py-10 text-sm text-gray-400">
                  No billing data for this period
                </div>
              )}
            </div>

            {/* ── Two-column: Diagnoses + Peak Hours ──────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Top Diagnoses */}
              <div className="card p-5">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-4">
                  <Stethoscope className="w-4 h-4 text-blue-600" />
                  Top 10 Diagnoses
                </h2>
                {topDiagnoses.length > 0 ? (
                  <div className="space-y-2.5">
                    {topDiagnoses.map((d, i) => (
                      <HBar
                        key={d.diagnosis}
                        label={d.diagnosis}
                        value={d.count}
                        max={topDiagnoses[0].count}
                        color={TYPE_COLORS[i % TYPE_COLORS.length]}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-10 text-sm text-gray-400">
                    No diagnosis data for this period
                  </div>
                )}
              </div>

              {/* Peak OPD Hours */}
              <div className="card p-5">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-4">
                  <Clock className="w-4 h-4 text-amber-600" />
                  OPD Traffic by Hour
                </h2>
                {hourlyData.some(h => h.count > 0) ? (
                  <BarChart
                    data={hourlyData.map(h => ({
                      label: `${h.hour > 12 ? h.hour - 12 : h.hour}${h.hour >= 12 ? 'p' : 'a'}`,
                      value: h.count,
                    }))}
                    color="#f59e0b"
                    height={160}
                  />
                ) : (
                  <div className="text-center py-10 text-sm text-gray-400">
                    No encounter data for this period
                  </div>
                )}
                {peakHour !== '—' && (
                  <div className="mt-3 text-xs text-gray-500 text-center">
                    🔥 Peak hour: <strong className="text-amber-700">{peakHour}</strong> — consider extra staff
                  </div>
                )}
              </div>
            </div>

            {/* ── Two-column: Retention + Encounter Types ─────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Patient Retention */}
              <div className="card p-5">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-4">
                  <Users className="w-4 h-4 text-blue-600" />
                  Patient Retention
                </h2>
                <div className="flex items-center justify-around">
                  <Donut
                    percentage={retention.retentionRate}
                    label="Returning"
                    color="#3b82f6"
                  />
                  <div className="space-y-3 text-sm">
                    <div>
                      <div className="text-2xl font-bold text-gray-900">{retention.totalPatients}</div>
                      <div className="text-xs text-gray-500">Total Patients</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-blue-600">{retention.returningPatients}</div>
                      <div className="text-xs text-gray-500">Returned (2+ visits)</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-green-600">{retention.newThisMonth}</div>
                      <div className="text-xs text-gray-500">New this month</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-purple-600">{retention.avgVisitsPerPatient}</div>
                      <div className="text-xs text-gray-500">Avg visits/patient</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Encounter Type Breakdown */}
              <div className="card p-5">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-4">
                  <PieChart className="w-4 h-4 text-purple-600" />
                  Visit Types
                </h2>
                {encounterTypes.length > 0 ? (
                  <div className="space-y-3">
                    {encounterTypes.map((et, i) => {
                      const total = encounterTypes.reduce((s, e) => s + e.count, 0)
                      const pct = total > 0 ? Math.round((et.count / total) * 100) : 0
                      return (
                        <div key={et.type} className="flex items-center gap-3">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }}
                          />
                          <span className="text-sm text-gray-700 flex-1">{et.type}</span>
                          <span className="text-xs text-gray-500 tabular-nums">{et.count}</span>
                          <span className="text-xs font-bold text-gray-700 w-10 text-right">{pct}%</span>
                        </div>
                      )
                    })}
                    {/* Stacked bar */}
                    <div className="flex h-4 rounded-full overflow-hidden mt-2">
                      {encounterTypes.map((et, i) => {
                        const total = encounterTypes.reduce((s, e) => s + e.count, 0)
                        const pct = total > 0 ? (et.count / total) * 100 : 0
                        return (
                          <div
                            key={et.type}
                            style={{ width: `${pct}%`, background: TYPE_COLORS[i % TYPE_COLORS.length] }}
                            className="transition-all duration-500"
                            title={`${et.type}: ${et.count}`}
                          />
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-10 text-sm text-gray-400">
                    No encounter data for this period
                  </div>
                )}
              </div>
            </div>

            {/* ── Insights ────────────────────────────────────── */}
            <div className="card p-5 bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-100">
              <h2 className="text-sm font-bold text-indigo-900 mb-3 flex items-center gap-2">
                💡 Quick Insights
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs text-indigo-800">
                {totalRevenue > 0 && (
                  <div className="bg-white/60 rounded-lg p-3">
                    <strong>Avg daily revenue:</strong>{' '}
                    ₹{Math.round(totalRevenue / parseInt(period)).toLocaleString('en-IN')}
                  </div>
                )}
                {topDiagnoses.length > 0 && (
                  <div className="bg-white/60 rounded-lg p-3">
                    <strong>Most common:</strong>{' '}
                    {topDiagnoses[0].diagnosis} ({topDiagnoses[0].count} cases)
                  </div>
                )}
                {peakHour !== '—' && (
                  <div className="bg-white/60 rounded-lg p-3">
                    <strong>Peak hour:</strong>{' '}
                    {peakHour} — schedule complex cases outside this window
                  </div>
                )}
                {retention.retentionRate > 0 && (
                  <div className="bg-white/60 rounded-lg p-3">
                    <strong>Retention:</strong>{' '}
                    {retention.retentionRate >= 50
                      ? '✅ Good — patients are returning'
                      : '⚠️ Low — consider follow-up reminders'}
                  </div>
                )}
                {retention.avgVisitsPerPatient > 0 && (
                  <div className="bg-white/60 rounded-lg p-3">
                    <strong>Engagement:</strong>{' '}
                    {retention.avgVisitsPerPatient >= 2
                      ? `${retention.avgVisitsPerPatient} visits/patient — strong engagement`
                      : `${retention.avgVisitsPerPatient} visits/patient — room to grow`}
                  </div>
                )}
                {prevRevenue > 0 && (
                  <div className="bg-white/60 rounded-lg p-3">
                    <strong>Growth:</strong>{' '}
                    {totalRevenue >= prevRevenue
                      ? `+${Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)}% vs previous period`
                      : `${Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)}% vs previous period`}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </AppShell>
  )
}
