'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, Clock, IndianRupee, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getIndiaToday } from '@/lib/utils'

interface StaleWaitingPatient {
  id: string
  patient_name: string
  token_number: number
  created_at: string
}

export default function InconsistencyAlerts() {
  const [staleWaiting, setStaleWaiting] = useState<StaleWaitingPatient[]>([])
  const [pendingBillsCount, setPendingBillsCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAlerts()
  }, [])

  async function fetchAlerts() {
    setLoading(true)
    const today = getIndiaToday()
    const now = new Date()
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()

    try {
      const [waitingResult, billsResult] = await Promise.all([
        // (a) Patients waiting > 2 hours today
        supabase
          .from('opd_queue')
          .select('id, patient_name, token_number, created_at')
          .in('status', ['waiting', 'in_progress'])
          .eq('queue_date', today)
          .lt('created_at', twoHoursAgo)
          .order('created_at', { ascending: true }),

        // (b) Bills pending > 3 days (count only)
        supabase
          .from('bills')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .lt('createdat', threeDaysAgo),
      ])

      if (!waitingResult.error && waitingResult.data) {
        setStaleWaiting(waitingResult.data as StaleWaitingPatient[])
      }

      if (!billsResult.error && billsResult.count !== null) {
        setPendingBillsCount(billsResult.count)
      }
    } catch (err) {
      console.error('[InconsistencyAlerts] Error fetching alerts:', err)
    }
    setLoading(false)
  }

  function getWaitTime(createdAt: string): string {
    const created = new Date(createdAt)
    const now = new Date()
    const diffMinutes = Math.floor((now.getTime() - created.getTime()) / (1000 * 60))
    if (diffMinutes < 60) return `${diffMinutes}m`
    const hours = Math.floor(diffMinutes / 60)
    const mins = diffMinutes % 60
    return `${hours}h ${mins}m`
  }

  if (loading) return null

  // If no issues found, render nothing
  if (staleWaiting.length === 0 && pendingBillsCount === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {/* Stale Waiting Patients */}
      {staleWaiting.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-amber-800">
              {staleWaiting.length} patient{staleWaiting.length !== 1 ? 's' : ''} waiting &gt;2 hours
            </h3>
          </div>
          <div className="space-y-1.5">
            {staleWaiting.slice(0, 5).map(patient => (
              <div
                key={patient.id}
                className="flex items-center justify-between text-xs bg-white/60 rounded-md px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 flex items-center justify-center bg-amber-100 rounded text-[10px] font-bold text-amber-700">
                    {patient.token_number}
                  </span>
                  <span className="text-gray-700 font-medium">
                    {patient.patient_name || 'Unknown'}
                  </span>
                </div>
                <span className="text-amber-600 font-medium">
                  {getWaitTime(patient.created_at)}
                </span>
              </div>
            ))}
            {staleWaiting.length > 5 && (
              <div className="text-[10px] text-amber-500 text-center pt-1">
                +{staleWaiting.length - 5} more patients waiting
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pending Bills > 3 Days */}
      {pendingBillsCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <h3 className="text-sm font-bold text-red-800">
              {pendingBillsCount} bill{pendingBillsCount !== 1 ? 's' : ''} pending &gt;3 days
            </h3>
          </div>
          <p className="text-xs text-red-600 mt-1 ml-6">
            Follow up with patients for payment collection to avoid revenue loss.
          </p>
        </div>
      )}
    </div>
  )
}