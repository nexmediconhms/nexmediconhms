'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Calendar, Phone, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getIndiaToday } from '@/lib/utils'

interface MissedFollowUp {
  id: string
  patient_id: string
  recommended_date: string
  patients: {
    fullname?: string
    full_name?: string
    mobile: string | null
    mrn: string | null
  } | null
}

export default function MissedFollowUpCard() {
  const router = useRouter()
  const [missedFollowUps, setMissedFollowUps] = useState<MissedFollowUp[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMissedFollowUps()
  }, [])

  async function fetchMissedFollowUps() {
    setLoading(true)
    const today = getIndiaToday()

    try {
      // Declare variables first to avoid TypeScript type inference locks
      let data: any[] | null = null
      let error: any = null

      // FIX: Try 'full_name' first (snake_case schema)
      const primaryQuery = await supabase
        .from('follow_ups')
        .select('id, patient_id, recommended_date, patients(full_name, mobile, mrn)')
        .eq('status', 'pending')
        .lt('recommended_date', today)
        .order('recommended_date', { ascending: true })
        .limit(10)

      data = primaryQuery.data
      error = primaryQuery.error

      // If 'full_name' column doesn't exist, try 'fullname' fallback
      if (error && (error.message?.includes('does not exist') || error.code === 'PGRST204')) {
        const fallback = await supabase
          .from('follow_ups')
          .select('id, patient_id, recommended_date, patients(fullname, mobile, mrn)')
          .eq('status', 'pending')
          .lt('recommended_date', today)
          .order('recommended_date', { ascending: true })
          .limit(10)
        data = fallback.data
        error = fallback.error
      }

      if (error) {
        console.error('[MissedFollowUpCard] Error:', error.message)
        setMissedFollowUps([])
      } else {
        setMissedFollowUps((data || []) as unknown as MissedFollowUp[])
      }
    } catch (err) {
      console.error('[MissedFollowUpCard] Unexpected error:', err)
      setMissedFollowUps([])
    }
    setLoading(false)
  }

  function getDaysOverdue(dateStr: string): number {
    const today = new Date(getIndiaToday())
    const recommended = new Date(dateStr)
    const diffTime = today.getTime() - recommended.getTime()
    return Math.floor(diffTime / (1000 * 60 * 60 * 24))
  }

  function formatOverdue(days: number): string {
    if (days === 1) return '1 day overdue'
    if (days < 7) return `${days} days overdue`
    const weeks = Math.floor(days / 7)
    return weeks === 1 ? '1 week overdue' : `${weeks} weeks overdue`
  }

  function getWhatsAppLink(mobile: string | null, patientName: string, daysOverdue: number): string {
    if (!mobile) return '#'
    const cleanMobile = mobile.replace(/[^0-9+]/g, '')
    const phoneNumber = cleanMobile.startsWith('+') ? cleanMobile.slice(1) : (cleanMobile.startsWith('91') ? cleanMobile : `91${cleanMobile}`)
    const message = encodeURIComponent(
      `Dear ${patientName},\n\nThis is a reminder that your follow-up visit was due ${daysOverdue} day(s) ago. ` +
      `Please schedule your appointment at the earliest.\n\n` +
      `Contact us to book your slot.\nThank you.`
    )
    return `https://wa.me/${phoneNumber}?text=${message}`
  }

  if (loading) return null

  // If no missed follow-ups, render nothing
  if (missedFollowUps.length === 0) return null

  return (
    <div className="bg-white border border-orange-200 rounded-xl p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-orange-100 rounded-lg flex items-center justify-center">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Missed Follow-ups</h3>
            <p className="text-[10px] text-gray-500">Patients overdue for visit</p>
          </div>
        </div>
        <span className="flex items-center justify-center w-6 h-6 bg-orange-600 text-white text-xs font-bold rounded-full">
          {missedFollowUps.length}
        </span>
      </div>

      {/* List */}
      <div className="space-y-1.5">
        {missedFollowUps.map(followUp => {
          // Cleaned up syntax thanks to updated interface
          const patientName = followUp.patients?.full_name || followUp.patients?.fullname || 'Unknown Patient'
          const mobile = followUp.patients?.mobile || null
          const mrn = followUp.patients?.mrn || ''
          const daysOverdue = getDaysOverdue(followUp.recommended_date)
          const whatsappLink = getWhatsAppLink(mobile, patientName, daysOverdue)

          return (
            <div
              key={followUp.id}
              className="flex items-center justify-between bg-orange-50/50 border border-orange-100 rounded-lg px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-800 truncate">
                    {patientName}
                  </span>
                  {mrn && (
                    <span className="text-[10px] text-gray-400">{mrn}</span>
                  )}
                </div>
                <span className={`text-[10px] font-medium ${
                  daysOverdue > 7 ? 'text-red-600' : 'text-orange-600'
                }`}>
                  {formatOverdue(daysOverdue)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                {/* WhatsApp reminder */}
                {mobile && (
                  <a
                    href={whatsappLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-md bg-green-100 hover:bg-green-200 text-green-700 transition-colors"
                    title="Send WhatsApp reminder"
                  >
                    <Phone className="w-3 h-3" />
                  </a>
                )}

                {/* Reschedule link */}
                <button
                  onClick={() => router.push('/appointments')}
                  className="p-1.5 rounded-md bg-blue-100 hover:bg-blue-200 text-blue-700 transition-colors"
                  title="Reschedule appointment"
                >
                  <Calendar className="w-3 h-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* View all link */}
      {missedFollowUps.length >= 10 && (
        <button
          onClick={() => router.push('/reminders')}
          className="mt-2 w-full flex items-center justify-center gap-1 text-xs text-orange-600 hover:text-orange-800 font-medium py-1.5"
        >
          View all missed follow-ups
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}