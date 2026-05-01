'use client'
/**
 * src/components/shared/DoctorNoteCamera.tsx
 *
 * A reusable "Click Photo of Note" button component for OPD consultation.
 *
 * FEATURE (Issue #5):
 * When the doctor takes a photo of their handwritten note during OPD consultation,
 * this component:
 *  1. Sends the image to the AI OCR endpoint (autofill mode)
 *  2. Parses the response to extract structured clinical fields
 *  3. Calls onExtracted() with the extracted data
 *  4. The parent (OPD new page) then populates the right form fields:
 *     - chief_complaint → Chief Complaint textarea
 *     - diagnosis → Diagnosis field
 *     - BP, pulse, temp, SpO₂ → Vitals fields
 *     - history/examination/plan → Notes field
 *     - medicines → queued for prescription
 *     - follow_up_date → follow-up in prescription
 *
 * Usage:
 *   <DoctorNoteCamera onExtracted={(result) => applyToForm(result)} />
 */

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Camera, Loader2, Sparkles, AlertCircle, CheckCircle2, X } from 'lucide-react'

export interface DoctorNoteResult {
  /** Detected form type — 'encounter' means OPD consultation note */
  formType: 'ob_exam' | 'vitals' | 'encounter' | 'unknown'
  /** Confidence 0–1 */
  confidence: number
  /** Extracted fields */
  fields: {
    // Vitals
    pulse?: number
    bp_systolic?: number
    bp_diastolic?: number
    temperature?: number
    spo2?: number
    weight?: number
    height?: number
    // Consultation
    chief_complaint?: string
    duration?: string
    history?: string
    examination_findings?: string
    diagnosis?: string
    investigations_ordered?: string
    treatment_plan?: string
    advice?: string
    follow_up_date?: string
    // Medications
    medicines?: Array<{ name: string; dose?: string; frequency?: string; days?: string }>
    // OB/GYN
    lmp?: string
    edd?: string
    gravida?: number
    para?: number
    gestational_age_weeks?: number
    fundal_height?: number
    fhs?: number
    [key: string]: any
  }
  /** Raw text from the image */
  raw_text?: string
}

interface Props {
  /** Called after successful extraction with the structured result */
  onExtracted: (result: DoctorNoteResult) => void
  /** Small/compact mode */
  compact?: boolean
  /** Context hint sent to AI (e.g. "OPD consultation note for gynecology") */
  context?: string
}

export default function DoctorNoteCamera({ onExtracted, compact = false, context = 'OPD consultation note' }: Props) {
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [preview,  setPreview]  = useState<DoctorNoteResult | null>(null)
  const [applied,  setApplied]  = useState(false)

  async function handleFile(file: File) {
    if (!file) return

    setLoading(true)
    setError('')
    setPreview(null)
    setApplied(false)

    try {
      const fd = new FormData()
      fd.append('image', file)
      fd.append('mode', 'autofill')
      fd.append('context', `${context} — extract chief complaint, diagnosis, vitals, medications, follow-up date`)

      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const res = await fetch('/api/doctor-note-ocr', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `OCR failed (${res.status})`)
      }

      const data = await res.json()

      const result: DoctorNoteResult = {
        formType:   data.formType   || 'unknown',
        confidence: typeof data.confidence === 'number' ? data.confidence : parseFloat(data.confidence) || 0,
        fields:     data.fields     || {},
        raw_text:   data.raw_text,
      }

      setPreview(result)
    } catch (err: any) {
      setError(err.message || 'Failed to read note. Check AI key is configured.')
    } finally {
      setLoading(false)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  function applyResult() {
    if (!preview) return
    onExtracted(preview)
    setApplied(true)
    setPreview(null)
    setTimeout(() => setApplied(false), 3000)
  }

  function dismiss() {
    setPreview(null)
    setError('')
  }

  // ── Compact mode — just a small button ───────────────────────
  if (compact) {
    return (
      <div className="inline-flex items-center gap-2">
        <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all
          ${loading ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'}`}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Camera className="w-3.5 h-3.5"/>}
          {loading ? 'Reading…' : 'Click Note Photo'}
          <input type="file" accept="image/*" capture="environment" onChange={handleChange} disabled={loading} className="hidden"/>
        </label>
        {applied && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/>Applied!</span>}
        {error && (
          <span className="text-xs text-red-600 flex items-center gap-1">
            <AlertCircle className="w-3 h-3"/>{error.slice(0, 40)}
          </span>
        )}
      </div>
    )
  }

  // ── Full mode ─────────────────────────────────────────────────
  return (
    <div>
      {/* Camera button */}
      <label className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-all
        ${loading
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'}`}>
        {loading ? (
          <><Loader2 className="w-4 h-4 animate-spin"/> Reading doctor note…</>
        ) : (
          <><Camera className="w-4 h-4"/> Click Photo of Doctor Note</>
        )}
        <input
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          capture="environment"
          onChange={handleChange}
          disabled={loading}
          className="hidden"
        />
      </label>

      <p className="text-xs text-gray-400 mt-1.5">
        📸 Take a clear photo of your handwritten note · AI reads the text and fills in the form fields automatically
      </p>

      {/* Success banner */}
      {applied && (
        <div className="mt-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-green-800">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0"/>
          Fields filled from your note! Please review each field before saving.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5"/>
          <div className="flex-1">{error}</div>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600"><X className="w-4 h-4"/></button>
        </div>
      )}

      {/* Preview panel — show extracted data before applying */}
      {preview && (
        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-blue-900 flex items-center gap-2 text-sm">
              <Sparkles className="w-4 h-4 text-blue-600"/>
              AI Extracted Data
              <span className="text-xs font-normal text-blue-500 ml-1 bg-blue-100 px-2 py-0.5 rounded-full">
                {Math.round(preview.confidence * 100)}% confidence
              </span>
            </h3>
            <button onClick={dismiss} className="text-blue-400 hover:text-blue-700">
              <X className="w-4 h-4"/>
            </button>
          </div>

          {/* Show extracted fields */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mb-4 text-xs">
            {Object.entries(preview.fields).map(([k, v]) => {
              if (!v || typeof v === 'object') return null
              return (
                <div key={k} className="flex gap-2">
                  <span className="text-blue-400 font-medium capitalize min-w-[130px]">
                    {k.replace(/_/g, ' ')}:
                  </span>
                  <span className="text-blue-900 font-medium">{String(v)}</span>
                </div>
              )
            })}
            {/* Medicines */}
            {Array.isArray(preview.fields.medicines) && preview.fields.medicines.length > 0 && (
              <div className="col-span-2">
                <span className="text-blue-400 font-medium">Medications:</span>
                <ul className="mt-1 space-y-0.5">
                  {preview.fields.medicines.map((m, i) => (
                    <li key={i} className="text-blue-900">
                      • {m.name} {m.dose || ''} {m.frequency || ''} {m.days ? `× ${m.days}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Raw note preview */}
          {preview.raw_text && (
            <details className="mb-4">
              <summary className="text-xs text-blue-500 cursor-pointer hover:text-blue-700">
                Show raw transcription
              </summary>
              <pre className="mt-2 text-xs text-blue-800 bg-white border border-blue-200 rounded-lg p-3 whitespace-pre-wrap font-mono">
                {preview.raw_text}
              </pre>
            </details>
          )}

          <div className="flex gap-3">
            <button onClick={applyResult}
              className="btn-primary text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4"/> Apply to Form Fields
            </button>
            <button onClick={dismiss} className="btn-secondary text-sm">
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}