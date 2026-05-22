'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Calendar, FileText, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getIndiaToday } from '@/lib/utils'

interface LastEncounterInfo {
  encounter_date: string | null
  diagnosis: string | null
  chief_complaint: string | null
}

interface LastPrescriptionInfo {
  medications: unknown[]
  follow_up_date: string | null
}

export default function ReturningPatientBanner({ patientId }: { patientId: string }) {
  const router = useRouter()
  const [encounter, setEncounter] = useState<LastEncounterInfo | null>(null)
  const [prescription, setPrescription] = useState<LastPrescriptionInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!patientId) {
      setLoading(false)
      return
    }

    async function fetchPatientHistory() {
      setLoading(true)
      try {
        const [encounterResult, prescriptionResult] = await Promise.all([
          supabase
            .from('encounters')
            .select('encounter_date, diagnosis, chief_complaint')
            .eq('patient_id', patientId)
            .order('encounter_date', { ascending: false })
            .limit(1)
            .single(),
          supabase
            .from('prescriptions')
            .select('medications, follow_up_date')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single(),
        ])

        if (!encounterResult.error && encounterResult.data) {
          setEncounter({
            encounter_date: encounterResult.data.encounter_date,
            diagnosis: encounterResult.data.diagnosis,
            chief_complaint: encounterResult.data.chief_complaint,
          })
        }

        if (!prescriptionResult.error && prescriptionResult.data) {
          setPrescription({
            medications: Array.isArray(prescriptionResult.data.medications)
              ? prescriptionResult.data.medications
              : [],
            follow_up_date: prescriptionResult.data.follow_up_date,
          })
        }
      } catch (err) {
        console.error('[ReturningPatientBanner] Error:', err)
      }
      setLoading(false)
    }

    fetchPatientHistory()
  }, [patientId])

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function isFollowUpMissed(followUpDate: string | null): boolean {
    if (!followUpDate) return false
    const today = getIndiaToday()
    return followUpDate < today
  }

  if (loading) return null

  // New patient (no history) — render nothing
  if (!encounter) return null

  const medCount = prescription?.medications?.length || 0
  const diagnosis = encounter.diagnosis || ''
  const followUpDate = prescription?.follow_up_date || null
  const missed = isFollowUpMissed(followUpDate)

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-lg px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <RefreshCw className="w-4 h-4 text-indigo-500 flex-shrink-0" />
          <div className="text-xs text-indigo-800 truncate">
            <span className="font-semibold">Returning patient</span>
            <span className="text-indigo-600 mx-1">—</span>
            <span className="text-indigo-600">
              Last visit: {formatDate(encounter.encounter_date)}
            </span>
            {diagnosis && (
              <>
                <span className="text-indigo-400 mx-1">|</span>
                <span className="text-indigo-600">
                  Dx: {diagnosis.length > 25 ? diagnosis.substring(0, 25) + '...' : diagnosis}
                </span>
              </>
            )}
            {medCount > 0 && (
              <>
                <span className="text-indigo-400 mx-1">|</span>
                <span className="flex items-center gap-0.5 inline-flex">
                  <FileText className="w-3 h-3 text-indigo-400" />
                  <span className="text-indigo-600">{medCount} medications</span>
                </span>
              </>
            )}
            {followUpDate && (
              <>
                <span className="text-indigo-400 mx-1">|</span>
                <span className="flex items-center gap-0.5 inline-flex">
                  <Calendar className="w-3 h-3 text-indigo-400" />
                  <span className={missed ? 'text-red-600 font-medium' : 'text-indigo-600'}>
                    Follow-up {missed ? 'was due' : 'due'}: {formatDate(followUpDate)}
                  </span>
                  {missed && (
                    <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 rounded">
                      MISSED
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        {/* View History Link */}
        <button
          onClick={() => router.push(`/patients/${patientId}`)}
          className="flex items-center gap-1 ml-3 px-2.5 py-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800 bg-white border border-indigo-200 rounded-md hover:bg-indigo-50 transition-colors flex-shrink-0"
        >
          View Full History
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}
