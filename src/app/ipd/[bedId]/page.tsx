'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime } from '@/lib/utils'
import SmartMic from '@/components/shared/SmartMic'
import ConsultationAttachments from '@/components/shared/ConsultationAttachments'
import {
  ArrowLeft, Save, Plus, Trash2, CheckCircle,
  Activity, Droplets, ClipboardList, BedDouble
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
  amount: string  // ml
}

interface NursingNote {
  time:    string
  author:  string
  note:    string
}

// IPD nursing data is stored in Supabase ipd_nursing table.
// Falls back to localStorage if the table doesn't exist yet (before migration).
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
      time: r.created_at || '', author: r.nurse_name || 'Nurse', note: r.note_text || '',
    }))
    return { vitals, io, notes }
  } catch {
    // Fall back to localStorage if table not set up yet
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

export default function IPDNursingPage() {
  const { bedId } = useParams<{ bedId: string }>()
  const router    = useRouter()

  const [bed,      setBed]      = useState<any>(null)
  const [patient,  setPatient]  = useState<any>(null)
  const [loading,  setLoading]  = useState(true)

  const [vitals,   setVitals]   = useState<VitalEntry[]>([])
  const [io,       setIO]       = useState<IOEntry[]>([])
  const [notes,    setNotes]    = useState<NursingNote[]>([])

  // Active entry forms
  const [newVital,  setNewVital]  = useState<VitalEntry>(emptyVital())
  const [newIO,     setNewIO]     = useState<IOEntry>(emptyIO())
  const [newNote,   setNewNote]   = useState('')
  const [noteAuthor, setNoteAuthor] = useState('Nurse')

  const [saved, setSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<'vitals'|'io'|'notes'>('vitals')

  useEffect(() => {
    if (!bedId) return
    loadBed()
    loadIPDFromSupabase(bedId).then(stored => {
      setVitals(stored.vitals || [])
      setIO(stored.io || [])
      setNotes(stored.notes || [])
    })
  }, [bedId])

  // Listen for OCR autofill from ConsultationAttachments photo upload
  // When a photo of a doctor/nurse note is read, populate the note field
  useEffect(() => {
    function handleAutofill(e: CustomEvent) {
      const { fields, formType } = e.detail || {}
      if (!fields) return
      // Build a readable note from extracted fields
      const lines: string[] = []
      if (fields.chief_complaint)      lines.push(`C/O: ${fields.chief_complaint}`)
      if (fields.examination_findings)  lines.push(`O/E: ${fields.examination_findings}`)
      if (fields.diagnosis)             lines.push(`Dx: ${fields.diagnosis}`)
      if (fields.treatment_plan)        lines.push(`Plan: ${fields.treatment_plan}`)
      if (fields.advice)                lines.push(`Advice: ${fields.advice}`)
      // vitals
      if (fields.bp_systolic)           lines.push(`BP: ${fields.bp_systolic}/${fields.bp_diastolic || '?'}`)
      if (fields.pulse)                 lines.push(`PR: ${fields.pulse}`)
      if (fields.temperature)           lines.push(`Temp: ${fields.temperature}`)
      if (fields.spo2)                  lines.push(`SpO2: ${fields.spo2}%`)
      if (lines.length > 0) {
        setNewNote(prev => prev ? prev + '\n' + lines.join('\n') : lines.join('\n'))
        setActiveTab('notes')
      }
    }
    window.addEventListener('autofill-fields', handleAutofill as EventListener)
    return () => window.removeEventListener('autofill-fields', handleAutofill as EventListener)
  }, [])

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
    // Also save to localStorage as backup
    localStorage.setItem(`ipd_${bedId}`, JSON.stringify({ vitals: v, io: i, notes: n }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // ── Add vitals ─────────────────────────────────────────────
  async function addVital() {
    if (!newVital.pulse && !newVital.bp_systolic && !newVital.temperature && !newVital.spo2) return
    const t = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })
    const entry = { ...newVital, time: t }
    const updated = [entry, ...vitals]
    setVitals(updated)
    setNewVital(emptyVital())
    persist(updated, io, notes)
    // Save to Supabase
    await supabase.from('ipd_nursing').insert({
      bed_id: bedId, patient_id: patient?.id || null, entry_type: 'vital',
      recorded_time: t, pulse: entry.pulse || null, bp_systolic: entry.bp_systolic || null,
      bp_diastolic: entry.bp_diastolic || null, temperature: entry.temperature || null,
      spo2: entry.spo2 || null, vital_note: entry.note || null,
    }).then(({ error }) => { if (error) console.warn('IPD vital save:', error.message) })
  }

  // ── Add I/O ────────────────────────────────────────────────
  async function addIO() {
    if (!newIO.item || !newIO.amount) return
    const t = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })
    const entry = { ...newIO, time: t }
    const updated = [entry, ...io]
    setIO(updated)
    setNewIO(emptyIO())
    persist(vitals, updated, notes)
    // Save to Supabase
    await supabase.from('ipd_nursing').insert({
      bed_id: bedId, patient_id: patient?.id || null, entry_type: 'io',
      recorded_time: t, io_type: entry.type === 'output' ? 'Output' : 'Input',
      io_label: entry.item || null, io_amount_ml: Number(entry.amount) || null,
    }).then(({ error }) => { if (error) console.warn('IPD io save:', error.message) })
  }

  // ── Add note ───────────────────────────────────────────────
  async function addNote() {
    if (!newNote.trim()) return
    const entry: NursingNote = {
      time:   formatDateTime(new Date().toISOString()),
      author: noteAuthor,
      note:   newNote.trim(),
    }
    const updated = [entry, ...notes]
    setNotes(updated)
    setNewNote('')
    persist(vitals, io, updated)
    // Save to Supabase
    await supabase.from('ipd_nursing').insert({
      bed_id: bedId, patient_id: patient?.id || null, entry_type: 'note',
      nurse_name: noteAuthor || null, note_text: newNote.trim(),
    }).then(({ error }) => { if (error) console.warn('IPD note save:', error.message) })
  }

  // ── I/O totals ─────────────────────────────────────────────
  const totalIn  = io.filter(e=>e.type==='intake').reduce((s,e)=>s+Number(e.amount||0), 0)
  const totalOut = io.filter(e=>e.type==='output').reduce((s,e)=>s+Number(e.amount||0), 0)
  const balance  = totalIn - totalOut

  if (loading) return (
    <AppShell><div className="p-6 flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div></AppShell>
  )

  if (!bed) return (
    <AppShell><div className="p-6 text-center py-20 text-gray-500">
      Bed not found. <Link href="/beds" className="text-blue-600 hover:underline">← Back to beds</Link>
    </div></AppShell>
  )

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5"/>
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <BedDouble className="w-5 h-5 text-blue-600"/> IPD Nursing Chart — {bed.bed_number}
            </h1>
            {patient && (
              <p className="text-sm text-gray-500">
                <strong className="text-blue-700">{patient.full_name}</strong>
                {' · '}{patient.mrn}{' · '}{patient.age}y{' · '}
                Admitted: {bed.admission_date ? formatDate(bed.admission_date) : '—'}
              </p>
            )}
            {!patient && <p className="text-sm text-gray-400">Ward: {bed.ward}</p>}
          </div>
          {patient && (
            <Link href={`/patients/${patient.id}`} className="btn-secondary text-xs">
              Patient Record
            </Link>
          )}
          {saved && (
            <span className="flex items-center gap-1 text-green-600 text-xs font-semibold">
              <CheckCircle className="w-3.5 h-3.5"/> Saved
            </span>
          )}
        </div>

        {/* I/O Summary strip */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="card p-4 bg-blue-50 text-center">
            <div className="text-2xl font-bold text-blue-700">{totalIn} ml</div>
            <div className="text-xs text-gray-500 mt-1">Total Intake</div>
          </div>
          <div className="card p-4 bg-red-50 text-center">
            <div className="text-2xl font-bold text-red-700">{totalOut} ml</div>
            <div className="text-xs text-gray-500 mt-1">Total Output</div>
          </div>
          <div className={`card p-4 text-center ${balance >= 0 ? 'bg-green-50' : 'bg-orange-50'}`}>
            <div className={`text-2xl font-bold ${balance >= 0 ? 'text-green-700' : 'text-orange-700'}`}>
              {balance >= 0 ? '+' : ''}{balance} ml
            </div>
            <div className="text-xs text-gray-500 mt-1">Fluid Balance</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="card overflow-hidden">
          <div className="flex border-b border-gray-100">
            {([
              { id:'vitals', label:'Vitals Chart',    icon: Activity },
              { id:'io',     label:'Intake / Output', icon: Droplets },
              { id:'notes',  label:`Nursing Notes (${notes.length})`, icon: ClipboardList },
            ] as {id:'vitals'|'io'|'notes'; label:string; icon:any}[]).map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors
                  ${activeTab===t.id
                    ? 'border-b-2 border-blue-600 text-blue-700 bg-blue-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
                <t.icon className="w-4 h-4"/>
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">

            {/* ── VITALS TAB ── */}
            {activeTab === 'vitals' && (
              <div>
                {/* Entry form */}
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Record Vitals</h3>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    {[
                      { label:'Pulse (bpm)',   key:'pulse',        placeholder:'72'  },
                      { label:'Temperature °C', key:'temperature',  placeholder:'37.0'},
                      { label:'SpO₂ (%)',       key:'spo2',         placeholder:'98'  },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="label">{f.label}</label>
                        <input className="input bg-white" type="number" step="any" placeholder={f.placeholder}
                          value={(newVital as any)[f.key]}
                          onChange={e => setNewVital(p => ({ ...p, [f.key]: e.target.value }))}/>
                      </div>
                    ))}
                    <div>
                      <label className="label">BP Systolic</label>
                      <input className="input bg-white" type="number" placeholder="120"
                        value={newVital.bp_systolic}
                        onChange={e => setNewVital(p => ({ ...p, bp_systolic: e.target.value }))}/>
                    </div>
                    <div>
                      <label className="label">BP Diastolic</label>
                      <input className="input bg-white" type="number" placeholder="80"
                        value={newVital.bp_diastolic}
                        onChange={e => setNewVital(p => ({ ...p, bp_diastolic: e.target.value }))}/>
                    </div>
                    <div className="col-span-3">
                      <div className="flex items-center justify-between mb-1">
                        <label className="label">Note (optional)</label>
                        <SmartMic field="vital_note" value={newVital.note}
                          onChange={v => setNewVital(p => ({ ...p, note: v }))}
                          context="nursing vital note"/>
                      </div>
                      <input className="input bg-white" placeholder="e.g. Patient comfortable, BP improving"
                        value={newVital.note}
                        onChange={e => setNewVital(p => ({ ...p, note: e.target.value }))}/>
                    </div>
                  </div>
                  <button onClick={addVital} className="btn-primary flex items-center gap-2 text-xs">
                    <Plus className="w-3.5 h-3.5"/> Add Vitals Entry
                  </button>
                </div>

                {/* Vitals log */}
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
                        {vitals.map((v, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{v.time}</td>
                            <td className="px-3 py-2.5">{v.pulse ? <span className={parseInt(v.pulse)<60||parseInt(v.pulse)>100?'text-red-600 font-semibold':''}>{v.pulse}</span> : '—'}</td>
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

            {/* ── I/O TAB ── */}
            {activeTab === 'io' && (
              <div>
                {/* Entry form */}
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

            {/* ── NOTES TAB ── */}
            {activeTab === 'notes' && (
              <div>
                {/* Entry form */}
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 mb-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Add Nursing Note</h3>
                  <div className="grid grid-cols-4 gap-3 mb-3">
                    <div>
                      <label className="label">Author</label>
                      <input className="input bg-white" placeholder="Nurse name"
                        value={noteAuthor} onChange={e => setNoteAuthor(e.target.value)}/>
                    </div>
                    <div className="col-span-3">
                      <div className="flex items-center justify-between mb-1">
                        <label className="label">Note</label>
                        <SmartMic field="nursing_note" value={newNote}
                          onChange={setNewNote} context="nursing note for IPD patient"/>
                      </div>
                      <textarea className="input bg-white resize-none" rows={2}
                        placeholder="e.g. Patient resting comfortably. Catheter patent. IVF running at 60 ml/hr."
                        value={newNote} onChange={e => setNewNote(e.target.value)}/>
                    </div>
                  </div>
                  <button onClick={addNote} className="btn-primary flex items-center gap-2 text-xs">
                    <Plus className="w-3.5 h-3.5"/> Add Note
                  </button>
                </div>

                {/* ── Photo Upload with OCR Auto-fill ─────────────────────
                    Upload a photo of a handwritten nursing/doctor note.
                    Click the "Read Handwriting" (📖) button on any image to
                    transcribe it. The transcribed text is placed into the
                    Note field above automatically via the autofill-fields event. */}
                {patient?.id && (
                  <div className="mb-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      📷 Upload Doctor / Nursing Note Photos
                      <span className="text-xs text-gray-400 font-normal">— click 📖 on an image to read handwriting &amp; fill the note field above</span>
                    </h3>
                    <ConsultationAttachments
                      patientId={patient.id}
                      compact={true}
                    />
                  </div>
                )}

                {notes.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No nursing notes yet.</p>
                ) : (
                  <div className="space-y-3">
                    {notes.map((n, i) => (
                      <div key={i} className="border border-gray-100 rounded-lg p-4 hover:bg-gray-50">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-purple-700">{n.author}</span>
                            <span className="text-xs text-gray-400">{n.time}</span>
                          </div>
                          <button onClick={() => { const u=notes.filter((_,j)=>j!==i); setNotes(u); persist(vitals,io,u) }}
                            className="text-red-400 hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5"/>
                          </button>
                        </div>
                        <p className="text-sm text-gray-700">{n.note}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}