'use client'
/**
 * src/app/forecasting/page.tsx
 *
 * Revenue Forecasting Dashboard
 *
 * Uses last 6 months of billing data to predict:
 *   - This month's projected revenue (linear regression)
 *   - Busiest days of the week
 *   - Peak revenue hours
 *   - Growth trend & rate
 *   - Expected patient volume
 *
 * Algorithm: Simple linear regression on daily revenue data points.
 * No external ML libraries needed — pure JS math.
 */

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import {
  TrendingUp, Calendar, Clock, IndianRupee, Target,
  BarChart3, RefreshCw, Zap, ArrowUp, ArrowDown,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────
interface DailyRevenue {
  date: string
  amount: number
  count: number
}

interface DayOfWeekStats {
  day: string
  avgRevenue: number
  avgPatients: number
  dayIndex: number
}

interface HourStats {
  hour: number
  label: string
  totalRevenue: number
  billCount: number
}

interface ForecastResult {
  predictedMonthly: number
  predictedDaily: number
  growthRate: number        // % monthly growth
  confidenceLevel: string  // 'high' | 'medium' | 'low'
  trendDirection: 'up' | 'down' | 'flat'
  busiestDay: string
  peakHour: string
  avgDailyRevenue: number
  avgDailyPatients: number
  daysRemaining: number
  earnedSoFar: number
  projectedRemaining: number
}

// ── Linear Regression ─────────────────────────────────────────
// y = mx + b where x = day index, y = revenue
function linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 }

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0
  for (const p of points) {
    sumX += p.x
    sumY += p.y
    sumXY += p.x * p.y
    sumX2 += p.x * p.x
    sumY2 += p.y * p.y
  }

  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 }

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  // R-squared (coefficient of determination)
  const meanY = sumY / n
  let ssRes = 0, ssTot = 0
  for (const p of points) {
    const predicted = slope * p.x + intercept
    ssRes += (p.y - predicted) ** 2
    ssTot += (p.y - meanY) ** 2
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0

  return { slope, intercept, r2 }
}

// ── Bar Chart Component ───────────────────────────────────────
function BarChart({ data, color = '#3b82f6', formatValue, height = 140 }: {
  data: { label: string; value: number }[]
  color?: string
  formatValue?: (v: number) => string
  height?: number
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d, i) => {
        const pct = Math.max((d.value / max) * 100, 3)
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            <span className="text-[9px] text-gray-500 font-mono tabular-nums">
              {formatValue ? formatValue(d.value) : d.value.toLocaleString('en-IN')}
            </span>
            <div
              className="w-full rounded-t-md transition-all duration-500 min-w-[12px]"
              style={{ height: `${pct}%`, background: color, opacity: 0.85 }}
            />
            <span className="text-[9px] text-gray-400 text-center leading-tight font-medium">
              {d.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Forecast Card ─────────────────────────────────────────────
function ForecastCard({ label, value, sub, icon: Icon, color, trend }: {
  label: string; value: string; sub: string; icon: any; color: string
  trend?: 'up' | 'down' | 'flat'
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-gray-900">{value}</span>
            {trend === 'up' && <ArrowUp className="w-4 h-4 text-green-500" />}
            {trend === 'down' && <ArrowDown className="w-4 h-4 text-red-400" />}
          </div>
          <div className="text-xs font-semibold text-gray-700">{label}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function ForecastingPage() {
  const [loading, setLoading] = useState(true)
  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [dailyData, setDailyData] = useState<DailyRevenue[]>([])
  const [dayOfWeekStats, setDayOfWeekStats] = useState<DayOfWeekStats[]>([])
  const [hourStats, setHourStats] = useState<HourStats[]>([])
  const [monthlyTrend, setMonthlyTrend] = useState<{ label: string; value: number }[]>([])

  useEffect(() => { loadForecast() }, [])

  async function loadForecast() {
    setLoading(true)

    // Fetch last 6 months of paid bills
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const startDate = sixMonthsAgo.toISOString()

    const { data: bills } = await supabase
      .from('bills')
      .select('net_amount, created_at, payment_mode')
      .eq('status', 'paid')
      .gte('created_at', startDate)
      .order('created_at', { ascending: true })

    const allBills = bills || []

    if (allBills.length < 5) {
      setLoading(false)
      return
    }

    // ── Group by date ──────────────────────────────────────────
    const dailyMap = new Map<string, { amount: number; count: number }>()
    const hourMap = new Map<number, { revenue: number; count: number }>()
    const dowMap = new Map<number, { revenue: number; count: number; days: Set<string> }>()

    for (const bill of allBills) {
      const d = new Date(bill.created_at)
      const dateKey = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const hour = d.getHours()
      const dow = d.getDay() // 0=Sun, 1=Mon...

      const amt = Number(bill.net_amount || 0)

      // Daily
      const daily = dailyMap.get(dateKey) || { amount: 0, count: 0 }
      daily.amount += amt
      daily.count += 1
      dailyMap.set(dateKey, daily)

      // Hourly
      const hourEntry = hourMap.get(hour) || { revenue: 0, count: 0 }
      hourEntry.revenue += amt
      hourEntry.count += 1
      hourMap.set(hour, hourEntry)

      // Day of week
      const dowEntry = dowMap.get(dow) || { revenue: 0, count: 0, days: new Set() }
      dowEntry.revenue += amt
      dowEntry.count += 1
      dowEntry.days.add(dateKey)
      dowMap.set(dow, dowEntry)
    }

    // Convert to array
    const dailyArray: DailyRevenue[] = Array.from(dailyMap.entries())
      .map(([date, { amount, count }]) => ({ date, amount, count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    setDailyData(dailyArray)

    // ── Linear Regression on daily data ────────────────────────
    const points = dailyArray.map((d, i) => ({ x: i, y: d.amount }))
    const { slope, intercept, r2 } = linearRegression(points)

    // Predict next 30 days
    const lastIndex = points.length - 1
    let predictedMonthly = 0
    for (let i = 1; i <= 30; i++) {
      const predicted = Math.max(0, slope * (lastIndex + i) + intercept)
      predictedMonthly += predicted
    }

    // Current month stats
    const now = new Date()
    const currentMonth = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7)
    const currentMonthBills = dailyArray.filter(d => d.date.startsWith(currentMonth))
    const earnedSoFar = currentMonthBills.reduce((s, d) => s + d.amount, 0)
    const dayOfMonth = now.getDate()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const daysRemaining = daysInMonth - dayOfMonth

    // Average daily from recent 30 days
    const last30 = dailyArray.slice(-30)
    const avgDaily = last30.length > 0 ? last30.reduce((s, d) => s + d.amount, 0) / last30.length : 0
    const avgDailyPatients = last30.length > 0 ? last30.reduce((s, d) => s + d.count, 0) / last30.length : 0

    // Growth rate: compare last 30 days to previous 30 days
    const prev30 = dailyArray.slice(-60, -30)
    const prevAvg = prev30.length > 0 ? prev30.reduce((s, d) => s + d.amount, 0) / prev30.length : 0
    const growthRate = prevAvg > 0 ? ((avgDaily - prevAvg) / prevAvg) * 100 : 0

    // Confidence based on R² and data volume
    const confidenceLevel = r2 > 0.5 && dailyArray.length > 60 ? 'high'
      : r2 > 0.2 && dailyArray.length > 30 ? 'medium' : 'low'

    // ── Day of Week stats ──────────────────────────────────────
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dowStats: DayOfWeekStats[] = dayNames.map((day, i) => {
      const entry = dowMap.get(i)
      if (!entry || entry.days.size === 0) return { day, avgRevenue: 0, avgPatients: 0, dayIndex: i }
      return {
        day,
        avgRevenue: Math.round(entry.revenue / entry.days.size),
        avgPatients: Math.round(entry.count / entry.days.size),
        dayIndex: i,
      }
    })
    setDayOfWeekStats(dowStats)

    const busiestDay = dowStats.reduce((max, d) => d.avgRevenue > max.avgRevenue ? d : max, dowStats[0])

    // ── Hour stats ─────────────────────────────────────────────
    const hourArray: HourStats[] = []
    for (let h = 7; h <= 21; h++) {
      const entry = hourMap.get(h)
      const ampm = h >= 12 ? 'PM' : 'AM'
      const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h
      hourArray.push({
        hour: h,
        label: `${h12}${ampm}`,
        totalRevenue: entry?.revenue || 0,
        billCount: entry?.count || 0,
      })
    }
    setHourStats(hourArray)

    const peakHourEntry = hourArray.reduce((max, h) => h.totalRevenue > max.totalRevenue ? h : max, hourArray[0])

    // ── Monthly trend (last 6 months) ──────────────────────────
    const monthMap = new Map<string, number>()
    for (const d of dailyArray) {
      const monthKey = d.date.slice(0, 7) // YYYY-MM
      monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + d.amount)
    }
    const monthTrend = Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => {
        const [y, m] = key.split('-')
        const label = new Date(Number(y), Number(m) - 1).toLocaleDateString('en-IN', { month: 'short' })
        return { label, value }
      })
    setMonthlyTrend(monthTrend)

    // ── Set forecast ───────────────────────────────────────────
    setForecast({
      predictedMonthly: Math.round(earnedSoFar + (avgDaily * daysRemaining)),
      predictedDaily: Math.round(avgDaily),
      growthRate: Math.round(growthRate * 10) / 10,
      confidenceLevel,
      trendDirection: growthRate > 2 ? 'up' : growthRate < -2 ? 'down' : 'flat',
      busiestDay: busiestDay.day,
      peakHour: peakHourEntry.label,
      avgDailyRevenue: Math.round(avgDaily),
      avgDailyPatients: Math.round(avgDailyPatients),
      daysRemaining,
      earnedSoFar: Math.round(earnedSoFar),
      projectedRemaining: Math.round(avgDaily * daysRemaining),
    })

    setLoading(false)
  }

  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-100 to-blue-100 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Revenue Forecast</h1>
              <p className="text-sm text-gray-500">AI-predicted revenue based on last 6 months data</p>
            </div>
          </div>
          <button onClick={loadForecast} disabled={loading}
            className="btn-secondary flex items-center gap-2 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500">Analyzing 6 months of data...</p>
            </div>
          </div>
        )}

        {!loading && !forecast && (
          <div className="card p-12 text-center text-gray-400">
            <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Not enough data for forecasting</p>
            <p className="text-sm mt-1">Need at least 5 paid bills in the last 6 months</p>
          </div>
        )}

        {!loading && forecast && (
          <div className="space-y-6">

            {/* ── Main Prediction Cards ─────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <ForecastCard
                label="Predicted This Month"
                value={inr(forecast.predictedMonthly)}
                sub={`Earned ${inr(forecast.earnedSoFar)} + projected ${inr(forecast.projectedRemaining)}`}
                icon={Target}
                color="bg-purple-100 text-purple-600"
                trend={forecast.trendDirection}
              />
              <ForecastCard
                label="Avg Daily Revenue"
                value={inr(forecast.predictedDaily)}
                sub={`~${forecast.avgDailyPatients} patients/day`}
                icon={IndianRupee}
                color="bg-green-100 text-green-600"
              />
              <ForecastCard
                label="Growth Rate"
                value={`${forecast.growthRate > 0 ? '+' : ''}${forecast.growthRate}%`}
                sub={`vs previous month · Confidence: ${forecast.confidenceLevel}`}
                icon={TrendingUp}
                color={forecast.growthRate >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}
                trend={forecast.trendDirection}
              />
              <ForecastCard
                label="Busiest Day"
                value={forecast.busiestDay}
                sub={`Peak hour: ${forecast.peakHour}`}
                icon={Calendar}
                color="bg-amber-100 text-amber-600"
              />
            </div>

            {/* ── This Month Progress ──────────────────────────── */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-purple-500" />
                  This Month Progress
                </h2>
                <span className="text-xs text-gray-400">{forecast.daysRemaining} days remaining</span>
              </div>
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Earned: {inr(forecast.earnedSoFar)}</span>
                  <span>Target: {inr(forecast.predictedMonthly)}</span>
                </div>
                <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(100, (forecast.earnedSoFar / forecast.predictedMonthly) * 100)}%` }}
                  />
                </div>
                <div className="text-xs text-gray-400 mt-1 text-center">
                  {Math.round((forecast.earnedSoFar / forecast.predictedMonthly) * 100)}% achieved
                </div>
              </div>
            </div>

            {/* ── Two-column: Monthly Trend + Day of Week ──────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Monthly Revenue Trend */}
              <div className="card p-5">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  Monthly Revenue Trend
                </h2>
                {monthlyTrend.length > 0 ? (
                  <BarChart
                    data={monthlyTrend}
                    color="#8b5cf6"
                    formatValue={v => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
                    height={160}
                  />
                ) : (
                  <div className="text-center py-8 text-sm text-gray-400">No data</div>
                )}
              </div>

              {/* Day of Week */}
              <div className="card p-5">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-4">
                  <Calendar className="w-4 h-4 text-amber-600" />
                  Revenue by Day of Week
                </h2>
                <BarChart
                  data={dayOfWeekStats.map(d => ({ label: d.day, value: d.avgRevenue }))}
                  color="#f59e0b"
                  formatValue={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
                  height={140}
                />
                <div className="mt-2 text-xs text-gray-500 text-center">
                  Average revenue per {dayOfWeekStats.find(d => d.day === forecast.busiestDay)?.day || 'day'}:
                  <strong className="text-amber-700 ml-1">
                    {inr(dayOfWeekStats.find(d => d.day === forecast.busiestDay)?.avgRevenue || 0)}
                  </strong>
                </div>
              </div>
            </div>

            {/* ── Peak Hours ───────────────────────────────────── */}
            <div className="card p-5">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-green-600" />
                Revenue by Hour (When patients pay)
              </h2>
              <BarChart
                data={hourStats.map(h => ({ label: h.label, value: h.totalRevenue }))}
                color="#10b981"
                formatValue={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
                height={140}
              />
              <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                <div className="bg-green-50 rounded-lg p-2.5 text-center">
                  <div className="font-bold text-green-700">{forecast.peakHour}</div>
                  <div className="text-gray-500">Peak Hour</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-2.5 text-center">
                  <div className="font-bold text-blue-700">{forecast.avgDailyPatients}</div>
                  <div className="text-gray-500">Avg Patients/Day</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-2.5 text-center">
                  <div className="font-bold text-purple-700">{forecast.confidenceLevel}</div>
                  <div className="text-gray-500">Confidence</div>
                </div>
              </div>
            </div>

            {/* ── Actionable Insights ─────────────────────────── */}
            <div className="card p-5 bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-100">
              <h2 className="text-sm font-bold text-indigo-900 mb-3 flex items-center gap-2">
                💡 AI Insights & Recommendations
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-indigo-800">
                {forecast.trendDirection === 'up' && (
                  <div className="bg-white/60 rounded-lg p-3">
                    <strong>📈 Revenue Growing:</strong> Your clinic is growing at {forecast.growthRate}% per month.
                    At this rate, you&apos;ll earn {inr(Math.round(forecast.predictedMonthly * (1 + forecast.growthRate / 100)))} next month.
                  </div>
                )}
                {forecast.trendDirection === 'down' && (
                  <div className="bg-white/60 rounded-lg p-3">
                    <strong>📉 Revenue Declining:</strong> Revenue dropped {Math.abs(forecast.growthRate)}% vs last month.
                    Focus on follow-up reminders and patient retention.
                  </div>
                )}
                <div className="bg-white/60 rounded-lg p-3">
                  <strong>📅 Best Day:</strong> {forecast.busiestDay} generates the most revenue.
                  Consider keeping extra staff and scheduling complex procedures on this day.
                </div>
                <div className="bg-white/60 rounded-lg p-3">
                  <strong>⏰ Peak Hour:</strong> {forecast.peakHour} is your busiest billing time.
                  Avoid scheduling meetings or breaks during this hour.
                </div>
                {forecast.avgDailyPatients > 0 && (
                  <div className="bg-white/60 rounded-lg p-3">
                    <strong>👥 Patient Volume:</strong> You see ~{forecast.avgDailyPatients} patients/day.
                    {forecast.avgDailyPatients < 20
                      ? ' Focus on appointment reminders to increase walk-ins.'
                      : ' Great volume! Consider hiring support staff.'}
                  </div>
                )}
                {dayOfWeekStats.some(d => d.day === 'Sun' && d.avgRevenue === 0) && (
                  <div className="bg-white/60 rounded-lg p-3">
                    <strong>🏖️ Closed Sundays:</strong> No revenue on Sundays detected.
                    Consider emergency/half-day OPD for urgent cases.
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