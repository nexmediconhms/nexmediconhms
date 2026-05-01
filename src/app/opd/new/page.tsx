'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import FormScanner from '@/components/shared/FormScanner'
import ConsultationAttachments from '@/components/shared/ConsultationAttachments'
import SmartMic from '@/components/shared/SmartMic'
import { supabase } from '@/lib/supabase'
import { calculateBMI, calculateEDD, calculateGA, getHospitalSettings } from '@/lib/utils'
import type { Patient, OBData, Procedure, ObstetricEntry, AbortionEntry } from '@/types'
import type { OCRResult } from '@/lib/ocr'
import { ArrowLeft, Save, ChevronRight, AlertCircle, ScanLine, Camera, Loader2, Sparkles, X } from 'lucide-react'

// ── Tab types ─────────────────────────────────────────────────
type Tab = 'vitals' | 'consultation' | 'obgyn'

// ── Vitals state ──────────────────────────────────────────────
interface Vitals {
  pulse: string; bp_systolic: string; bp_diastolic: string
  temperature: string; spo2: string; weight: string; height: string
}
const EMPTY_VITALS: Vitals = {
  pulse: '', bp_systolic: '', bp_diastolic: '',
  temperature: '', spo2: '', weight: '', height: '',
}

// ── Highlight tracking ────────────────────────────────────────
type VitalsHL  = Partial<Record<keyof Vitals, boolean>>
type OBHL      = Partial<Record<keyof OBData, boolean>>
interface ConsultHL { chiefComplaint?: boolean; diagnosis?: boolean; notes?: boolean; hpi?: boolean }

// ── Ordinal suffix helper ─────────────────────────────────────
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return String(n) + (s[(v - 20) % 10] || s[v] || s[0])
}

export default function NewConsultationPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const patientId    = searchParams.get('patient')
  const prefillFlag  = searchParams.get('prefill')

  const [patient,        setPatient]       = useState<Patient | null>(null)
  const [tab,            setTab]           = useState<Tab>('vitals')
  const [vitals,         setVitals]        = useState<Vitals>(EMPTY_VITALS)
  const [ob,             setOB]            = useState<OBData>({})
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [hpi,            setHpi]           = useState('')
  const [diagnosis,      setDiagnosis]     = useState('')
  const [notes,          setNotes]         = useState('')
  const [procedures,     setProcedures]    = useState<Procedure[]>([])
  const [saving,         setSaving]        = useState(false)
  const [error,          setError]         = useState('')
  const [lastDiagnosis,  setLastDiagnosis]  = useState('')

  // OCR highlights
  const [vHL,  setVHL]  = useState<VitalsHL>({})
  const [obHL, setObHL] = useState<OBHL>({})
  const [cHL,  setCHL]  = useState<ConsultHL>({})

  // ── Doctor note camera state ──────────────────────────────────
  const [noteOcrLoading,  setNoteOcrLoading]  = useState(false)
  const [noteOcrPreview,  setNoteOcrPreview]  = useState<any>(null)
  const [noteOcrError,    setNoteOcrError]    = useState('')
  const [noteApplied,     setNoteApplied]     = useState(false)
  const [noteMedsQueue,   setNoteMedsQueue]   = useState('')

  // Draft key — persists form state across navigation for this patient
  const draftKey = patientId ? `opd_draft_${patientId}` : null

  // Voice state removed — SmartMic component handles everything

  // Derived
  const bmi = calculateBMI(parseFloat(vitals.weight), parseFloat(vitals.height))
  const edd  = ob.lmp ? calculateEDD(ob.lmp) : ''
  const ga   = ob.lmp ? calculateGA(ob.lmp)  : ''

  useEffect(() => {
    if (!patientId) { router.push('/opd'); return }

    // 1. Load draft from sessionStorage (persists if user navigated away)
    const key = `opd_draft_${patientId}`
    try {
      const draft = JSON.parse(sessionStorage.getItem(key) || 'null')
      if (draft) {
        if (draft.vitals)         setVitals(draft.vitals)
        if (draft.ob)             setOB(draft.ob)
        if (draft.chiefComplaint) setChiefComplaint(draft.chiefComplaint)
        if (draft.hpi)            setHpi(draft.hpi)
        if (draft.diagnosis)      setDiagnosis(draft.diagnosis)
        if (draft.notes)          setNotes(draft.notes)
      }
    } catch { /* ignore */ }

    // 2. Load OCR prefill from forms page scanner
    try {
      const ocrKey = `ocr_prefill_${patientId}`
      const ocr = JSON.parse(sessionStorage.getItem(ocrKey) || 'null')
      if (ocr && prefillFlag) {
        if (ocr.vitals) {
          setVitals(prev => ({
            ...prev,
            ...(ocr.vitals.pulse         && { pulse:        String(ocr.vitals.pulse)         }),
            ...(ocr.vitals.bp_systolic   && { bp_systolic:  String(ocr.vitals.bp_systolic)   }),
            ...(ocr.vitals.bp_diastolic  && { bp_diastolic: String(ocr.vitals.bp_diastolic)  }),
            ...(ocr.vitals.temperature   && { temperature:  String(ocr.vitals.temperature)   }),
            ...(ocr.vitals.spo2          && { spo2:         String(ocr.vitals.spo2)          }),
            ...(ocr.vitals.weight        && { weight:       String(ocr.vitals.weight)        }),
            ...(ocr.vitals.height        && { height:       String(ocr.vitals.height)        }),
          }))
        }
        if (ocr.vitals?.chief_complaint) setChiefComplaint(ocr.vitals.chief_complaint)
        if (ocr.vitals?.notes)           setHpi(ocr.vitals.notes)
        if (ocr.vitals?.diagnosis)       setDiagnosis(ocr.vitals.diagnosis)
        if (ocr.ob_data) {
          setOB(prev => ({ ...prev, ...ocr.ob_data }))
        }
        // Clear prefill after applying
        sessionStorage.removeItem(ocrKey)
      }
    } catch { /* ignore */ }

    // 3. Load patient + pre-fill height from last encounter
    Promise.all([
      supabase.from('patients').select('*').eq('id', patientId).single(),
      supabase.from('encounters')
        .select('height, diagnosis')
        .eq('patient_id', patientId)
        .order('encounter_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([{ data: pat }, { data: lastEnc }]) => {
      if (pat) setPatient(pat)
      if (lastEnc?.height && !vitals.height) {
        setVitals(prev => ({ ...prev, height: String(lastEnc.height) }))
      }
      if (lastEnc?.diagnosis) {
        setLastDiagnosis(lastEnc.diagnosis)
      }
    })
  }, [patientId])


  // Auto-save draft to sessionStorage on any change
  useEffect(() => {
    if (!patientId) return
    const key = `opd_draft_${patientId}`
    try {
      sessionStorage.setItem(key, JSON.stringify({ vitals, ob, chiefComplaint, hpi, diagnosis, notes }))
    } catch { /* ignore */ }
  }, [vitals, ob, chiefComplaint, hpi, diagnosis, notes, patientId])

  // ── Field setters ─────────────────────────────────────────────
  function setV(k: keyof Vitals, v: string) { setVitals(p => ({ ...p, [k]: v })) }
  function setO(k: keyof OBData, v: any)   { setOB(p => ({ ...p, [k]: v })) }

  // ── Highlight helper: apply then clear after 2 s ──────────────
  function flashHL<T>(setter: React.Dispatch<React.SetStateAction<T>>, hl: T) {
    setter(hl)
    setTimeout(() => setter({} as T), 2000)
  }

  // ── OCR callback ──────────────────────────────────────────────
  const handleOCRResult = useCallback((result: OCRResult) => {
    const vitalsHL: VitalsHL   = {}
    const obHL_:    OBHL       = {}
    const cHL_:     ConsultHL  = {}

    // ── Vitals section ─────────────────────────────────────────
    if (result.vitals) {
      const v = result.vitals
      if (v.pulse)        { setV('pulse',        v.pulse);        vitalsHL.pulse        = true }
      if (v.bp_systolic)  { setV('bp_systolic',  v.bp_systolic);  vitalsHL.bp_systolic  = true }
      if (v.bp_diastolic) { setV('bp_diastolic', v.bp_diastolic); vitalsHL.bp_diastolic = true }
      if (v.temperature)  { setV('temperature',  v.temperature);  vitalsHL.temperature  = true }
      if (v.spo2)         { setV('spo2',         v.spo2);         vitalsHL.spo2         = true }
      if (v.weight)       { setV('weight',       v.weight);       vitalsHL.weight       = true }
      if (v.height)       { setV('height',       v.height);       vitalsHL.height       = true }

      if (v.chief_complaint) { setChiefComplaint(v.chief_complaint); cHL_.chiefComplaint = true }
      if (v.diagnosis)       { setDiagnosis(v.diagnosis);            cHL_.diagnosis      = true }
      if (v.notes)           { setNotes(v.notes);                    cHL_.notes          = true }
    }

    // ── OB/GYN section ─────────────────────────────────────────
    if (result.ob_data) {
      const o = result.ob_data
      // Helper to set and flag
      const applyOB = (k: keyof OBData, val: any) => {
        if (val !== undefined && val !== null && val !== '') {
          setO(k, typeof val === 'string' ? val : val)
          ;(obHL_ as any)[k] = true
        }
      }
      applyOB('lmp',              o.lmp)
      applyOB('gravida',          o.gravida)
      applyOB('para',             o.para)
      applyOB('abortion',         o.abortion)
      applyOB('living',           o.living)
      applyOB('fhs',              o.fhs)
      applyOB('liquor',           o.liquor)
      applyOB('fundal_height',    o.fundal_height)
      applyOB('presentation',     o.presentation)
      applyOB('engagement',       o.engagement)
      applyOB('uterus_size',      o.uterus_size)
      applyOB('scar_tenderness',  o.scar_tenderness)
      applyOB('fetal_movement',   o.fetal_movement)
      applyOB('per_abdomen',      o.per_abdomen)
      applyOB('cervix_speculum',  o.cervix_speculum)
      applyOB('discharge_speculum', o.discharge_speculum)
      applyOB('bleeding_speculum',  o.bleeding_speculum)
      applyOB('per_speculum',     o.per_speculum)
      applyOB('cervix_pv',        o.cervix_pv)
      applyOB('os_pv',            o.os_pv)
      applyOB('uterus_position',  o.uterus_position)
      applyOB('per_vaginum',      o.per_vaginum)
      applyOB('right_ovary',      o.right_ovary)
      applyOB('left_ovary',       o.left_ovary)
      // ── New fields ──────────────────────────────────────────
      applyOB('menstrual_regularity',   o.menstrual_regularity)
      applyOB('menstrual_flow',         o.menstrual_flow)
      applyOB('post_menstrual_days',    o.post_menstrual_days)
      applyOB('post_menstrual_pain',    o.post_menstrual_pain)
      applyOB('urine_pregnancy_result', o.urine_pregnancy_result)
      applyOB('obstetric_history',      o.obstetric_history)
      applyOB('abortion_entries',       o.abortion_entries)
      applyOB('past_diabetes',          o.past_diabetes)
      applyOB('past_hypertension',      o.past_hypertension)
      applyOB('past_thyroid',           o.past_thyroid)
      applyOB('past_surgery',           o.past_surgery)
      applyOB('past_surgery_detail',    o.past_surgery_detail)
      applyOB('income',                 o.income)
      applyOB('expenditure',            o.expenditure)
    }

    flashHL(setVHL,  vitalsHL)
    flashHL(setObHL, obHL_)
    flashHL(setCHL,  cHL_)

    // Auto-jump to the tab where most data landed
    const vitalsCount = Object.keys(vitalsHL).length
    const obCount     = Object.keys(obHL_).length
    const cCount      = Object.keys(cHL_).length

    if (obCount > vitalsCount && obCount > cCount) setTab('obgyn')
    else if (cCount >= vitalsCount)                setTab('consultation')
    else                                           setTab('vitals')
  }, [])

  // startVoice removed — SmartMic handles STT + AI correction

  // ── Doctor Note Camera: send photo to OCR API ─────────────────
  async function handleNotePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setNoteOcrLoading(true)
    setNoteOcrError('')
    setNoteOcrPreview(null)
    setNoteApplied(false)
    try {
      const fd = new FormData()
      fd.append('image', file)
      fd.append('mode', 'autofill')
      fd.append('context', `OPD consultation note for gynecology patient ${patient?.full_name || ''} — extract chief complaint, diagnosis, vitals, history, plan, medications, follow-up`)
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
      setNoteOcrPreview(data)
    } catch (err: any) {
      setNoteOcrError(err.message || 'Failed to read note. Ensure AI key is configured (/ai-setup).')
    } finally {
      setNoteOcrLoading(false)
    }
  }

  // ── Doctor Note Camera: apply extracted fields to form ─────────
  const handleDoctorNote = useCallback((data: any) => {
    const f = data?.fields || {}
    const vitalsHL: VitalsHL  = {}
    const cHL_:     ConsultHL = {}
    const obHL_:    OBHL      = {}

    // Vitals
    if (f.pulse)        { setV('pulse',        String(f.pulse));        vitalsHL.pulse        = true }
    if (f.bp_systolic)  { setV('bp_systolic',  String(f.bp_systolic));  vitalsHL.bp_systolic  = true }
    if (f.bp_diastolic) { setV('bp_diastolic', String(f.bp_diastolic)); vitalsHL.bp_diastolic = true }
    if (f.temperature)  { setV('temperature',  String(f.temperature));  vitalsHL.temperature  = true }
    if (f.spo2)         { setV('spo2',         String(f.spo2));         vitalsHL.spo2         = true }
    if (f.weight)       { setV('weight',       String(f.weight));       vitalsHL.weight       = true }
    if (f.height)       { setV('height',       String(f.height));       vitalsHL.height       = true }

    // Chief complaint — only fill if currently empty
    if (f.chief_complaint) {
      setChiefComplaint(prev => prev.trim() ? prev : f.chief_complaint)
      cHL_.chiefComplaint = true
    }
    // Diagnosis — only fill if currently empty
    if (f.diagnosis) {
      setDiagnosis(prev => prev.trim() ? prev : f.diagnosis)
      cHL_.diagnosis = true
    }

    // HPI — build from history + duration
    const hpiLines: string[] = []
    if (f.history)  hpiLines.push(f.history)
    if (f.duration) hpiLines.push(`Duration: ${f.duration}`)
    if (hpiLines.length > 0) {
      setHpi(prev => prev.trim() ? prev : hpiLines.join('\n'))
      cHL_.hpi = true
    }

    // Clinical notes — build from findings, plan, investigations, advice, follow-up
    const noteLines: string[] = []
    if (f.examination_findings)   noteLines.push(`O/E: ${f.examination_findings}`)
    if (f.treatment_plan)         noteLines.push(`Plan: ${f.treatment_plan}`)
    if (f.investigations_ordered) noteLines.push(`Ix: ${f.investigations_ordered}`)
    if (f.advice)                 noteLines.push(`Advice: ${f.advice}`)
    if (f.follow_up_date)         noteLines.push(`Follow-up: ${f.follow_up_date}`)
    if (noteLines.length > 0) {
      setNotes(prev => prev.trim() ? prev + '\n\n' + noteLines.join('\n') : noteLines.join('\n'))
      cHL_.notes = true
    }

    // Medications → queue as amber banner for prescription reference
    if (Array.isArray(f.medicines) && f.medicines.length > 0) {
      const medStr = f.medicines
        .map((m: any) => `• ${m.name || ''} ${m.dose || ''} ${m.frequency || ''} ${m.days ? `× ${m.days}` : ''}`.trim())
        .join('\n')
      setNoteMedsQueue(medStr)
    }

    // OB/GYN fields (if ANC note)
    if (f.lmp)               { setO('lmp', f.lmp);                           (obHL_ as any).lmp            = true }
    if (f.edd)               { setO('edd', f.edd);                           (obHL_ as any).edd            = true }
    if (f.gravida != null)   { setO('gravida', f.gravida);                   (obHL_ as any).gravida        = true }
    if (f.para    != null)   { setO('para',    f.para);                      (obHL_ as any).para           = true }
    if (f.gestational_age_weeks) { setO('gestational_age', `${f.gestational_age_weeks} weeks`); (obHL_ as any).gestational_age = true }
    if (f.fundal_height)     { setO('fundal_height', f.fundal_height);       (obHL_ as any).fundal_height  = true }
    if (f.fhs)               { setO('fhs', f.fhs);                           (obHL_ as any).fhs            = true }

    // Flash highlights and auto-jump to most-filled tab
    flashHL(setVHL, vitalsHL)
    flashHL(setCHL, cHL_)
    flashHL(setObHL, obHL_)

    const vc = Object.keys(vitalsHL).length
    const cc = Object.keys(cHL_).length
    const oc = Object.keys(obHL_).length
    if (oc > 0 && oc >= vc && oc >= cc) setTab('obgyn')
    else if (cc > 0) setTab('consultation')
    else if (vc > 0) setTab('vitals')

    setNoteApplied(true)
    setTimeout(() => setNoteApplied(false), 4000)
  }, [patient])


  async function handleSave() {
    if (!patientId) return
    if (!chiefComplaint.trim() && !diagnosis.trim()) {
      setError('Please enter at least a chief complaint or diagnosis.')
      return
    }
    setSaving(true)
    setError('')

    // Check if an encounter already exists for this patient today
    const today = new Date().toISOString().split('T')[0]
    const { data: existing } = await supabase
      .from('encounters')
      .select('id')
      .eq('patient_id', patientId)
      .eq('encounter_date', today)
      .limit(1)
      .maybeSingle()

    if (existing?.id) {
      // Encounter already exists — update it instead of creating a duplicate
      setSaving(false)
      const confirmUpdate = window.confirm(
        'An OPD encounter for this patient already exists today.\n\nClick OK to update the existing encounter, or Cancel to go back.'
      )
      if (!confirmUpdate) return
      // Redirect to edit the existing encounter
      router.push(`/opd/${existing.id}/edit`)
      return
    }

    const obPayload: OBData = { ...ob }
    if (ob.lmp) { obPayload.edd = edd; obPayload.gestational_age = ga }

    const { data: enc, error: encErr } = await supabase
      .from('encounters')
      .insert({
        patient_id:      patientId,
        encounter_type:  'OPD',
        encounter_date:  new Date().toISOString().split('T')[0],
        chief_complaint: chiefComplaint.trim() || null,
        pulse:           vitals.pulse       ? parseInt(vitals.pulse)       : null,
        bp_systolic:     vitals.bp_systolic  ? parseInt(vitals.bp_systolic) : null,
        bp_diastolic:    vitals.bp_diastolic ? parseInt(vitals.bp_diastolic): null,
        temperature:     vitals.temperature  ? parseFloat(vitals.temperature): null,
        spo2:            vitals.spo2         ? parseInt(vitals.spo2)        : null,
        weight:          vitals.weight       ? parseFloat(vitals.weight)    : null,
        height:          vitals.height       ? parseFloat(vitals.height)    : null,
        diagnosis:       diagnosis.trim()    || null,
        notes:           (hpi.trim() ? 'HPI: ' + hpi.trim() + (notes.trim() ? '\n\n' + notes.trim() : '') : notes.trim()) || null,
        ob_data:         obPayload,
        procedures:      procedures.length > 0 ? procedures : null,
        doctor_name:     getHospitalSettings().doctorName,
      })
      .select('id')
      .single()

    setSaving(false)
    if (encErr || !enc) { setError(`Failed to save: ${encErr?.message}`); return }

    // Link any files uploaded before save (encounter_id was null) to the new encounter
    try {
      await supabase.from('consultation_attachments')
        .update({ encounter_id: enc.id })
        .eq('patient_id', patientId)
        .is('encounter_id', null)
      await supabase.from('consultation_files_db')
        .update({ encounter_id: enc.id })
        .eq('patient_id', patientId)
        .is('encounter_id', null)
    } catch { /* tables may not exist yet — ignore */ }

    // Clear draft after successful save
    if (patientId) { try { sessionStorage.removeItem(`opd_draft_${patientId}`) } catch {} }
    router.push(`/opd/${enc.id}/prescription`)
  }

  // ── Input class helper ────────────────────────────────────────
  function vc(k: keyof Vitals)   { return vHL[k]  ? 'input ocr-filled' : 'input' }
  function oc(k: keyof OBData)   { return (obHL as any)[k] ? 'input ocr-filled' : 'input' }
  function cc(k: keyof ConsultHL){ return (cHL as any)[k]  ? 'input ocr-filled' : 'input' }

  // MicBtn removed — use SmartMic from @/components/shared/SmartMic instead

  if (!patient) {
    return (
      <AppShell>
        <div className="p-6 flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">New OPD Consultation</h1>
            <p className="text-sm text-gray-500">
              <strong className="text-blue-700">{patient.full_name}</strong>
              <span className="text-gray-400"> · {patient.mrn} · {patient.age}y · {patient.gender}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/patients/${patient.id}`} className="btn-secondary text-xs">Cancel</Link>
            <button onClick={handleSave} disabled={saving}
              className="btn-primary flex items-center gap-2 disabled:opacity-60">
              {saving
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Save className="w-4 h-4" />}
              Save & Continue to Prescription
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {/* ══ OCR SCANNER ════════════════════════════════════════ */}
        <div className="mb-5">
          <FormScanner
            formType="opd_consultation"
            onExtracted={handleOCRResult}
            label="Scan OPD / ANC Paper Form"
          />
          <p className="text-xs text-gray-400 mt-1.5 ml-1">
            📷 Reads Gujarati and English OPD chits, ANC cards, and consultation notes.
            Automatically fills vitals, complaints, diagnosis, and OB/GYN fields.
          </p>
        </div>

        {/* ══ DOCTOR NOTE CAMERA ════════════════════════════════════
            Doctor clicks a photo of their handwritten note during
            the consultation. AI extracts chief complaint, diagnosis,
            vitals, history, plan, and medications — each placed into
            the correct field automatically.
        ════════════════════════════════════════════════════════ */}
        <div className="mb-5 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">🩺 Click Photo of Doctor's Note</p>
              <p className="text-xs text-blue-500 mt-0.5">
                Take a photo of your handwritten note — AI reads it and fills in complaint, diagnosis, vitals, and plan automatically.
              </p>
            </div>
            <label className={`flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all
              ${noteOcrLoading ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'}`}>
              {noteOcrLoading
                ? <><Loader2 className="w-4 h-4 animate-spin"/> Reading…</>
                : <><Camera className="w-4 h-4"/> Click Note Photo</>}
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={handleNotePhoto}
                disabled={noteOcrLoading}
                className="hidden"
              />
            </label>
          </div>

          {/* Error */}
          {noteOcrError && (
            <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/>
              <span className="flex-1">{noteOcrError}</span>
              <button onClick={() => setNoteOcrError('')}><X className="w-3.5 h-3.5"/></button>
            </div>
          )}

          {/* Applied success */}
          {noteApplied && (
            <div className="mt-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-800 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-green-600 flex-shrink-0"/>
              Doctor note applied! Fields highlighted in yellow were auto-filled — please review before saving.
            </div>
          )}

          {/* Preview panel — shown before applying */}
          {noteOcrPreview && !noteApplied && (
            <div className="mt-3 bg-white border border-blue-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5"/>
                  AI Extracted — review before applying
                  <span className="font-normal text-blue-500 ml-1">
                    ({Math.round((noteOcrPreview.confidence || 0) * 100)}% confidence)
                  </span>
                </p>
                <button onClick={() => setNoteOcrPreview(null)} className="text-blue-300 hover:text-blue-600">
                  <X className="w-4 h-4"/>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
                {Object.entries(noteOcrPreview.fields || {}).map(([k, v]: any) => {
                  if (!v || typeof v === 'object') return null
                  return (
                    <div key={k} className="flex gap-1.5">
                      <span className="text-blue-400 capitalize min-w-[110px] font-medium">{k.replace(/_/g,' ')}:</span>
                      <span className="text-blue-900 font-semibold">{String(v)}</span>
                    </div>
                  )
                })}
                {Array.isArray(noteOcrPreview.fields?.medicines) && noteOcrPreview.fields.medicines.length > 0 && (
                  <div className="col-span-2">
                    <span className="text-blue-400 font-medium">Medications:</span>
                    <ul className="mt-0.5 space-y-0.5 pl-2">
                      {noteOcrPreview.fields.medicines.map((m: any, i: number) => (
                        <li key={i} className="text-blue-900">• {m.name} {m.dose||''} {m.frequency||''} {m.days ? `× ${m.days}` : ''}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { handleDoctorNote(noteOcrPreview); setNoteOcrPreview(null) }}
                  className="btn-primary text-xs flex items-center gap-1.5 py-1.5">
                  <Sparkles className="w-3.5 h-3.5"/> Apply to Form
                </button>
                <button onClick={() => setNoteOcrPreview(null)} className="btn-secondary text-xs py-1.5">
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Medications queued from doctor note */}
        {noteMedsQueue && (
          <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="text-base flex-shrink-0">💊</span>
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-700 mb-1">Medications from doctor note — add these in the Prescription step:</p>
              <pre className="text-xs text-amber-800 font-mono whitespace-pre-wrap">{noteMedsQueue}</pre>
            </div>
            <button onClick={() => setNoteMedsQueue('')} className="text-amber-400 hover:text-amber-700 flex-shrink-0">
              <X className="w-4 h-4"/>
            </button>
          </div>
        )}

        {/* Tab Bar */}
        <div className="flex border-b border-gray-200 mb-5 bg-white rounded-t-xl overflow-hidden shadow-sm">
          {([
            { id: 'vitals' as Tab,       label: 'Vitals & Complaints' },
            { id: 'consultation' as Tab, label: 'Consultation & Diagnosis' },
            { id: 'obgyn' as Tab,        label: 'Gynecology / OB Exam' },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2
                ${tab === t.id
                  ? 'border-blue-600 text-blue-700 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ════════════════════════════════════════════════════════
            TAB 1 — VITALS
        ════════════════════════════════════════════════════════ */}
        {tab === 'vitals' && (
          <div className="space-y-5">
            <div className="card p-5">
              <h2 className="section-title">Vital Signs</h2>
              <div className="grid grid-cols-3 gap-4">
                <VitalCard label="Pulse" unit="bpm" placeholder="72"
                  color="red" value={vitals.pulse}
                  highlighted={!!vHL.pulse}
                  onChange={v => setV('pulse', v)} />

                {/* BP — two inputs */}
                <div>
                  <label className="label">Blood Pressure</label>
                  <div className="flex items-center gap-2">
                    <input className={`input text-center ${vHL.bp_systolic ? 'ocr-filled' : ''}`}
                      placeholder="120" maxLength={3}
                      value={vitals.bp_systolic}
                      onChange={e => setV('bp_systolic', e.target.value.replace(/\D/g,''))} />
                    <span className="text-gray-400 font-bold">/</span>
                    <input className={`input text-center ${vHL.bp_diastolic ? 'ocr-filled' : ''}`}
                      placeholder="80" maxLength={3}
                      value={vitals.bp_diastolic}
                      onChange={e => setV('bp_diastolic', e.target.value.replace(/\D/g,''))} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">mmHg (systolic / diastolic)</p>
                </div>

                <VitalCard label="Temperature" unit="°C" placeholder="37.0"
                  color="orange" value={vitals.temperature}
                  highlighted={!!vHL.temperature}
                  onChange={v => setV('temperature', v)} />
                <VitalCard label="SpO₂" unit="%" placeholder="98"
                  color="blue" value={vitals.spo2}
                  highlighted={!!vHL.spo2}
                  onChange={v => setV('spo2', v)} />
                <VitalCard label="Weight" unit="kg" placeholder="60.0"
                  color="green" value={vitals.weight}
                  highlighted={!!vHL.weight}
                  onChange={v => setV('weight', v)} />
                <VitalCard label="Height" unit="cm" placeholder="160"
                  color="purple" value={vitals.height}
                  highlighted={!!vHL.height}
                  onChange={v => setV('height', v)} />
              </div>

              {bmi && (
                <div className="mt-4 inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
                  <span className="text-xs text-gray-500 font-semibold">BMI:</span>
                  <span className={`font-bold text-sm
                    ${parseFloat(bmi) < 18.5 ? 'text-blue-600'
                      : parseFloat(bmi) < 25  ? 'text-green-600'
                      : parseFloat(bmi) < 30  ? 'text-yellow-600'
                      : 'text-red-600'}`}>
                    {bmi} kg/m²
                  </span>
                  <span className="text-xs text-gray-400">
                    {parseFloat(bmi) < 18.5 ? '(Underweight)'
                      : parseFloat(bmi) < 25 ? '(Normal)'
                      : parseFloat(bmi) < 30 ? '(Overweight)'
                      : '(Obese)'}
                  </span>
                </div>
              )}
            </div>

            {/* Chief Complaint */}
            <div className="card p-5">
              <h2 className="section-title">Chief Complaint</h2>
              <div className="flex items-center justify-between mb-1">
                <label className="label">Chief Complaint *</label>
                <SmartMic field="cc" value={chiefComplaint} onChange={setChiefComplaint} context="Chief Complaint" />
              </div>
              <textarea className={`${cHL.chiefComplaint ? 'input ocr-filled' : 'input'} resize-none`}
                rows={3}
                placeholder="e.g. Lower abdominal pain for 3 days, irregular periods..."
                value={chiefComplaint}
                onChange={e => setChiefComplaint(e.target.value)} />
            </div>

            <div className="flex justify-end">
              <button onClick={() => setTab('consultation')} className="btn-primary flex items-center gap-2">
                Next: Consultation <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════
            TAB 2 — CONSULTATION
        ════════════════════════════════════════════════════════ */}
        {tab === 'consultation' && (
          <div className="space-y-5">
            <div className="card p-5">
              <h2 className="section-title">Consultation Notes</h2>
              <div className="space-y-4">

                {/* HPI */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">History of Present Illness</label>
                    <SmartMic field="hpi" value={hpi} onChange={setHpi} context="History of Present Illness" />
                  </div>
                  <textarea className="input resize-none" rows={3}
                    placeholder="Onset, duration, character, associated symptoms..."
                    value={hpi} onChange={e => setHpi(e.target.value)} />
                </div>

                {/* Diagnosis */}
                <div>
                  <label className="label">Diagnosis / Impression</label>
                  <input className={cHL.diagnosis ? 'input ocr-filled' : 'input'}
                    placeholder="e.g. Polycystic Ovarian Syndrome (PCOS)"
                    value={diagnosis} onChange={e => setDiagnosis(e.target.value)} />
                </div>

                {/* Clinical Notes */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">Clinical Notes</label>
                    <SmartMic field="notes" value={notes} onChange={setNotes} context="Clinical Notes" />
                  </div>
                  <textarea className={`${cHL.notes ? 'input ocr-filled' : 'input'} resize-none`}
                    rows={4}
                    placeholder="Examination findings, assessment, plan..."
                    value={notes} onChange={e => setNotes(e.target.value)} />
                </div>

              </div>
            </div>

            {/* ── Procedure Log ── */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="section-title mb-0">🔪 Procedures Performed</h2>
                <button
                  type="button"
                  onClick={() => setProcedures(prev => [...prev, { name: '', indication: '', findings: '', complications: '', surgeon: getHospitalSettings().doctorName, anaesthesia: '', notes: '' }])}
                  className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg"
                >
                  + Add Procedure
                </button>
              </div>

              {procedures.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No procedures recorded. Click "Add Procedure" if a procedure was performed during this visit.</p>
              ) : (
                <div className="space-y-4">
                  {procedures.map((proc, idx) => (
                    <div key={idx} className="border border-gray-200 rounded-lg p-4 bg-gray-50 relative">
                      <button
                        type="button"
                        onClick={() => setProcedures(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute top-2 right-2 text-red-400 hover:text-red-600 text-xs"
                        title="Remove procedure"
                      >✕</button>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="label">Procedure Name *</label>
                          <select
                            className="input"
                            value={proc.name}
                            onChange={e => {
                              const val = e.target.value
                              setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, name: val } : p))
                            }}
                          >
                            <option value="">Select procedure...</option>
                            {[
                              'D&C (Dilatation & Curettage)',
                              'Colposcopy',
                              'Cervical Biopsy',
                              'LEEP / LLETZ',
                              'Hysteroscopy',
                              'IUD Insertion',
                              'IUD Removal',
                              'MVA (Manual Vacuum Aspiration)',
                              'Endometrial Biopsy',
                              'Bartholin Cyst I&D',
                              'Cervical Cerclage',
                              'Amniocentesis',
                              'ECV (External Cephalic Version)',
                              'Episiotomy Repair',
                              'Perineal Tear Repair',
                              'Normal Vaginal Delivery',
                              'Assisted Vaginal Delivery',
                              'Caesarean Section (LSCS)',
                              'Tubal Ligation',
                              'Laparoscopy (Diagnostic)',
                              'Laparoscopy (Operative)',
                              'Hysterectomy',
                              'Ovarian Cystectomy',
                              'Pap Smear',
                              'Other',
                            ].map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label">Indication</label>
                          <input className="input" placeholder="Why was this done?"
                            value={proc.indication || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, indication: e.target.value } : p))} />
                        </div>
                        <div>
                          <label className="label">Anaesthesia</label>
                          <select className="input"
                            value={proc.anaesthesia || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, anaesthesia: e.target.value } : p))}>
                            <option value="">Select</option>
                            {['None','Local','Spinal','Epidural','General','IV Sedation'].map(a => <option key={a}>{a}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label">Surgeon / Performed By</label>
                          <input className="input" placeholder="Doctor name"
                            value={proc.surgeon || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, surgeon: e.target.value } : p))} />
                        </div>
                        <div>
                          <label className="label">Complications</label>
                          <input className="input" placeholder="None / describe"
                            value={proc.complications || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, complications: e.target.value } : p))} />
                        </div>
                        <div className="col-span-2">
                          <label className="label">Findings</label>
                          <textarea className="input resize-none" rows={2} placeholder="Procedure findings..."
                            value={proc.findings || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, findings: e.target.value } : p))} />
                        </div>
                        <div className="col-span-2">
                          <label className="label">Additional Notes</label>
                          <textarea className="input resize-none" rows={2} placeholder="Post-procedure instructions, follow-up..."
                            value={proc.notes || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, notes: e.target.value } : p))} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <button onClick={() => setTab('vitals')} className="btn-secondary flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={() => setTab('obgyn')} className="btn-primary flex items-center gap-2">
                Next: OB/GYN <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════
            TAB 3 — OB/GYN
        ════════════════════════════════════════════════════════ */}
        {tab === 'obgyn' && (
          <div className="space-y-5">

            {/* ── MENSTRUAL HISTORY (NEW) ──────────────────────── */}
            <div className="card p-5">
              <h2 className="section-title">Menstrual History</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <label className="label">Cycle Regularity</label>
                  <select className="input bg-white"
                    value={ob.menstrual_regularity || ''}
                    onChange={e => setO('menstrual_regularity', e.target.value)}>
                    <option value="">Select</option>
                    <option>Regular</option>
                    <option>Irregular</option>
                  </select>
                </div>
                <div>
                  <label className="label">Flow</label>
                  <select className="input bg-white"
                    value={ob.menstrual_flow || ''}
                    onChange={e => setO('menstrual_flow', e.target.value)}>
                    <option value="">Select</option>
                    <option>Scanty</option>
                    <option>Normal</option>
                    <option>Heavy</option>
                  </select>
                </div>
                <div>
                  <label className="label">Post-Menstrual Spotting (days)</label>
                  <input className="input" type="number" min="0" max="30"
                    placeholder="e.g. 2"
                    value={ob.post_menstrual_days || ''}
                    onChange={e => setO('post_menstrual_days', e.target.value)} />
                </div>
                <div>
                  <label className="label">Post-Menstrual Pain</label>
                  <select className="input bg-white"
                    value={ob.post_menstrual_pain || ''}
                    onChange={e => setO('post_menstrual_pain', e.target.value)}>
                    <option value="">None / Not reported</option>
                    <option>Mild</option>
                    <option>Moderate</option>
                    <option>Severe</option>
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-4">
                  <label className="label">Urine Pregnancy Test Result (~3 months)</label>
                  <input className="input"
                    placeholder="e.g. Positive, Negative, Not done"
                    value={ob.urine_pregnancy_result || ''}
                    onChange={e => setO('urine_pregnancy_result', e.target.value)} />
                </div>
              </div>
            </div>

            {/* A — Obstetric History */}
            <div className="card p-5">
              <h2 className="section-title">A. Obstetric History</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">LMP</label>
                  <input className={oc('lmp')} type="date"
                    max={new Date().toISOString().split('T')[0]}
                    value={ob.lmp || ''} onChange={e => setO('lmp', e.target.value)} />
                </div>
                <div>
                  <label className="label">EDD (auto-calculated)</label>
                  <input className="input bg-blue-50 font-semibold text-blue-700" readOnly
                    value={edd || 'Enter LMP to calculate'} />
                </div>
                <div>
                  <label className="label">Gestational Age (auto)</label>
                  <input className="input bg-blue-50 font-semibold text-blue-700" readOnly
                    value={ga || 'Enter LMP to calculate'} />
                </div>
                {(['gravida','para','abortion','living'] as (keyof OBData)[]).map(k => (
                  <div key={k}>
                    <label className="label capitalize">{k}</label>
                    <input className={oc(k)} type="number" min="0" placeholder="0"
                      value={(ob as any)[k] ?? ''}
                      onChange={e => {
                        const val = parseInt(e.target.value) || 0
                        setO(k, val)
                        // ── Auto-sync abortion entries when count changes ──
                        if (k === 'abortion') {
                          const current = ob.abortion_entries || []
                          if (val > current.length) {
                            // Add blank entries to match count
                            const toAdd = Array.from({ length: val - current.length }, () => ({
                              type: '' as AbortionEntry['type'],
                              weeks: '',
                              method: '' as AbortionEntry['method'],
                              years_ago: '',
                            }))
                            setO('abortion_entries', [...current, ...toAdd])
                          } else if (val < current.length) {
                            // Trim extra entries
                            setO('abortion_entries', current.slice(0, val))
                          }
                        }
                      }} />
                  </div>
                ))}
              </div>

              {/* ── Abortion Details — inline, auto-shown when abortion > 0 ── */}
              {(ob.abortion ?? 0) > 0 && (
                <div className="mt-4 border border-orange-200 rounded-xl bg-orange-50/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-orange-800 flex items-center gap-2">
                      📋 Abortion Details
                      <span className="text-xs font-normal text-orange-600">
                        — {ob.abortion} {(ob.abortion ?? 0) === 1 ? 'entry' : 'entries'} (fill details below)
                      </span>
                    </h3>
                    {/* Allow manual add if count doesn't match */}
                    {(ob.abortion_entries || []).length < (ob.abortion ?? 0) && (
                      <button type="button"
                        className="text-xs btn-secondary py-1 px-3"
                        onClick={() => setO('abortion_entries', [
                          ...(ob.abortion_entries || []),
                          { type: '', weeks: '', method: '', years_ago: '' } as AbortionEntry,
                        ])}>
                        + Add Entry
                      </button>
                    )}
                  </div>

                  {/* Column headers */}
                  <div className="hidden sm:grid grid-cols-4 gap-3 text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2 px-1">
                    <span>1. Type</span>
                    <span>2. Duration (weeks)</span>
                    <span>3. Method</span>
                    <span>4. Year</span>
                  </div>

                  <div className="space-y-2">
                    {(ob.abortion_entries || []).map((entry, idx) => (
                      <div key={idx}
                        className="grid grid-cols-4 gap-3 items-end border border-orange-200 rounded-lg px-3 py-3 bg-white relative">

                        {/* Remove button */}
                        <button type="button"
                          className="absolute top-1.5 right-2 text-red-400 hover:text-red-600 text-xs font-bold leading-none"
                          title="Remove this entry"
                          onClick={() => {
                            const updated = (ob.abortion_entries || []).filter((_, i) => i !== idx)
                            setO('abortion_entries', updated)
                            setO('abortion', updated.length)
                          }}>✕</button>

                        {/* Abortion number label */}
                        <div className="absolute -left-3 -top-2 w-5 h-5 bg-orange-500 text-white rounded-full text-[10px] flex items-center justify-center font-bold">
                          {idx + 1}
                        </div>

                        {/* 1. Type — Spontaneous or Induced */}
                        <div>
                          <label className="label text-xs text-orange-700">Type</label>
                          <select className="input bg-white text-sm"
                            value={entry.type || ''}
                            onChange={e => {
                              const updated = [...(ob.abortion_entries || [])]
                              updated[idx] = { ...updated[idx], type: e.target.value as AbortionEntry['type'] }
                              setO('abortion_entries', updated)
                            }}>
                            <option value="">Select type…</option>
                            <option value="Spontaneous">Spontaneous</option>
                            <option value="Induced">Induced</option>
                          </select>
                        </div>

                        {/* 2. Duration in weeks */}
                        <div>
                          <label className="label text-xs text-orange-700">Duration (weeks)</label>
                          <input className="input text-sm" type="number" min="4" max="28"
                            placeholder="e.g. 8"
                            value={entry.weeks || ''}
                            onChange={e => {
                              const updated = [...(ob.abortion_entries || [])]
                              updated[idx] = { ...updated[idx], weeks: e.target.value }
                              setO('abortion_entries', updated)
                            }} />
                          <p className="text-[10px] text-gray-400 mt-0.5">gestation at time of abortion</p>
                        </div>

                        {/* 3. Method — MTP Kit, D&C, etc. */}
                        <div>
                          <label className="label text-xs text-orange-700">Method</label>
                          <select className="input bg-white text-sm"
                            value={entry.method || ''}
                            onChange={e => {
                              const updated = [...(ob.abortion_entries || [])]
                              updated[idx] = { ...updated[idx], method: e.target.value as AbortionEntry['method'] }
                              setO('abortion_entries', updated)
                            }}>
                            <option value="">Select method…</option>
                            <option value="MTP Kit">MTP Kit</option>
                            <option value="D&C">D&amp;C (Dilation &amp; Curettage)</option>
                            <option value="Suction Evacuation">Suction Evacuation (MVA)</option>
                            <option value="Natural">Natural / Expectant</option>
                            <option value="Surgical">Surgical (Other)</option>
                          </select>
                        </div>

                        {/* 4. Year */}
                        <div>
                          <label className="label text-xs text-orange-700">Year</label>
                          <input className="input text-sm" type="number"
                            min="1970" max={new Date().getFullYear()}
                            placeholder={`e.g. ${new Date().getFullYear() - 2}`}
                            value={entry.years_ago || ''}
                            onChange={e => {
                              const updated = [...(ob.abortion_entries || [])]
                              updated[idx] = { ...updated[idx], years_ago: e.target.value }
                              setO('abortion_entries', updated)
                            }} />
                          <p className="text-[10px] text-gray-400 mt-0.5">year it occurred</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Per-pregnancy details table (NEW) ── */}
              <div className="mt-5">
                <div className="flex items-center justify-between mb-3">
                  <label className="label mb-0 text-gray-700">Pregnancy-wise Details</label>
                  <button type="button"
                    className="text-xs btn-secondary py-1 px-3"
                    onClick={() => {
                      const current = ob.obstetric_history || []
                      setO('obstetric_history', [
                        ...current,
                        { pregnancy_no: current.length + 1, type: '', delivery_mode: '', outcome: '', baby_gender: '', age_of_child: '' } as ObstetricEntry,
                      ])
                    }}>
                    + Add Row
                  </button>
                </div>

                {(!ob.obstetric_history || ob.obstetric_history.length === 0) ? (
                  <p className="text-xs text-gray-400 italic">Click "+ Add Row" to enter details of each past pregnancy.</p>
                ) : (
                  <>
                    {/* Column headers */}
                    <div className="hidden sm:grid grid-cols-7 gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 px-1">
                      <span>#</span>
                      <span>Type</span>
                      <span>Mode</span>
                      <span>Outcome</span>
                      <span>Gender</span>
                      <span>Child Age</span>
                      <span></span>
                    </div>
                    {(ob.obstetric_history || []).map((entry, idx) => (
                      <div key={idx}
                        className="grid grid-cols-7 gap-2 items-center border border-gray-200 rounded-lg px-3 py-2 mb-2 bg-gray-50 text-sm">
                        <span className="font-semibold text-gray-600 text-xs">{ordinal(idx + 1)}</span>
                        <select className="input text-xs bg-white col-span-1"
                          value={entry.type || ''}
                          onChange={e => {
                            const updated = [...(ob.obstetric_history || [])]
                            updated[idx] = { ...updated[idx], type: e.target.value as ObstetricEntry['type'] }
                            setO('obstetric_history', updated)
                          }}>
                          <option value="">—</option>
                          <option>Full Term</option>
                          <option>Preterm</option>
                        </select>
                        <select className="input text-xs bg-white col-span-1"
                          value={entry.delivery_mode || ''}
                          onChange={e => {
                            const updated = [...(ob.obstetric_history || [])]
                            updated[idx] = { ...updated[idx], delivery_mode: e.target.value as ObstetricEntry['delivery_mode'] }
                            setO('obstetric_history', updated)
                          }}>
                          <option value="">—</option>
                          <option>Normal</option>
                          <option>CS</option>
                        </select>
                        <select className="input text-xs bg-white col-span-1"
                          value={entry.outcome || ''}
                          onChange={e => {
                            const updated = [...(ob.obstetric_history || [])]
                            updated[idx] = { ...updated[idx], outcome: e.target.value as ObstetricEntry['outcome'] }
                            setO('obstetric_history', updated)
                          }}>
                          <option value="">—</option>
                          <option>Live</option>
                          <option>Expired</option>
                        </select>
                        <select className="input text-xs bg-white col-span-1"
                          value={entry.baby_gender || ''}
                          onChange={e => {
                            const updated = [...(ob.obstetric_history || [])]
                            updated[idx] = { ...updated[idx], baby_gender: e.target.value as ObstetricEntry['baby_gender'] }
                            setO('obstetric_history', updated)
                          }}>
                          <option value="">—</option>
                          <option value="M">Male</option>
                          <option value="F">Female</option>
                        </select>
                        <input className="input text-xs col-span-1"
                          placeholder="e.g. 3 yrs"
                          value={entry.age_of_child || ''}
                          onChange={e => {
                            const updated = [...(ob.obstetric_history || [])]
                            updated[idx] = { ...updated[idx], age_of_child: e.target.value }
                            setO('obstetric_history', updated)
                          }} />
                        <button type="button"
                          onClick={() => {
                            const updated = (ob.obstetric_history || []).filter((_, i) => i !== idx)
                            setO('obstetric_history', updated)
                          }}
                          className="text-red-400 hover:text-red-600 text-center text-xs font-bold">
                          ✕
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* B — ANC */}
            <div className="card p-5">
              <h2 className="section-title">B. Antenatal Examination</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">FHS (bpm)</label>
                  <input className={oc('fhs')} type="number" min="50" max="200" placeholder="140"
                    value={ob.fhs ?? ''} onChange={e => setO('fhs', parseInt(e.target.value)||undefined)} />
                </div>
                <div>
                  <label className="label">Liquor</label>
                  <select className={oc('liquor')} value={ob.liquor||''} onChange={e => setO('liquor',e.target.value)}>
                    <option value="">Select</option>
                    {['Normal','Reduced','Increased','Absent','Not assessed'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Fundal Height (cm)</label>
                  <input className={oc('fundal_height')} type="number" placeholder="30"
                    value={ob.fundal_height ?? ''} onChange={e => setO('fundal_height',parseFloat(e.target.value)||undefined)} />
                </div>
                <div>
                  <label className="label">Presentation</label>
                  <select className={oc('presentation')} value={ob.presentation||''} onChange={e=>setO('presentation',e.target.value)}>
                    <option value="">Select</option>
                    {['Cephalic','Breech','Transverse','Oblique','Not assessed'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Engagement</label>
                  <select className={oc('engagement')} value={ob.engagement||''} onChange={e=>setO('engagement',e.target.value)}>
                    <option value="">Select</option>
                    {['Engaged','Not engaged','2/5','3/5','4/5','5/5'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* C — Per Abdomen */}
            <div className="card p-5">
              <h2 className="section-title">C. Per Abdomen</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Uterus Size</label>
                  <select className={oc('uterus_size')} value={ob.uterus_size||''} onChange={e=>setO('uterus_size',e.target.value)}>
                    <option value="">Select</option>
                    {['Not gravid','6 wks','8 wks','10 wks','12 wks','16 wks','20 wks','24 wks','28 wks','32 wks','36 wks','40 wks'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Scar Tenderness</label>
                  <select className={oc('scar_tenderness')} value={ob.scar_tenderness||''} onChange={e=>setO('scar_tenderness',e.target.value)}>
                    <option value="">Select</option>
                    {['Present','Absent','Not applicable'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Fetal Movement</label>
                  <select className={oc('fetal_movement')} value={ob.fetal_movement||''} onChange={e=>setO('fetal_movement',e.target.value)}>
                    <option value="">Select</option>
                    {['Present','Reduced','Absent','Not assessed'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>

                {/* ── Clinical Risk Fields ── */}
                <div>
                  <label className="label">Previous CS</label>
                  <select className={oc('previous_cs')} value={ob.previous_cs ?? ''} onChange={e=>setO('previous_cs', e.target.value ? Number(e.target.value) : undefined)}>
                    <option value="">None</option>
                    {[1,2,3,4].map(n=><option key={n} value={n}>{n} previous CS</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Multiple Pregnancy</label>
                  <select className={oc('multiple_pregnancy')} value={ob.multiple_pregnancy ? 'yes' : ''} onChange={e=>setO('multiple_pregnancy', e.target.value === 'yes')}>
                    <option value="">Singleton</option>
                    <option value="yes">Twins / Multiple</option>
                  </select>
                </div>
                <div>
                  <label className="label">Gestational Diabetes</label>
                  <select className={oc('gestational_diabetes')} value={ob.gestational_diabetes ? 'yes' : ''} onChange={e=>setO('gestational_diabetes', e.target.value === 'yes')}>
                    <option value="">No</option>
                    <option value="yes">Yes — GDM</option>
                  </select>
                </div>
                <div>
                  <label className="label">Haemoglobin (g/dL)</label>
                  <input type="number" step="0.1" min="3" max="20" className={oc('haemoglobin')}
                    placeholder="e.g. 10.5"
                    value={ob.haemoglobin ?? ''} onChange={e=>setO('haemoglobin', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">Fasting Blood Sugar (mg/dL)</label>
                  <input type="number" min="30" max="500" className={oc('blood_sugar_fasting')}
                    placeholder="e.g. 92"
                    value={ob.blood_sugar_fasting ?? ''} onChange={e=>setO('blood_sugar_fasting', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">PP Blood Sugar (mg/dL)</label>
                  <input type="number" min="30" max="500" className={oc('blood_sugar_pp')}
                    placeholder="e.g. 130"
                    value={ob.blood_sugar_pp ?? ''} onChange={e=>setO('blood_sugar_pp', e.target.value ? Number(e.target.value) : undefined)} />
                </div>

                <div className="col-span-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">Per Abdomen Findings</label>
                    <SmartMic field="per_abdomen" value={ob.per_abdomen||''} onChange={v=>setO('per_abdomen',v)} context="Per Abdomen findings" />
                  </div>
                  <textarea className={`${oc('per_abdomen')} resize-none`} rows={2}
                    placeholder="Free text..." value={ob.per_abdomen||''} onChange={e=>setO('per_abdomen',e.target.value)} />
                </div>
              </div>
            </div>

            {/* D — Per Speculum */}
            <div className="card p-5">
              <h2 className="section-title">D. Per Speculum</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Cervix</label>
                  <select className={oc('cervix_speculum')} value={ob.cervix_speculum||''} onChange={e=>setO('cervix_speculum',e.target.value)}>
                    <option value="">Select</option>
                    {['Healthy','Congested','Erosion','Growth','Not examined'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Discharge</label>
                  <input className={oc('discharge_speculum')} placeholder="e.g. white, scanty"
                    value={ob.discharge_speculum||''} onChange={e=>setO('discharge_speculum',e.target.value)} />
                </div>
                <div>
                  <label className="label">Bleeding</label>
                  <select className={oc('bleeding_speculum')} value={ob.bleeding_speculum||''} onChange={e=>setO('bleeding_speculum',e.target.value)}>
                    <option value="">Select</option>
                    {['Present','Absent','Not examined'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">Per Speculum Findings</label>
                    <SmartMic field="per_speculum" value={ob.per_speculum||''} onChange={v=>setO('per_speculum',v)} context="Per Speculum findings" />
                  </div>
                  <textarea className={`${oc('per_speculum')} resize-none`} rows={2}
                    placeholder="Additional findings..." value={ob.per_speculum||''} onChange={e=>setO('per_speculum',e.target.value)} />
                </div>
              </div>
            </div>

            {/* E — Per Vaginum */}
            <div className="card p-5">
              <h2 className="section-title">E. Per Vaginum (PV)</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Cervix Feel</label>
                  <select className={oc('cervix_pv')} value={ob.cervix_pv||''} onChange={e=>setO('cervix_pv',e.target.value)}>
                    <option value="">Select</option>
                    {['Firm','Soft','Not examined'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Os</label>
                  <select className={oc('os_pv')} value={ob.os_pv||''} onChange={e=>setO('os_pv',e.target.value)}>
                    <option value="">Select</option>
                    {['Closed','Fingertip','1 cm','2 cm','3 cm','4 cm','Fully dilated','Not examined'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Uterus Position</label>
                  <select className={oc('uterus_position')} value={ob.uterus_position||''} onChange={e=>setO('uterus_position',e.target.value)}>
                    <option value="">Select</option>
                    {['Anteverted','Retroverted','Mid-position','Not examined'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">PV Findings / Adnexa</label>
                    <SmartMic field="per_vaginum" value={ob.per_vaginum||''} onChange={v=>setO('per_vaginum',v)} context="Per Vaginum PV findings" />
                  </div>
                  <textarea className={`${oc('per_vaginum')} resize-none`} rows={2}
                    placeholder="Adnexa, fornices, masses..." value={ob.per_vaginum||''} onChange={e=>setO('per_vaginum',e.target.value)} />
                </div>
              </div>
            </div>

            {/* F — Ovary */}
            <div className="card p-5">
              <h2 className="section-title">F. Ovary Findings</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Right Ovary</label>
                  <textarea className={`${oc('right_ovary')} resize-none`} rows={2}
                    placeholder="Size, texture, cysts..." value={ob.right_ovary||''} onChange={e=>setO('right_ovary',e.target.value)} />
                </div>
                <div>
                  <label className="label">Left Ovary</label>
                  <textarea className={`${oc('left_ovary')} resize-none`} rows={2}
                    placeholder="Size, texture, cysts..." value={ob.left_ovary||''} onChange={e=>setO('left_ovary',e.target.value)} />
                </div>
              </div>
            </div>

            {/* G — USG / Ultrasound Report */}
            <div className="card p-5">
              <h2 className="section-title">G. USG / Ultrasound Report</h2>
              <p className="text-xs text-gray-400 mb-3">Enter structured USG findings. These are tracked across visits for trend analysis.</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">USG Date</label>
                  <input type="date" className={oc('usg_date')}
                    value={ob.usg_date||''} onChange={e=>setO('usg_date',e.target.value)} />
                </div>
                <div>
                  <label className="label">GA at USG</label>
                  <input className={oc('usg_ga')} placeholder="e.g. 28w3d"
                    value={ob.usg_ga||''} onChange={e=>setO('usg_ga',e.target.value)} />
                </div>
                <div>
                  <label className="label">EFW (grams)</label>
                  <input type="number" min="100" max="6000" className={oc('efw')}
                    placeholder="e.g. 1200"
                    value={ob.efw??''} onChange={e=>setO('efw', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">BPD (mm)</label>
                  <input type="number" min="10" max="120" className={oc('bpd')}
                    placeholder="e.g. 72"
                    value={ob.bpd??''} onChange={e=>setO('bpd', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">HC (mm)</label>
                  <input type="number" min="50" max="400" className={oc('hc')}
                    placeholder="e.g. 260"
                    value={ob.hc??''} onChange={e=>setO('hc', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">AC (mm)</label>
                  <input type="number" min="50" max="400" className={oc('ac')}
                    placeholder="e.g. 240"
                    value={ob.ac??''} onChange={e=>setO('ac', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">FL (mm)</label>
                  <input type="number" min="10" max="90" className={oc('fl')}
                    placeholder="e.g. 52"
                    value={ob.fl??''} onChange={e=>setO('fl', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">AFI (cm)</label>
                  <input type="number" step="0.1" min="0" max="40" className={oc('afi')}
                    placeholder="e.g. 12.5"
                    value={ob.afi??''} onChange={e=>setO('afi', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">Placenta Position</label>
                  <select className={oc('placenta')} value={ob.placenta||''} onChange={e=>setO('placenta',e.target.value)}>
                    <option value="">Select</option>
                    {['Anterior','Posterior','Fundal','Lateral','Low-lying','Previa'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Placenta Grade</label>
                  <select className={oc('placenta_grade')} value={ob.placenta_grade||''} onChange={e=>setO('placenta_grade',e.target.value)}>
                    <option value="">Select</option>
                    {['Grade 0','Grade I','Grade II','Grade III'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Cord Loops</label>
                  <select className={oc('cord_loops')} value={ob.cord_loops||''} onChange={e=>setO('cord_loops',e.target.value)}>
                    <option value="">None</option>
                    {['1 loop around neck','2 loops around neck','Body loop','Multiple loops'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="label">USG Remarks / Additional Findings</label>
                  <textarea className={`${oc('usg_remarks')} resize-none`} rows={2}
                    placeholder="e.g. Single live intrauterine fetus, cephalic, adequate liquor..."
                    value={ob.usg_remarks||''} onChange={e=>setO('usg_remarks',e.target.value)} />
                </div>
              </div>
            </div>

            {/* ── PAST MEDICAL & SURGICAL HISTORY (NEW) ──────────── */}
            <div className="card p-5">
              <h2 className="section-title">Past Medical & Surgical History</h2>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="label mb-3">Conditions (tick all that apply)</label>
                  <div className="flex flex-col gap-3 mt-1">
                    {(
                      [
                        { key: 'past_diabetes',     label: 'Diabetic'          },
                        { key: 'past_hypertension', label: 'Hypertension / BP' },
                        { key: 'past_thyroid',      label: 'Thyroid Disorder'  },
                      ] as Array<{ key: keyof OBData; label: string }>
                    ).map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!(ob as any)[key]}
                          onChange={e => setO(key, e.target.checked)}
                          className="w-4 h-4 rounded accent-blue-600"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer select-none mb-2">
                    <input
                      type="checkbox"
                      checked={!!ob.past_surgery}
                      onChange={e => setO('past_surgery', e.target.checked)}
                      className="w-4 h-4 rounded accent-blue-600"
                    />
                    Previous Surgery
                  </label>
                  {ob.past_surgery && (
                    <textarea
                      className="input resize-none mt-1"
                      rows={3}
                      placeholder="Describe: type of surgery, year, hospital..."
                      value={ob.past_surgery_detail || ''}
                      onChange={e => setO('past_surgery_detail', e.target.value)}
                    />
                  )}
                  {!ob.past_surgery && (
                    <p className="text-xs text-gray-400 mt-1 italic">Tick the checkbox above to add surgery details.</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── SOCIOECONOMIC / CA DATA (NEW) ──────────────────── */}
            <div className="card p-5">
              <h2 className="section-title">Socioeconomic Information</h2>
              <p className="text-xs text-gray-400 mb-4">
                Optional — used for BPL / subsidy / insurance eligibility assessment.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Monthly Income (₹)</label>
                  <input className="input" type="number" min="0"
                    placeholder="e.g. 8000"
                    value={ob.income || ''}
                    onChange={e => setO('income', e.target.value)} />
                </div>
                <div>
                  <label className="label">Monthly Expenditure (₹)</label>
                  <input className="input" type="number" min="0"
                    placeholder="e.g. 6000"
                    value={ob.expenditure || ''}
                    onChange={e => setO('expenditure', e.target.value)} />
                </div>
              </div>
            </div>

            {/* OCR highlight note */}
            {Object.values(obHL).some(Boolean) && (
              <div className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
                <ScanLine className="w-3.5 h-3.5 flex-shrink-0" />
                Yellow fields were filled from the scanned form. Please verify before saving.
              </div>
            )}

            <div className="flex justify-between">
              <button onClick={() => setTab('consultation')} className="btn-secondary flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={handleSave} disabled={saving}
                className="btn-primary flex items-center gap-2 px-8 disabled:opacity-60">
                {saving
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Save className="w-4 h-4" />}
                Save & Continue to Prescription
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Files & Photos — scoped to patient (no encounterId yet, available after save) */}
      {patientId && (
        <div className="mt-4 mx-4 mb-6">
          <ConsultationAttachments
            patientId={patientId}
            compact={false}
          />
        </div>
      )}

    </AppShell>
  )
}

// ── Reusable Vital input card ─────────────────────────────────
function VitalCard({
  label, unit, placeholder, color, value, highlighted, onChange,
}: {
  label: string; unit: string; placeholder: string
  color: string; highlighted: boolean; value: string
  onChange: (v: string) => void
}) {
  const ring: Record<string, string> = {
    red:    'focus:ring-red-400',
    orange: 'focus:ring-orange-400',
    blue:   'focus:ring-blue-400',
    green:  'focus:ring-green-400',
    purple: 'focus:ring-purple-400',
  }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number" step="any" placeholder={placeholder}
          className={`input ${ring[color] || ''} ${highlighted ? 'ocr-filled' : ''}`}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <span className="text-xs text-gray-400 whitespace-nowrap">{unit}</span>
      </div>
    </div>
  )
}