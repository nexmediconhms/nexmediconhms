'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getIndiaToday } from '@/lib/utils'
import {
  Scissors, Plus, ChevronLeft, ChevronRight, Calendar,
  CheckCircle, AlertTriangle, Clock,
} from 'lucide-react'

interface OTSchedule {
  id: string
  patient_id: string
  patient_name: string
  mrn: string
  surgery_name: string
  surgery_date: string
  start_time: string
  end_time: string
  surgeon: string
  ot_room: string
  status: string
  priority: string
  consent_taken: boolean
  fasting_confirmed: boolean
  blood_arranged: boolean
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-blue-50 border-blue-200 text-blue-800',
  in_progress: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  completed: 'bg-green-50 border-green-200 text-green-700',
  cancelled: 'bg-gray-50 border-gray-200 text-gray-500',
  postponed: 'bg-orange-50 border-orange-200 text-orange-700',
}

const PRIORITY_DOTS: Record<string, string> = {
  elective: 'bg-gray-400',
  urgent: 'bg-orange-500',
  emergency: 'bg-red-500',
}

export default function OTWeekPage() {
  const [date, setDate] = useState(getIndiaToday())
  const [weekData, setWeekData] = useState<Record<string, OTSchedule[]>>({})
  const [loading, setLoading] = useState(true)

  const today = getIndiaToday()

  // Calculate Monday-Sunday for the week containing `date`
  function getWeekDays(baseDate: string): string[] {
    const days: string[] = []
    const d = new Date(baseDate)
    const dow = d.getDay()
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)) // Monday
    for (let i = 0; i < 7; i++) {
      days.push(d.toISOString().split('T')[0])
      d.setDate(d.getDate() + 1)
    }
    return days
  }

  const weekDays = getWeekDays(date)

  useEffect(() => {
    async function loadWeek() {
      setLoading(true)
      const { data } = await supabase
        .from('ot_schedules')
        .select('*')
        .gte('surgery_date', weekDays[0])
        .lte('surgery_date', weekDays[6])
        .neq('status', 'cancelled')
        .order('start_time')

      const grouped: Record<string, OTSchedule[]> = {}
      weekDays.forEach(d => { grouped[d] = [] })
      ;(data || []).forEach((s: any) => {
        if (grouped[s.surgery_date]) grouped[s.surgery_date].push(s)
      })
      setWeekData(grouped)
      setLoading(false)
    }
    loadWeek()
  }, [date])

  function prevWeek() {
    const d = new Date(date)
    d.setDate(d.getDate() - 7)
    setDate(d.toISOString().split('T')[0])
  }

  function nextWeek() {
    const d = new Date(date)
    d.setDate(d.getDate() + 7)
    setDate(d.toISOString().split('T')[0])
  }

  const totalThisWeek = Object.values(weekData).reduce((sum, arr) => sum + arr.length, 0)

  return (
    <AppShell>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Scissors className="w-6 h-6 text-purple-600" /> OT — Week View
            </h1>
            <p className="text-sm text-gray-500">
              {formatDate(weekDays[0])} — {formatDate(weekDays[6])} · {totalThisWeek} surgeries
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/ot-schedule" className="btn-secondary text-xs flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> Day View
            </Link>
            <Link href="/ot-schedule?view=new" className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Schedule
            </Link>
          </div>
        </div>

        {/* Week Navigation */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={prevWeek} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <button onClick={() => setDate(today)} className="text-xs text-blue-600 font-medium hover:underline">
            This Week
          </button>
          <button onClick={nextWeek} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
          <span className="text-xs text-gray-400 ml-2">
            Week of {new Date(weekDays[0]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
        </div>

        {/* Week Grid */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading week…</div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map(day => {
              const daySchedules = weekData[day] || []
              const isToday = day === today
              const dayName = new Date(day).toLocaleDateString('en-IN', { weekday: 'short' })
              const dayNum = new Date(day).getDate()
              const monthStr = new Date(day).toLocaleDateString('en-IN', { month: 'short' })

              return (
                <div key={day} className={`border rounded-xl p-2 min-h-[180px] transition-colors ${isToday ? 'border-purple-300 bg-purple-50/30' : 'border-gray-200 hover:border-gray-300'}`}>
                  {/* Day header */}
                  <div className={`text-center mb-2 pb-2 border-b ${isToday ? 'border-purple-200' : 'border-gray-100'}`}>
                    <div className="text-xs text-gray-500 uppercase">{dayName}</div>
                    <div className={`text-xl font-bold ${isToday ? 'text-purple-700' : 'text-gray-700'}`}>{dayNum}</div>
                    <div className="text-[10px] text-gray-400">{monthStr}</div>
                  </div>

                  {/* Surgeries */}
                  {daySchedules.length === 0 ? (
                    <div className="text-xs text-gray-300 text-center py-4">No OT</div>
                  ) : (
                    <div className="space-y-1.5">
                      {daySchedules.map(s => (
                        <Link key={s.id} href={`/ot-schedule`}
                          className={`block text-xs p-2 rounded-lg border cursor-pointer hover:opacity-90 transition-opacity ${STATUS_STYLES[s.status] || 'bg-gray-50 border-gray-200'}`}>
                          {/* Time + Priority dot */}
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOTS[s.priority] || 'bg-gray-400'}`}></span>
                            <span className="font-bold text-[11px]">{s.start_time}</span>
                          </div>
                          {/* Surgery name (truncated) */}
                          <div className="font-semibold truncate leading-tight">
                            {s.surgery_name.split('(')[0].trim().slice(0, 15)}
                          </div>
                          {/* Patient */}
                          <div className="text-[10px] truncate opacity-70 mt-0.5">
                            {s.patient_name}
                          </div>
                          {/* Surgeon */}
                          <div className="text-[10px] truncate opacity-60">
                            {s.surgeon.split(' ').slice(0, 2).join(' ')}
                          </div>
                          {/* Checklist indicators */}
                          <div className="flex gap-1 mt-1">
                            {s.consent_taken ? (
                              <CheckCircle className="w-2.5 h-2.5 text-green-500" />
                            ) : (
                              <AlertTriangle className="w-2.5 h-2.5 text-red-400" />
                            )}
                            {s.fasting_confirmed ? (
                              <CheckCircle className="w-2.5 h-2.5 text-green-500" />
                            ) : (
                              <Clock className="w-2.5 h-2.5 text-gray-300" />
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Legend */}
        <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <span className="font-semibold">Legend:</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400"></span> Elective</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500"></span> Urgent</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> Emergency</span>
          <span className="mx-2">|</span>
          <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-500" /> Consent+Fasting OK</span>
          <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-red-400" /> Missing consent</span>
        </div>
      </div>
    </AppShell>
  )
}
