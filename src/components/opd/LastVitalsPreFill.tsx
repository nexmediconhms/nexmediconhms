'use client'

import { useState, useEffect } from 'react'
import { Activity, ArrowUpCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface VitalsData {
  pulse?: string
  bp_systolic?: string
  bp_diastolic?: string
  temperature?: string
  spo2?: string
  weight?: string
  height?: string
}

interface LastVitalsPreFillProps {
  patientId: string
  onPreFill: (vitals: VitalsData) => void
}

interface EncounterVitals {
  pulse: number | null
  bp_systolic: number | null
  bp_diastolic: number | null
  temperature: number | null
  spo2: number | null
  weight: number | null
  height: number | null
  encounter_date: string | null
}

export default function LastVitalsPreFill({ patientId, onPreFill }: LastVitalsPreFillProps) {
  const [vitals, setVitals] = useState<EncounterVitals | null>(null)
  const [loading, setLoading] = useState(true)
  const [preFilled, setPreFilled] = useState(false)

  useEffect(() => {
    if (!patientId) {
      setLoading(false)
      return
    }

    async function fetchLastVitals() {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('encounters')
          .select('pulse, bp_systolic, bp_diastolic, temperature, spo2, weight, height, encounter_date')
          .eq('patient_id', patientId)
          .order('encounter_date', { ascending: false })
          .limit(1)
          .single()

        if (error || !data) {
          setVitals(null)
        } else {
          setVitals(data as EncounterVitals)
        }
      } catch (err) {
        console.error('[LastVitalsPreFill] Error fetching vitals:', err)
        setVitals(null)
      }
      setLoading(false)
    }

    fetchLastVitals()
  }, [patientId])

  function handlePreFill() {
    if (!vitals) return

    const vitalsData: VitalsData = {}
    if (vitals.pulse) vitalsData.pulse = String(vitals.pulse)
    if (vitals.bp_systolic) vitalsData.bp_systolic = String(vitals.bp_systolic)
    if (vitals.bp_diastolic) vitalsData.bp_diastolic = String(vitals.bp_diastolic)
    if (vitals.temperature) vitalsData.temperature = String(vitals.temperature)
    if (vitals.spo2) vitalsData.spo2 = String(vitals.spo2)
    if (vitals.weight) vitalsData.weight = String(vitals.weight)
    if (vitals.height) vitalsData.height = String(vitals.height)

    onPreFill(vitalsData)
    setPreFilled(true)
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg animate-pulse">
        <div className="w-4 h-4 bg-gray-200 rounded" />
        <div className="h-3 w-40 bg-gray-200 rounded" />
      </div>
    )
  }

  if (!vitals) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-100 rounded-lg">
        <Activity className="w-4 h-4 text-gray-300" />
        <span className="text-xs text-gray-400">No previous vitals found</span>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Activity className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <div className="text-xs text-blue-700 truncate">
          <span className="font-medium">Last vitals ({formatDate(vitals.encounter_date)}):</span>
          {' '}
          {vitals.bp_systolic && vitals.bp_diastolic && (
            <span>BP {vitals.bp_systolic}/{vitals.bp_diastolic}</span>
          )}
          {vitals.pulse && <span> | Pulse {vitals.pulse}</span>}
          {vitals.weight && <span> | Wt {vitals.weight}kg</span>}
          {vitals.spo2 && <span> | SpO2 {vitals.spo2}%</span>}
          {vitals.temperature && <span> | Temp {vitals.temperature}°F</span>}
        </div>
      </div>
      <button
        onClick={handlePreFill}
        disabled={preFilled}
        className={`flex items-center gap-1 ml-2 px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex-shrink-0 ${
          preFilled
            ? 'bg-green-100 text-green-700 cursor-default'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        <ArrowUpCircle className="w-3 h-3" />
        {preFilled ? 'Pre-filled' : 'Pre-fill'}
      </button>
    </div>
  )
}