'use client'

import { useState, useEffect } from 'react'
import { Copy, Pill, Stethoscope, CheckCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Medication {
  drug: string
  dose: string
  route: string
  frequency: string
  duration: string
  instructions: string
}

interface CopyFromLastVisitProps {
  patientId: string
  onCopyMedications: (meds: Medication[]) => void
  onCopyDiagnosis?: (diagnosis: string) => void
}

interface LastPrescriptionData {
  medications: Medication[]
  advice: string | null
  dietary_advice: string | null
  follow_up_date: string | null
  encounter_id: string | null
}

interface LastEncounterData {
  diagnosis: string | null
  encounter_date: string | null
  chief_complaint: string | null
}

export default function CopyFromLastVisit({ patientId, onCopyMedications, onCopyDiagnosis }: CopyFromLastVisitProps) {
  const [lastPrescription, setLastPrescription] = useState<LastPrescriptionData | null>(null)
  const [lastEncounter, setLastEncounter] = useState<LastEncounterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [medsCopied, setMedsCopied] = useState(false)
  const [diagnosisCopied, setDiagnosisCopied] = useState(false)

  useEffect(() => {
    if (!patientId) {
      setLoading(false)
      return
    }

    async function fetchLastVisitData() {
      setLoading(true)
      try {
        const [prescriptionResult, encounterResult] = await Promise.all([
          supabase
            .from('prescriptions')
            .select('medications, advice, dietary_advice, follow_up_date, encounter_id')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single(),
          supabase
            .from('encounters')
            .select('diagnosis, encounter_date, chief_complaint')
            .eq('patient_id', patientId)
            .order('encounter_date', { ascending: false })
            .limit(1)
            .single(),
        ])

        if (!prescriptionResult.error && prescriptionResult.data) {
          const rxData = prescriptionResult.data
          setLastPrescription({
            medications: Array.isArray(rxData.medications) ? rxData.medications : [],
            advice: rxData.advice,
            dietary_advice: rxData.dietary_advice,
            follow_up_date: rxData.follow_up_date,
            encounter_id: rxData.encounter_id,
          })
        }

        if (!encounterResult.error && encounterResult.data) {
          setLastEncounter({
            diagnosis: encounterResult.data.diagnosis,
            encounter_date: encounterResult.data.encounter_date,
            chief_complaint: encounterResult.data.chief_complaint,
          })
        }
      } catch (err) {
        console.error('[CopyFromLastVisit] Error fetching data:', err)
      }
      setLoading(false)
    }

    fetchLastVisitData()
  }, [patientId])

  function handleCopyMedications() {
    if (!lastPrescription || lastPrescription.medications.length === 0) return
    onCopyMedications(lastPrescription.medications)
    setMedsCopied(true)
    setTimeout(() => setMedsCopied(false), 3000)
  }

  function handleCopyDiagnosis() {
    if (!lastEncounter?.diagnosis || !onCopyDiagnosis) return
    onCopyDiagnosis(lastEncounter.diagnosis)
    setDiagnosisCopied(true)
    setTimeout(() => setDiagnosisCopied(false), 3000)
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg animate-pulse">
        <div className="w-4 h-4 bg-gray-200 rounded" />
        <div className="h-3 w-56 bg-gray-200 rounded" />
      </div>
    )
  }

  // If no history at all, render nothing
  if (!lastPrescription && !lastEncounter) {
    return null
  }

  const medCount = lastPrescription?.medications?.length || 0
  const diagnosis = lastEncounter?.diagnosis || ''
  const encounterDate = lastEncounter?.encounter_date

  return (
    <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
      {/* Summary */}
      <div className="flex items-center gap-2 mb-2">
        <Copy className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <div className="text-xs text-amber-800 truncate">
          <span className="font-medium">
            Last visit{encounterDate ? ` (${formatDate(encounterDate)})` : ''}:
          </span>
          {diagnosis && (
            <span> Dx: {diagnosis.length > 30 ? diagnosis.substring(0, 30) + '...' : diagnosis}</span>
          )}
          {medCount > 0 && (
            <span> | {medCount} medication{medCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {medCount > 0 && (
          <button
            onClick={handleCopyMedications}
            disabled={medsCopied}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              medsCopied
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-100 hover:border-amber-300'
            }`}
          >
            {medsCopied ? (
              <>
                <CheckCircle className="w-3 h-3" />
                Copied!
              </>
            ) : (
              <>
                <Pill className="w-3 h-3" />
                Copy Medications ({medCount})
              </>
            )}
          </button>
        )}

        {diagnosis && onCopyDiagnosis && (
          <button
            onClick={handleCopyDiagnosis}
            disabled={diagnosisCopied}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              diagnosisCopied
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-100 hover:border-amber-300'
            }`}
          >
            {diagnosisCopied ? (
              <>
                <CheckCircle className="w-3 h-3" />
                Copied!
              </>
            ) : (
              <>
                <Stethoscope className="w-3 h-3" />
                Copy Diagnosis
              </>
            )}
          </button>
        )}
      </div>

      {/* Additional details */}
      {lastPrescription?.advice && (
        <div className="mt-2 text-[10px] text-amber-600 truncate">
          Previous advice: {lastPrescription.advice.substring(0, 80)}
          {lastPrescription.advice.length > 80 ? '...' : ''}
        </div>
      )}
    </div>
  )
}