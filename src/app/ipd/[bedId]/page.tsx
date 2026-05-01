'use client'
/**
 * src/app/ipd/[bedId]/page.tsx — UPDATED v2
 *
 * NEW FEATURES (Issues #4 & #5):
 *
 * 1. DOCTOR NOTES TAB — Doctors can upload PDF or photo of handwritten notes.
 *    The file is stored via ConsultationAttachments. When the doctor clicks
 *    "Read Note" (📖), the AI OCR endpoint is called. Extracted fields are
 *    automatically placed into the appropriate form fields in the Vitals tab
 *    AND the Notes tab, exactly like OPD consultation does.
 *
 * 2. NURSE VIEW — After the doctor uploads and reads a note, the nurse can see:
 *    - The original photo/PDF in the "Doctor Notes" tab
 *    - The AI-extracted text pre-filled in the Notes field
 *    - Any vitals extracted from the note pre-filled in the Vitals form
 *
 * 3. SMART AUTOFILL — When AI reads a doctor note image, it extracts:
 *    - Chief complaint → nursing note text
 *    - BP, pulse, temp, SpO2 → vitals form
 *    - Diagnosis, plan, advice → nursing note text
 *    The nurse then reviews and saves — no retyping needed.
 *
 * All original logic preserved unchanged.
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import SmartMic from '@/components/shared/SmartMic'
import ConsultationAttachments from '@/components/shared/ConsultationAttachments'
import {
  ArrowLeft, Save, Plus, Trash2, CheckCircle,
  Activity, Droplets, ClipboardList, BedDouble,
  Camera, FileText, Loader2, Sparkles, AlertCircle,
  ChevronDown, ChevronUp, Eye, Stethoscope
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────
interface VitalEntry {
  time:        string
  pulse:       string
  bp_systolic: string
  bp_diastolic:string
  temperature: string
  spo2:        string
  note:        string
}

interface IOEntry {
  time:   string
  type:   'intake' | 'output'
  item:   string
  amount: string
}

interface NursingNote {
  time:    string
  author:  string
  note:    string
  type:    'nursing' | 'doctor'
}

// ── Load from Supabase ─────────────────────────────────────────
async function loadIPDFromSupabase(bedId: string) {
  try {
    const { data, error } = await supabase
      .from('ipd_nursing')
      .select('*')
      .eq('bed_id', bedId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    const vitals = (data || []).filter((r:any) => r.entry_type === 'vital').map((r:any) => ({
      time: r.recorded_time || '', pulse: r.pulse || '', bp_systolic: r.bp_systolic || '',
      bp_diastolic: r.bp_diastolic || '', temperature: r.temperature || '',
      spo2: r.spo2 || '', note: r.vital_note || '',
    }))
    const io = (data || []).filter((r:any) => r.entry_type === 'io').map((r:any) => ({
      time: r.recorded_time || '', type: r.io_type === 'Output' ? 'output' : 'intake',
      item: r.io_label || '', amount: String(r.io_amount_ml || ''),
    }))
    const notes = (data || []).filter((r:any) => r.entry_type === 'note').map((r:any) => ({
      time: r.created_at || '', author: r.nurse_name || 'Nurse',
      note: r.note_text || '', type: (r.note_type || 'nursing') as 'nursing' | 'doctor',
    }))
    return { vitals, io, notes }
  } catch {
    try {
      const raw = localStorage.getItem(`ipd_${bedId}`)
      if (raw) return JSON.parse(raw)
    } catch {}
    return { vitals: [], io: [], notes: [] }
  }
}

const emptyVital = (): VitalEntry => ({
  time: new Date().toTimeString().slice(0,5),
  pulse:'', bp_systolic:'', bp_diastolic:'', temperature:'', spo2:'', note:''
})

const emptyIO = (): IOEntry => ({
  time: new Date().toTimeString().slice(0,5),
  type: 'intake', item: '', amount: ''
})

// ── AI OCR call ────────────────────────────────────────────────
async function callOCRAutofill(file: File): Promise<{ fields: any; confidence: number; error?: string }> {
  const fd = new FormData()
  fd.append('image', file)
  fd.append('mode', 'autofill')
  fd.append('context', 'IPD doctor note — extract vitals, complaints, diagnosis, plan, medications')

  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const res = await fetch('/api/doctor-note-ocr', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { fields: {}, confidence: 0, error: err.error || 'OCR failed' }
  }
  const data = await res.json()
  return { fields: data.fields || {}, confidence: data.confidence || 0 }
}

// ── Component ──────────────────────────────────────────────────
export default function IPDNursingPage() {
  const { bedId } = useParams<{ bedId: string }>()
  const router    = useRouter()
  const { user }  = useAuth()

  const [bed,      setBed]      = useState<any>(null)
  const [patient,  setPatient]  = useState<any>(null)
  const [loading,  setLoading]  = useState(true)

  const [vitals,   setVitals]   = useState<VitalEntry[]>([])
  const [io,       setIO]       = useState<IOEntry[]>([])
  const [notes,    setNotes]    = useState<NursingNote[]>([])

  const [newVital,   setNewVital]   = useState<VitalEntry>(emptyVital())
  const [newIO,      setNewIO]      = useState<IOEntry>(emptyIO())
  const [newNote,    setNewNote]    = useState('')
  const [noteAuthor, setNoteAuthor] = useState('')
  const [noteType,   setNoteType]   = useState<'nursing' | 'doctor'>('nursing')

  const [saved,     setSaved]     = useState(false)
  const [activeTab, setActiveTab] = useState<'vitals'|'io'|'notes'|'doctor-notes'>('vitals')

  // Doctor note photo upload + OCR state
  const [ocrLoading,    setOcrLoading]    = useState(false)
  const [ocrResult,     setOcrResult]     = useState<any>(null)
  const [ocrError,      setOcrError]      = useState('')
  const [autofillApplied, setAutofillApplied] = useState(false)
  const [showOcrPreview,  setShowOcrPreview]  = useState(false)

  useEffect(() => {
    if (user?.full_name) setNoteAuthor(user.full_name)
  }, [user])

  useEffect(() => {
    if (!bedId) return
    loadBed()
    loadIPDFromSupabase(bedId).then(stored => {
      setVitals(stored.vitals || [])
      setIO(stored.io || [])
      setNotes(stored.notes || [])
    })
  }, [bedId])

  // ── Listen for autofill events from ConsultationAttachments ──
  useEffect(() => {
    function handleAutofill(e: CustomEvent) {
      const { fields, formType } = e.detail || {}
      if (!fields) return
      applyAutofillFromFields(fields)
    }
    window.addEventListener('autofill-fields', handleAutofill as EventListener)
    return () => window.removeEventListener('autofill-fields', handleAutofill as EventListener)
  }, [])

  // ── Apply extracted fields to forms ──────────────────────────
  function applyAutofillFromFields(fields: any) {
    // ── Vitals autofill ──
    let vitalsFilled = false
    setNewVital(prev => {
      const updated = { ...prev }
      if (fields.pulse)       { updated.pulse        = String(fields.pulse);       vitalsFilled = true }
      if (fields.bp_systolic) { updated.bp_systolic  = String(fields.bp_systolic); vitalsFilled = true }
      if (fields.bp_diastolic){ updated.bp_diastolic = String(fields.bp_diastolic);vitalsFilled = true }
      if (fields.temperature) { updated.temperature  = String(fields.temperature); vitalsFilled = true }
      if (fields.spo2)        { updated.spo2         = String(fields.spo2);        vitalsFilled = true }
      return updated
    })

    // ── Notes autofill ──
    const lines: string[] = []
    if (fields.chief_complaint)     lines.push(`C/O: ${fields.chief_complaint}`)
    if (fields.history)             lines.push(`Hx: ${fields.history}`)
    if (fields.examination_findings)lines.push(`O/E: ${fields.examination_findings}`)
    if (fields.diagnosis)           lines.push(`Dx: ${fields.diagnosis}`)
    if (fields.treatment_plan)      lines.push(`Plan: ${fields.treatment_plan}`)
    if (fields.advice)              lines.push(`Advice: ${fields.advice}`)
    if (fields.investigations_ordered) lines.push(`Ix: ${fields.investigations_ordered}`)
    if (Array.isArray(fields.medicines) && fields.medicines.length > 0) {
      lines.push(`Rx: ${fields.medicines.map((m:any) => `${m.name||''} ${m.dose||''} ${m.frequency||''}`).join(', ')}`)
    }

    if (lines.length > 0) {
      setNewNote(prev => prev ? prev + '\n' + lines.join('\n') : lines.join('\n'))
      setNoteType('doctor')
    }

    // Switch to correct tab
    if (vitalsFilled) {
      setActiveTab('vitals')
    } else if (lines.length > 0) {
      setActiveTab('notes')
    }

    setAutofillApplied(true)
    setTimeout(() => setAutofillApplied(false), 3000)
  }

  async function loadBed() {
    const { data: b } = await supabase.from('beds').select('*').eq('id', bedId).single()
    if (!b) { setLoading(false); return }
    setBed(b)
    if (b.patient_id) {
      const { data: p } = await supabase.from('patients').select('*').eq('id', b.patient_id).single()
      setPatient(p)
    }
    setLoading(false)
  }

  function persist(v = vitals, i = io, n = notes) {
    localStorage.setItem(`ipd_${bedId}`, JSON.stringify({ vitals: v, io: i, notes: n }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // ── Add vital ──────────────────────────────────────────────────
  async function addVital() {
    if (!newVital.pulse && !newVital.bp_systolic && !newVital.temperature && !newVital.spo2) return
    const t = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })
    const entry = { ...newVital, time: t }
    const updated = [entry, ...vitals]
    setVitals(updated)
    setNewVital(emptyVital())
    persist(updated, io, notes)
    await supabase.from('ipd_nursing').insert({
      bed_id: bedId, patient_id: patient?.id || null, entry_type: 'vital',
      recorded_time: t, pulse: entry.pulse || null, bp_systolic: entry.bp_systolic || null,
      bp_diastolic: entry.bp_diastolic || null, temperature: entry.temperature || null,
      spo2: entry.spo2 || null, vital_note: entry.note || null,
    }).then(({ error }) => { if (error) console.warn('IPD vital save:', error.message) })
  }

  // ── Add I/O ────────────────────────────────────────────────────
  async function addIO() {
    if (!newIO.item || !newIO.amount) return
    const t = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })
    const entry = { ...newIO, time: t }
    const updated = [entry, ...io]
    setIO(updated)
    setNewIO(emptyIO())
    persist(vitals, updated, notes)
    await supabase.from('ipd_nursing').insert({
      bed_id: bedId, patient_id: patient?.id || null, entry_type: 'io',
      recorded_time: t, io_type: entry.type === 'output' ? 'Output' : 'Intake',
      io_label: entry.item, io_amount_ml: parseFloat(entry.amount) || null,
    }).then(({ error }) => { if (error) console.warn('IPD IO save:', error.message) })
  }

  // ── Add note ───────────────────────────────────────────────────
  async function addNote() {
    if (!newNote.trim()) return
    const t = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })
    const entry: NursingNote = {
      time: t, author: noteAuthor || user?.full_name || 'Nurse',
      note: newNote.trim(), type: noteType,
    }
    const updated = [entry, ...notes]
    setNotes(updated)
    setNewNote('')
    persist(vitals, io, updated)
    await supabase.from('ipd_nursing').insert({
      bed_id: bedId, patient_id: patient?.id || null, entry_type: 'note',
      nurse_name: entry.author, note_text: entry.note, note_type: entry.type,
    }).then(({ error }) => { if (error) console.warn('IPD note save:', error.message) })
  }

  // ── Handle doctor note photo — direct upload + OCR ────────────
  async function handleDoctorNotePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setOcrLoading(true)
    setOcrError('')
    setOcrResult(null)
    setActiveTab('doctor-notes')

    const result = await callOCRAutofill(file)
    setOcrLoading(false)

    if (result.error) {
      setOcrError(result.error)
      return
    }

    setOcrResult(result)
    setShowOcrPreview(true)
  }

  // ── Apply OCR result to forms ─────────────────────────────────
  function applyOCRResult() {
    if (!ocrResult?.fields) return
    applyAutofillFromFields(ocrResult.fields)
    setShowOcrPreview(false)
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
        </div>
      </AppShell>
    )
  }

  if (!bed) {
    return (
      <AppShell>
        <div className="p-6 text-center">
          <p className="text-gray-500">Bed not found.</p>
          <Link href="/ipd" className="btn-primary mt-4 inline-flex">Back to IPD</Link>
        </div>
      </AppShell>
    )
  }

  const totalIntake = io.filter(e => e.type === 'intake').reduce((s,e) => s + (parseFloat(e.amount)||0), 0)
  const totalOutput = io.filter(e => e.type === 'output').reduce((s,e) => s + (parseFloat(e.amount)||0), 0)

  const TABS = [
    { id: 'vitals',       label: '📈 Vitals',         icon: Activity      },
    { id: 'io',           label: '💧 I/O Chart',       icon: Droplets      },
    { id: 'notes',        label: '📝 Nursing Notes',   icon: ClipboardList },
    { id: 'doctor-notes', label: '🩺 Doctor Notes',    icon: Stethoscope   },
  ] as const

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => router.push('/ipd')} className="text-gray-400 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5"/>
          </button>
          <BedDouble className="w-6 h-6 text-blue-600"/>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Bed {bed.bed_number} — IPD Chart
            </h1>
            {patient && (
              <p className="text-sm text-gray-500">
                {patient.full_name} · MRN: {patient.mrn} · {patient.age}y
              </p>
            )}
          </div>
          {saved && (
            <span className="ml-auto flex items-center gap-1 text-green-600 text-sm font-medium">
              <CheckCircle className="w-4 h-4"/> Saved
            </span>
          )}
        </div>

        {/* Autofill success banner */}
        {autofillApplied && (
          <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-green-800">
            <Sparkles className="w-4 h-4 text-green-600 flex-shrink-0"/>
            AI has filled in the fields from the doctor note. Please review and save.
          </div>
        )}

        {/* OCR Result Preview Modal */}
        {showOcrPreview && ocrResult && (
          <div className="mb-5 bg-blue-50 border border-blue-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-blue-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4"/> AI Extracted Data
                <span className="text-xs font-normal text-blue-600 ml-1">
                  Confidence: {Math.round((ocrResult.confidence || 0) * 100)}%
                </span>
              </h3>
              <button onClick={() => setShowOcrPreview(false)} className="text-blue-400 hover:text-blue-700 text-xs">
                Dismiss
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mb-4">
              {Object.entries(ocrResult.fields || {}).map(([k, v]: any) => (
                v && typeof v !== 'object' ? (
                  <div key={k} className="flex gap-2">
                    <span className="text-blue-500 capitalize font-medium text-xs min-w-[120px]">
                      {k.replace(/_/g, ' ')}:
                    </span>
                    <span className="text-blue-900 text-xs">{String(v)}</span>
                  </div>
                ) : null
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={applyOCRResult} className="btn-primary text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4"/> Apply to Forms
              </button>
              <button onClick={() => setShowOcrPreview(false)} className="btn-secondary text-sm">
                Discard
              </button>
            </div>
          </div>
        )}

        {ocrError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0"/>
            {ocrError}
            <button onClick={() => setOcrError('')} className="ml-auto text-xs underline">Dismiss</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all
                ${activeTab === tab.id ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="card p-5">

          {/* ── VITALS TAB ────────────────────────────────────── */}
          {activeTab === 'vitals' && (
            <div>
              {/* ── New vital entry form ─── */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  Record Vitals
                  {(newVital.pulse || newVital.bp_systolic || newVital.temperature || newVital.spo2) && (
                    <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                      ✨ Pre-filled from doctor note
                    </span>
                  )}
                </h3>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="label">Pulse (bpm)</label>
                    <input className="input bg-white" type="number" placeholder="72"
                      value={newVital.pulse} onChange={e => setNewVital(p => ({ ...p, pulse: e.target.value }))}/>
                  </div>
                  <div>
                    <label className="label">BP Systolic</label>
                    <input className="input bg-white" type="number" placeholder="120"
                      value={newVital.bp_systolic} onChange={e => setNewVital(p => ({ ...p, bp_systolic: e.target.value }))}/>
                  </div>
                  <div>
                    <label className="label">BP Diastolic</label>
                    <input className="input bg-white" type="number" placeholder="80"
                      value={newVital.bp_diastolic} onChange={e => setNewVital(p => ({ ...p, bp_diastolic: e.target.value }))}/>
                  </div>
                  <div>
                    <label className="label">Temperature (°C)</label>
                    <input className="input bg-white" type="number" step="0.1" placeholder="98.6"
                      value={newVital.temperature} onChange={e => setNewVital(p => ({ ...p, temperature: e.target.value }))}/>
                  </div>
                  <div>
                    <label className="label">SpO₂ (%)</label>
                    <input className="input bg-white" type="number" placeholder="98"
                      value={newVital.spo2} onChange={e => setNewVital(p => ({ ...p, spo2: e.target.value }))}/>
                  </div>
                  <div>
                    <label className="label">Note</label>
                    <input className="input bg-white" placeholder="e.g. post-op"
                      value={newVital.note} onChange={e => setNewVital(p => ({ ...p, note: e.target.value }))}/>
                  </div>
                </div>
                <button onClick={addVital} className="btn-primary flex items-center gap-2 text-xs">
                  <Plus className="w-3.5 h-3.5"/> Record Vitals
                </button>
              </div>

              {/* Vitals table */}
              {vitals.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No vitals recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        {['Time','Pulse','BP','Temp','SpO₂','Note',''].map(h => (
                          <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {vitals.map((v,i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{v.time}</td>
                          <td className="px-3 py-2.5">{v.pulse ? <span className={parseInt(v.pulse)>100||parseInt(v.pulse)<60?'text-red-600 font-semibold':''}>{v.pulse}</span> : '—'}</td>
                          <td className="px-3 py-2.5">{v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '—'}</td>
                          <td className="px-3 py-2.5">{v.temperature || '—'}</td>
                          <td className="px-3 py-2.5">{v.spo2 ? <span className={parseInt(v.spo2)<95?'text-red-600 font-semibold':''}>{v.spo2}%</span> : '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs max-w-[180px] truncate">{v.note || '—'}</td>
                          <td className="px-3 py-2.5">
                            <button onClick={() => { const u=vitals.filter((_,j)=>j!==i); setVitals(u); persist(u,io,notes) }}
                              className="text-red-400 hover:text-red-600">
                              <Trash2 className="w-3.5 h-3.5"/>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── I/O TAB ───────────────────────────────────────── */}
          {activeTab === 'io' && (
            <div>
              <div className="bg-green-50 border border-green-100 rounded-xl p-4 mb-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Record Intake / Output</h3>
                <div className="grid grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="label">Type</label>
                    <select className="input bg-white" value={newIO.type}
                      onChange={e => setNewIO(p => ({ ...p, type: e.target.value as 'intake'|'output' }))}>
                      <option value="intake">Intake</option>
                      <option value="output">Output</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="label">Item</label>
                    <input className="input bg-white" placeholder="e.g. IV Fluids, Oral, Urine, Drain"
                      value={newIO.item} onChange={e => setNewIO(p => ({ ...p, item: e.target.value }))}/>
                  </div>
                  <div>
                    <label className="label">Amount (ml)</label>
                    <input className="input bg-white" type="number" placeholder="500"
                      value={newIO.amount} onChange={e => setNewIO(p => ({ ...p, amount: e.target.value }))}/>
                  </div>
                </div>
                <button onClick={addIO} className="btn-primary flex items-center gap-2 text-xs">
                  <Plus className="w-3.5 h-3.5"/> Add Entry
                </button>
              </div>

              {/* Totals */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-blue-700">{totalIntake} ml</div>
                  <div className="text-xs text-blue-500">Total Intake</div>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-red-700">{totalOutput} ml</div>
                  <div className="text-xs text-red-500">Total Output</div>
                </div>
                <div className={`rounded-lg p-3 text-center ${totalIntake - totalOutput >= 0 ? 'bg-green-50' : 'bg-orange-50'}`}>
                  <div className={`text-lg font-bold ${totalIntake - totalOutput >= 0 ? 'text-green-700' : 'text-orange-700'}`}>
                    {totalIntake - totalOutput >= 0 ? '+' : ''}{totalIntake - totalOutput} ml
                  </div>
                  <div className="text-xs text-gray-500">Net Balance</div>
                </div>
              </div>

              {io.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No I/O entries yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      {['Time','Type','Item','Amount',''].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {io.map((e,i) => (
                      <tr key={i} className={`border-b border-gray-50 ${e.type==='intake'?'hover:bg-blue-50':'hover:bg-red-50'}`}>
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{e.time}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${e.type==='intake'?'bg-blue-100 text-blue-700':'bg-red-100 text-red-700'}`}>
                            {e.type}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-medium">{e.item}</td>
                        <td className="px-3 py-2.5 font-mono">{e.amount} ml</td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => { const u=io.filter((_,j)=>j!==i); setIO(u); persist(vitals,u,notes) }}
                            className="text-red-400 hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5"/>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── NURSING NOTES TAB ─────────────────────────────── */}
          {activeTab === 'notes' && (
            <div>
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 mb-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  Add Note
                  {newNote && (
                    <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                      ✨ Pre-filled from doctor note
                    </span>
                  )}
                </h3>
                <div className="grid grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="label">Author</label>
                    <input className="input bg-white" placeholder="Name"
                      value={noteAuthor} onChange={e => setNoteAuthor(e.target.value)}/>
                  </div>
                  <div className="col-span-3">
                    <div className="flex items-center justify-between mb-1">
                      <label className="label">Note</label>
                      <SmartMic field="nursing_note" value={newNote}
                        onChange={setNewNote} context="nursing note for IPD patient"/>
                    </div>
                    <textarea className="input bg-white resize-none" rows={3}
                      placeholder="e.g. Patient resting comfortably. BP stable. Catheter patent. IVF running at 60 ml/hr."
                      value={newNote} onChange={e => setNewNote(e.target.value)}/>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-2">
                    <button onClick={() => setNoteType('nursing')}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${noteType === 'nursing' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                      📋 Nursing
                    </button>
                    <button onClick={() => setNoteType('doctor')}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${noteType === 'doctor' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                      🩺 Doctor
                    </button>
                  </div>
                  <button onClick={addNote} className="btn-primary flex items-center gap-2 text-xs">
                    <Plus className="w-3.5 h-3.5"/> Add Note
                  </button>
                </div>
              </div>

              {notes.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No notes yet.</p>
              ) : (
                <div className="space-y-3">
                  {notes.map((n, i) => (
                    <div key={i} className={`border rounded-lg p-4 hover:bg-gray-50 ${n.type === 'doctor' ? 'border-blue-200 bg-blue-50/30' : 'border-gray-100'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${n.type === 'doctor' ? 'text-blue-700' : 'text-purple-700'}`}>
                            {n.type === 'doctor' ? '🩺' : '📋'} {n.author}
                          </span>
                          <span className="text-xs text-gray-400">{n.time}</span>
                        </div>
                        <button onClick={() => { const u=notes.filter((_,j)=>j!==i); setNotes(u); persist(vitals,io,u) }}
                          className="text-red-400 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5"/>
                        </button>
                      </div>
                      <p className="text-sm text-gray-700 whitespace-pre-line">{n.note}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── DOCTOR NOTES TAB (NEW) ────────────────────────── */}
          {activeTab === 'doctor-notes' && (
            <div>
              {/* Info banner */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
                <h3 className="text-sm font-bold text-blue-900 flex items-center gap-2 mb-1">
                  <Stethoscope className="w-4 h-4"/> Doctor Note Upload & AI Autofill
                </h3>
                <p className="text-xs text-blue-700 mb-3">
                  Doctor can click a photo of their handwritten note. The AI will read the note and automatically
                  fill in vitals (BP, pulse, temp, SpO₂) and nursing notes (complaint, diagnosis, plan).
                  The nurse can then review and save — no retyping needed.
                </p>

                {/* Upload button */}
                <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all
                  ${ocrLoading ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                  {ocrLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin"/> Reading note…</>
                  ) : (
                    <><Camera className="w-4 h-4"/> Click Photo of Doctor Note</>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={handleDoctorNotePhoto}
                    disabled={ocrLoading}
                    className="hidden"
                  />
                </label>

                <p className="text-xs text-blue-500 mt-2">
                  Accepts: JPG, PNG, WebP · Max 20 MB · Requires AI key configured
                </p>
              </div>

              {/* Uploaded files from ConsultationAttachments */}
              {patient?.id && (
                <div className="mb-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500"/>
                    Stored Doctor Notes & Files
                    <span className="text-xs text-gray-400 font-normal ml-1">
                      — click 📖 on any photo to re-read with AI
                    </span>
                  </h3>
                  <ConsultationAttachments
                    patientId={patient.id}
                    compact={true}
                  />
                </div>
              )}

              {/* How it works */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">How it works</h4>
                <ol className="space-y-2">
                  {[
                    { n: 1, text: 'Doctor writes notes on paper (complaint, vitals, diagnosis, plan, medications).' },
                    { n: 2, text: 'Click "Click Photo of Doctor Note" → take a clear photo of the note.' },
                    { n: 3, text: 'AI reads the handwriting and extracts: BP, pulse, temp, SpO₂, complaint, diagnosis, plan.' },
                    { n: 4, text: 'Click "Apply to Forms" — fields are auto-filled in the Vitals tab and Notes tab.' },
                    { n: 5, text: 'Nurse reviews the auto-filled data, corrects any mistakes, then saves.' },
                  ].map(s => (
                    <li key={s.n} className="flex gap-3 text-sm text-gray-600">
                      <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full text-xs flex items-center justify-center font-bold flex-shrink-0 mt-0.5">{s.n}</span>
                      {s.text}
                    </li>
                  ))}
                </ol>
              </div>

              {/* Doctor notes from notes array */}
              {notes.filter(n => n.type === 'doctor').length > 0 && (
                <div className="mt-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Recorded Doctor Notes</h3>
                  <div className="space-y-3">
                    {notes.filter(n => n.type === 'doctor').map((n, i) => (
                      <div key={i} className="border border-blue-200 rounded-lg p-4 bg-blue-50/30">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-blue-700">🩺 {n.author}</span>
                          <span className="text-xs text-gray-400">{n.time}</span>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-line">{n.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </AppShell>
  )
}