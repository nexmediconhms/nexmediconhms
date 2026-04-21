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
import type { Patient, OBData } from '@/types'
import type { OCRResult } from '@/lib/ocr'
import { ArrowLeft, Save, ChevronRight, AlertCircle, ScanLine } from 'lucide-react'

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
interface ConsultHL { chiefComplaint?: boolean; diagnosis?: boolean; notes?: boolean }

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
  const [saving,         setSaving]        = useState(false)
  const [error,          setError]         = useState('')
  const [lastDiagnosis,  setLastDiagnosis]  = useState('')

  // OCR highlights
  const [vHL,  setVHL]  = useState<VitalsHL>({})
  const [obHL, setObHL] = useState<OBHL>({})
  const [cHL,  setCHL]  = useState<ConsultHL>({})

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
          setO(k, typeof val === 'string' ? val : String(val))
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

  // ── Save ──────────────────────────────────────────────────────
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
                      onChange={e => setO(k, parseInt(e.target.value) || 0)} />
                  </div>
                ))}
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
                    {['Present','Absent','Not assessed'].map(o=><option key={o}>{o}</option>)}
                  </select>
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
