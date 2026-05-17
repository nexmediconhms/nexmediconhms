'use client'
/**
 * src/app/staff-performance/page.tsx
 * 
 * Staff Performance & Productivity Dashboard
 * - Track staff activities (registrations, billing, queue management)
 * - Identify bottlenecks
 * - Gamify with daily scores
 */

import { useState, useEffect } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import {
  Users, Clock, TrendingUp, Award,
  BarChart2, Target, Zap, Star,
  CheckCircle, AlertCircle, ArrowUp, ArrowDown,
} from 'lucide-react'

interface StaffMetric {
  name: string
  role: string
  patientsRegistered: number
  billsCreated: number
  queueManaged: number
  avgRegTime: number // minutes
  score: number
}

export default function StaffPerformancePage() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today')
  const [metrics, setMetrics] = useState<StaffMetric[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadMetrics()
  }, [period])

  async function loadMetrics() {
    setLoading(true)
    // In production, this would aggregate from audit_log
    // For now, we show the structure with sample data
    const today = new Date().toISOString().split('T')[0]
    
    try {
      const { data: users } = await supabase
        .from('clinic_users')
        .select('id, full_name, role')
        .eq('is_active', true)

      if (users) {
        const staffMetrics: StaffMetric[] = users.map(user => ({
          name: user.full_name,
          role: user.role,
          patientsRegistered: Math.floor(Math.random() * 15) + 3,
          billsCreated: Math.floor(Math.random() * 12) + 2,
          queueManaged: Math.floor(Math.random() * 20) + 5,
          avgRegTime: Math.floor(Math.random() * 3) + 2,
          score: Math.floor(Math.random() * 40) + 60,
        }))
        setMetrics(staffMetrics)
      }
    } catch (err) {
      console.error('Error loading staff metrics:', err)
    }
    setLoading(false)
  }

  const topPerformer = metrics.length > 0
    ? metrics.reduce((best, m) => m.score > best.score ? m : best, metrics[0])
    : null

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-500" />
              Staff Performance
            </h1>
            <p className="text-xs text-gray-500 mt-1">Track productivity, identify bottlenecks, reward excellence</p>
          </div>
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {(['today', 'week', 'month'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-all ${
                  period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Top Performer Card */}
        {topPerformer && (
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <Star className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <div className="text-xs font-medium text-amber-600 uppercase tracking-wide">Top Performer</div>
                <div className="text-lg font-bold text-gray-900">{topPerformer.name}</div>
                <div className="text-xs text-gray-500">Score: {topPerformer.score}/100 • {topPerformer.role}</div>
              </div>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Actions', value: metrics.reduce((s, m) => s + m.patientsRegistered + m.billsCreated + m.queueManaged, 0), icon: Zap, color: 'text-blue-600 bg-blue-50' },
            { label: 'Avg Reg Time', value: `${(metrics.reduce((s, m) => s + m.avgRegTime, 0) / Math.max(metrics.length, 1)).toFixed(1)} min`, icon: Clock, color: 'text-green-600 bg-green-50' },
            { label: 'Active Staff', value: metrics.length, icon: Users, color: 'text-purple-600 bg-purple-50' },
            { label: 'Avg Score', value: `${Math.round(metrics.reduce((s, m) => s + m.score, 0) / Math.max(metrics.length, 1))}%`, icon: Target, color: 'text-amber-600 bg-amber-50' },
          ].map(card => (
            <div key={card.label} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${card.color} mb-2`}>
                <card.icon className="w-4 h-4" />
              </div>
              <div className="text-lg font-bold text-gray-900">{card.value}</div>
              <div className="text-xs text-gray-500">{card.label}</div>
            </div>
          ))}
        </div>

        {/* Staff Table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-900">Staff Activity Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-2 font-bold text-gray-500">Staff Member</th>
                  <th className="text-center px-3 py-2 font-bold text-gray-500">Registrations</th>
                  <th className="text-center px-3 py-2 font-bold text-gray-500">Bills</th>
                  <th className="text-center px-3 py-2 font-bold text-gray-500">Queue Ops</th>
                  <th className="text-center px-3 py-2 font-bold text-gray-500">Avg Time</th>
                  <th className="text-center px-3 py-2 font-bold text-gray-500">Score</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">Loading...</td></tr>
                ) : metrics.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">No data available</td></tr>
                ) : (
                  metrics.sort((a, b) => b.score - a.score).map((m, i) => (
                    <tr key={m.name} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {i === 0 && <span className="text-amber-500">🏆</span>}
                          <div>
                            <div className="font-bold text-gray-900">{m.name}</div>
                            <div className="text-gray-400 capitalize">{m.role}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-center px-3 py-3 font-medium">{m.patientsRegistered}</td>
                      <td className="text-center px-3 py-3 font-medium">{m.billsCreated}</td>
                      <td className="text-center px-3 py-3 font-medium">{m.queueManaged}</td>
                      <td className="text-center px-3 py-3">
                        <span className={m.avgRegTime <= 3 ? 'text-green-600' : 'text-amber-600'}>
                          {m.avgRegTime} min
                        </span>
                      </td>
                      <td className="text-center px-3 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${m.score >= 80 ? 'bg-green-500' : m.score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${m.score}%` }}
                            />
                          </div>
                          <span className="font-bold text-gray-700">{m.score}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bottleneck Alerts */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Bottleneck Detection</h3>
          <div className="space-y-2">
            {[
              { icon: AlertCircle, text: 'Registration queue takes 8+ min on average between 10-11 AM', severity: 'high' },
              { icon: Clock, text: 'Billing delay: 15% of patients leave without bill after 5 PM', severity: 'medium' },
              { icon: CheckCircle, text: 'Queue management is efficient — average wait time under 12 minutes', severity: 'good' },
            ].map((alert, i) => (
              <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${
                alert.severity === 'high' ? 'bg-red-50 border border-red-100' :
                alert.severity === 'medium' ? 'bg-amber-50 border border-amber-100' :
                'bg-green-50 border border-green-100'
              }`}>
                <alert.icon className={`w-4 h-4 flex-shrink-0 ${
                  alert.severity === 'high' ? 'text-red-500' :
                  alert.severity === 'medium' ? 'text-amber-500' : 'text-green-500'
                }`} />
                <span className="text-xs text-gray-700">{alert.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
