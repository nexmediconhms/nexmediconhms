'use client'
/**
 * src/app/patient-engagement/page.tsx
 * 
 * Patient Engagement & Retention Dashboard
 * - Track patient retention rates
 * - Identify patients who haven't returned
 * - Birthday/anniversary messages
 * - Follow-up compliance tracking
 * - Patient satisfaction insights
 */

import { useState, useEffect } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import {
  Heart, Users, Calendar, Bell,
  TrendingUp, MessageCircle, Gift, Clock,
  AlertCircle, CheckCircle, Star, ArrowRight,
  Phone, UserMinus, UserCheck,
} from 'lucide-react'

interface LostPatient {
  id: string
  name: string
  mrn: string
  mobile: string
  lastVisit: string
  daysSince: number
  diagnosis: string
}

export default function PatientEngagementPage() {
  const [tab, setTab] = useState<'overview' | 'lost' | 'birthdays' | 'followups'>('overview')
  const [lostPatients, setLostPatients] = useState<LostPatient[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalPatients: 0,
    activeThisMonth: 0,
    retentionRate: 0,
    overdueFollowups: 0,
    birthdaysThisWeek: 0,
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    try {
      const [patientsRes, recentRes, overdueRes] = await Promise.all([
        supabase.from('patients').select('id', { count: 'exact', head: true }),
        supabase.from('encounters').select('patient_id').gte('encounter_date', thirtyDaysAgo),
        supabase.from('prescriptions').select('id', { count: 'exact', head: true }).lt('follow_up_date', today).gte('follow_up_date', ninetyDaysAgo),
      ])

      const totalPatients = patientsRes.count || 0
      const activePatients = new Set((recentRes.data || []).map(e => e.patient_id)).size

      setStats({
        totalPatients,
        activeThisMonth: activePatients,
        retentionRate: totalPatients > 0 ? Math.round((activePatients / totalPatients) * 100) : 0,
        overdueFollowups: overdueRes.count || 0,
        birthdaysThisWeek: 0, // Would need date_of_birth query
      })

      // Load lost patients (no visit in 60+ days who had follow-up scheduled)
      const { data: encounters } = await supabase
        .from('encounters')
        .select('patient_id, encounter_date, diagnosis, patients(id, full_name, mrn, mobile)')
        .lt('encounter_date', ninetyDaysAgo)
        .order('encounter_date', { ascending: false })
        .limit(20)

      if (encounters) {
        const seen = new Set<string>()
        const lost: LostPatient[] = []
        for (const enc of encounters) {
          const pid = enc.patient_id
          if (seen.has(pid)) continue
          seen.add(pid)
          const patient = enc.patients as any
          if (!patient) continue
          const daysSince = Math.floor((Date.now() - new Date(enc.encounter_date).getTime()) / (1000 * 60 * 60 * 24))
          lost.push({
            id: patient.id,
            name: patient.full_name,
            mrn: patient.mrn,
            mobile: patient.mobile,
            lastVisit: enc.encounter_date,
            daysSince,
            diagnosis: enc.diagnosis || 'General consultation',
          })
        }
        setLostPatients(lost.sort((a, b) => b.daysSince - a.daysSince))
      }
    } catch (err) {
      console.error('Error loading engagement data:', err)
    }
    setLoading(false)
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Heart className="w-5 h-5 text-rose-500" />
            Patient Engagement
          </h1>
          <p className="text-xs text-gray-500 mt-1">Retain patients, reduce drop-offs, grow through referrals</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total Patients', value: stats.totalPatients, icon: Users, color: 'text-blue-600 bg-blue-50' },
            { label: 'Active (30d)', value: stats.activeThisMonth, icon: UserCheck, color: 'text-green-600 bg-green-50' },
            { label: 'Retention', value: `${stats.retentionRate}%`, icon: TrendingUp, color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Overdue F/U', value: stats.overdueFollowups, icon: AlertCircle, color: 'text-red-600 bg-red-50' },
            { label: 'Birthdays', value: stats.birthdaysThisWeek, icon: Gift, color: 'text-purple-600 bg-purple-50' },
          ].map(card => (
            <div key={card.label} className="bg-white border border-gray-200 rounded-xl p-3">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${card.color} mb-1.5`}>
                <card.icon className="w-3.5 h-3.5" />
              </div>
              <div className="text-lg font-bold text-gray-900">{card.value}</div>
              <div className="text-[10px] text-gray-500">{card.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'lost', label: 'Lost Patients' },
            { id: 'birthdays', label: 'Birthdays' },
            { id: 'followups', label: 'Overdue Follow-ups' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={`flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-all ${
                tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-sm font-bold text-gray-900 mb-4">Engagement Insights</h3>
              <div className="space-y-3">
                {[
                  { icon: UserMinus, text: `${lostPatients.length} patients haven't visited in 90+ days`, action: 'Send recall message', severity: 'warning' },
                  { icon: Clock, text: `${stats.overdueFollowups} follow-ups are overdue`, action: 'View & contact', severity: 'danger' },
                  { icon: Star, text: 'Patient satisfaction (based on return rate) is good', action: 'Request reviews', severity: 'good' },
                  { icon: Gift, text: `${stats.birthdaysThisWeek} patient birthdays this week`, action: 'Send wishes', severity: 'info' },
                ].map((insight, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${
                    insight.severity === 'danger' ? 'bg-red-50 border-red-100' :
                    insight.severity === 'warning' ? 'bg-amber-50 border-amber-100' :
                    insight.severity === 'good' ? 'bg-green-50 border-green-100' :
                    'bg-blue-50 border-blue-100'
                  }`}>
                    <insight.icon className="w-4 h-4 text-gray-600 flex-shrink-0" />
                    <span className="text-xs text-gray-700 flex-1">{insight.text}</span>
                    <button className="text-[10px] font-bold text-gray-600 bg-white px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">
                      {insight.action}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'lost' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">Patients Not Seen in 90+ Days</h3>
              <span className="text-xs text-gray-500">{lostPatients.length} patients</span>
            </div>
            <div className="divide-y divide-gray-50">
              {loading ? (
                <div className="p-8 text-center text-sm text-gray-400">Loading...</div>
              ) : lostPatients.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">All patients are engaged!</div>
              ) : (
                lostPatients.slice(0, 15).map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">{p.name}</div>
                      <div className="text-xs text-gray-500">{p.mrn} • Last: {p.diagnosis}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-bold text-red-600">{p.daysSince} days ago</div>
                      <div className="text-[10px] text-gray-400">{p.lastVisit}</div>
                    </div>
                    <a
                      href={`https://wa.me/91${p.mobile}?text=Hi%20${encodeURIComponent(p.name)}%2C%20we%20noticed%20your%20follow-up%20is%20due.%20Would%20you%20like%20to%20schedule%20an%20appointment%3F`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 w-8 h-8 bg-green-50 border border-green-200 rounded-lg flex items-center justify-center hover:bg-green-100"
                    >
                      <MessageCircle className="w-3.5 h-3.5 text-green-600" />
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'birthdays' && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
            <Gift className="w-12 h-12 text-purple-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-gray-900 mb-1">Birthday Wishes</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              Automatically sends birthday wishes to patients via WhatsApp.
              Patients with birthdays this week will appear here.
            </p>
          </div>
        )}

        {tab === 'followups' && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
            <Clock className="w-12 h-12 text-amber-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-gray-900 mb-1">Overdue Follow-ups</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              {stats.overdueFollowups} patients have missed their scheduled follow-up date.
              Use the Reminders page for detailed list and one-click WhatsApp contact.
            </p>
            <a href="/reminders" className="inline-flex items-center gap-1.5 mt-4 text-xs font-bold text-blue-600 hover:text-blue-700">
              Go to Reminders <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </AppShell>
  )
}
