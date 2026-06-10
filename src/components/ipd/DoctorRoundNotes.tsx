'use client'
/**
 * src/components/ipd/DoctorRoundNotes.tsx
 *
 * Structured SOAP-format daily round notes for IPD patients.
 *
 * Uses the existing `encounters` table with encounter_type = 'IPD Round'.
 * No new database table required.
 *
 * SOAP Format:
 *   S — Subjective (patient complaints, history from chief_complaint)
 *   O — Objective (vitals + examination from pulse/bp/temp/spo2 + notes)
 *   A — Assessment (diagnosis)
 *   P — Plan (treatment plan, orders, follow-up from notes field)
 *
 * USAGE: <DoctorRoundNotes patientId="..." admissionDate="..." doctorName="..." />
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate, getIndiaToday } from '@/lib/utils'
import {
  Stethoscope, Save, Loader2, CheckCircle, AlertCircle,
  Plus, Clock, ChevronDown, ChevronUp, User, Trash2,
  Activity, FileText, Edit3,
} from 'lucide-react'

interface RoundNote {
  id: string
  patient_id: string
  encounter_date: string
  encounter_type: string
  chief_complaint: string   // S — Subjective
  pulse?: number
  bp_systolic?: number
  bp_diastolic?: number
  temperature?: number
  spo2?: number
  weight?: number
  examination?: string      // O — Objective (clinical examination)
  diagnosis: string         // A — Assessment
  notes: string             // P — Plan
  doctor_name: string
  created_at: string
}

interface Props {
  patientId: string
  admissionDate: string
  doctorName?: string
}

export default function DoctorRoundNotes({ patientId, admissionDate, doctorName }: Props) {
  const [rounds, setRounds] = useState<RoundNote[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [expandedRounds, setExpandedRounds] = useState<Set<string>>(new Set())

  // Form state
  const [form, setForm] = useState({
    encounter_date: getIndiaToday(),
    round_time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }),
    subjective: '',
    pulse: '',
    bp_systolic: '',
    bp_diastolic: '',
    temperature: '',
    spo2: '',
    weight: '',
    examination: '',
    assessment: '',
    plan: '',
    doctor: doctorName || '',
  })

  // ── Load existing round notes ─────────────────────────────────
  const loadRounds = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from('encounters')
        .select('*')
        .eq('patient_id', patientId)
        .eq('encounter_type', 'IPD Round')
        .order('created_at', { ascending: false })

      if (err) throw err
      setRounds(data || [])

      // Auto-expand latest round
      if (data && data.length > 0) {
        setExpandedRounds(new Set([data[0].id]))
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load round notes')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => { loadRounds() }, [loadRounds])

  // ── Reset form ────────────────────────────────────────────────
  function resetForm() {
    setForm({
      encounter_date: getIndiaToday(),
      round_time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }),
      subjective: '',
      pulse: '',
      bp_systolic: '',
      bp_diastolic: '',
      temperature: '',
      spo2: '',
      weight: '',
      examination: '',
      assessment: '',
      plan: '',
      doctor: doctorName || '',
    })
    setEditId(null)
  }

  // ── Edit existing note ────────────────────────────────────────
  function editRound(r: RoundNote) {
    setForm({
      encounter_date: r.encounter_date || getIndiaToday(),
      round_time: r.created_at ? new Date(r.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '',
      subjective: r.chief_complaint || '',
      pulse: r.pulse?.toString() || '',
      bp_systolic: r.bp_systolic?.toString() || '',
      bp_diastolic: r.bp_diastolic?.toString() || '',
      temperature: r.temperature?.toString() || '',
      spo2: r.spo2?.toString() || '',
      weight: r.weight?.toString() || '',
      examination: r.examination || '',
      assessment: r.diagnosis || '',
      plan: r.notes || '',
      doctor: r.doctor_name || doctorName || '',
    })
    setEditId(r.id)
    setShowForm(true)
  }

  // ── Save round note ───────────────────────────────────────────
  async function saveRound() {
    if (!form.subjective && !form.assessment && !form.plan) {
      setError('Please fill at least one of: Subjective, Assessment, or Plan.')
      return
    }

    setSaving(true)
    setError('')

    const payload: any = {
      patient_id: patientId,
      encounter_date: form.encounter_date || getIndiaToday(),
      encounter_type: 'IPD Round',
      chief_complaint: form.subjective || null,
      pulse: form.pulse ? Number(form.pulse) : null,
      bp_systolic: form.bp_systolic ? Number(form.bp_systolic) : null,
      bp_diastolic: form.bp_diastolic ? Number(form.bp_diastolic) : null,
      temperature: form.temperature ? Number(form.temperature) : null,
      spo2: form.spo2 ? Number(form.spo2) : null,
      weight: form.weight ? Number(form.weight) : null,
      diagnosis: form.assessment || null,
      notes: form.plan || null,
      doctor_name: form.doctor || null,
      updated_at: new Date().toISOString(),
    }

    // Store examination in notes alongside plan if both present
    if (form.examination) {
      payload.notes = `[Examination]: ${form.examination}${form.plan ? `\n[Plan]: ${form.plan}` : ''}`
    }

    try {
      if (editId) {
        const { error: upErr } = await supabase
          .from('encounters')
          .update(payload)
          .eq('id', editId)
        if (upErr) throw upErr
      } else {
        const { error: insErr } = await supabase
          .from('encounters')
          .insert(payload)
        if (insErr) throw insErr
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      resetForm()
      setShowForm(false)
      loadRounds()
    } catch (err: any) {
      setError(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete round note ─────────────────────────────────────────
  async function deleteRound(id: string) {
    if (!window.confirm('Delete this round note? This cannot be undone.')) return
    try {
      await supabase.from('encounters').delete().eq('id', id)
      loadRounds()
    } catch (err: any) {
      setError(`Delete failed: ${err.message}`)
    }
  }

  // ── Toggle expand ─────────────────────────────────────────────
  function toggleExpand(id: string) {
    setExpandedRounds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Parse notes for examination and plan ──────────────────────
  function parseNotes(notes: string): { examination: string; plan: string } {
    if (!notes) return { examination: '', plan: notes || '' }
    const examMatch = notes.match(/\[Examination\]:\s*([\s\S]*?)(?=\[Plan\]:|$)/)
    const planMatch = notes.match(/\[Plan\]:\s*([\s\S]*)/)
    if (examMatch || planMatch) {
      return {
        examination: examMatch?.[1]?.trim() || '',
        plan: planMatch?.[1]?.trim() || notes,
      }
    }
    return { examination: '', plan: notes }
  }

  // ── Group rounds by date ──────────────────────────────────────
  const roundsByDate: Record<string, RoundNote[]> = {}
  rounds.forEach(r => {
    const dt = r.encounter_date || 'Unknown'
    if (!roundsByDate[dt]) roundsByDate[dt] = []
    roundsByDate[dt].push(r)
  })

  // ── Loading state ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        <span className="ml-2 text-sm text-gray-500">Loading round notes...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <Stethoscope className="w-5 h-5 text-indigo-500" />
          Doctor's Daily Round Notes
          <span className="text-xs text-gray-400 font-normal">({rounds.length} entries)</span>
        </h3>
        <button onClick={() => { resetForm(); setShowForm(!showForm) }}
          className={`text-sm px-3 py-1.5 rounded-lg font-medium flex items-center gap-1 ${
            showForm
              ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}>
          {showForm ? '✕ Cancel' : <><Plus className="w-4 h-4" /> New Round Note</>}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" /> Round note saved successfully.
        </div>
      )}

      {/* ═══════ NEW ROUND NOTE FORM ═══════ */}
      {showForm && (
        <div className="bg-indigo-50/50 border border-indigo-200 rounded-xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-indigo-800 flex items-center gap-2">
            <Edit3 className="w-4 h-4" />
            {editId ? 'Edit Round Note' : 'New Round Note'} — SOAP Format
          </h4>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Date</label>
              <input type="date" value={form.encounter_date}
                onChange={e => setForm(p => ({ ...p, encounter_date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Time</label>
              <input type="time" value={form.round_time}
                onChange={e => setForm(p => ({ ...p, round_time: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Doctor</label>
              <input type="text" value={form.doctor}
                onChange={e => setForm(p => ({ ...p, doctor: e.target.value }))}
                placeholder="Dr. name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          {/* S — Subjective */}
          <div>
            <label className="text-xs font-bold text-blue-700 block mb-1 flex items-center gap-1">
              <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">S</span>
              Subjective — Patient Complaints & History
            </label>
            <textarea value={form.subjective}
              onChange={e => setForm(p => ({ ...p, subjective: e.target.value }))}
              rows={2}
              placeholder="Patient complains of... History of present illness... Sleep, appetite, pain score..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          {/* O — Objective */}
          <div>
            <label className="text-xs font-bold text-green-700 block mb-1 flex items-center gap-1">
              <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">O</span>
              Objective — Vitals & Examination
            </label>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-2">
              <div>
                <label className="text-[10px] text-gray-400">Pulse</label>
                <input type="number" value={form.pulse}
                  onChange={e => setForm(p => ({ ...p, pulse: e.target.value }))}
                  placeholder="/min" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400">BP Sys</label>
                <input type="number" value={form.bp_systolic}
                  onChange={e => setForm(p => ({ ...p, bp_systolic: e.target.value }))}
                  placeholder="mmHg" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400">BP Dia</label>
                <input type="number" value={form.bp_diastolic}
                  onChange={e => setForm(p => ({ ...p, bp_diastolic: e.target.value }))}
                  placeholder="mmHg" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400">Temp °F</label>
                <input type="number" step="0.1" value={form.temperature}
                  onChange={e => setForm(p => ({ ...p, temperature: e.target.value }))}
                  placeholder="°F" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400">SpO₂ %</label>
                <input type="number" value={form.spo2}
                  onChange={e => setForm(p => ({ ...p, spo2: e.target.value }))}
                  placeholder="%" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400">Weight kg</label>
                <input type="number" step="0.1" value={form.weight}
                  onChange={e => setForm(p => ({ ...p, weight: e.target.value }))}
                  placeholder="kg" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
            </div>
            <textarea value={form.examination}
              onChange={e => setForm(p => ({ ...p, examination: e.target.value }))}
              rows={2}
              placeholder="General appearance, per abdomen, per vaginal, wound site, fundal height, FHS, lochia..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          {/* A — Assessment */}
          <div>
            <label className="text-xs font-bold text-amber-700 block mb-1 flex items-center gap-1">
              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold">A</span>
              Assessment — Diagnosis / Impression
            </label>
            <textarea value={form.assessment}
              onChange={e => setForm(p => ({ ...p, assessment: e.target.value }))}
              rows={2}
              placeholder="Primary diagnosis, differential diagnosis, current status..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          {/* P — Plan */}
          <div>
            <label className="text-xs font-bold text-red-700 block mb-1 flex items-center gap-1">
              <span className="w-5 h-5 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold">P</span>
              Plan — Orders & Treatment Plan
            </label>
            <textarea value={form.plan}
              onChange={e => setForm(p => ({ ...p, plan: e.target.value }))}
              rows={3}
              placeholder="Medications to continue/change, IV fluids, investigations ordered, diet, physiotherapy, expected discharge, surgery plan..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); resetForm() }}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={saveRound} disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editId ? 'Update Note' : 'Save Round Note'}
            </button>
          </div>
        </div>
      )}

      {/* ═══════ ROUND NOTES HISTORY ═══════ */}
      {rounds.length === 0 && !showForm && (
        <div className="text-center py-8 text-gray-400">
          <Stethoscope className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No round notes recorded yet.</p>
          <p className="text-xs mt-1">Click "New Round Note" to record the doctor's daily assessment.</p>
        </div>
      )}

      {Object.keys(roundsByDate).length > 0 && (
        <div className="space-y-4">
          {Object.entries(roundsByDate).map(([date, dayRounds]) => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-indigo-400"></div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {formatDate(date)}
                  <span className="ml-2 text-gray-400 font-normal">
                    ({dayRounds.length} round{dayRounds.length > 1 ? 's' : ''})
                  </span>
                </span>
                <div className="flex-1 border-t border-gray-200"></div>
              </div>

              <div className="space-y-2 ml-3 border-l-2 border-indigo-100 pl-4">
                {dayRounds.map(r => {
                  const isExpanded = expandedRounds.has(r.id)
                  const { examination, plan } = parseNotes(r.notes || '')
                  const timeStr = r.created_at
                    ? new Date(r.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
                    : ''

                  return (
                    <div key={r.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-indigo-200 transition-colors">
                      {/* Collapsed header */}
                      <button onClick={() => toggleExpand(r.id)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50">
                        <div className="flex items-center gap-3">
                          <Clock className="w-3.5 h-3.5 text-gray-400" />
                          <span className="text-xs text-gray-500 font-mono">{timeStr}</span>
                          <span className="text-xs text-indigo-600 font-medium">{r.doctor_name || 'Doctor'}</span>
                          {r.diagnosis && (
                            <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full truncate max-w-[200px]">
                              {r.diagnosis}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Quick vitals badges */}
                          {r.bp_systolic && (
                            <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                              BP {r.bp_systolic}/{r.bp_diastolic}
                            </span>
                          )}
                          {r.pulse && (
                            <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                              P {r.pulse}
                            </span>
                          )}
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                        </div>
                      </button>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100">
                          {/* S */}
                          {r.chief_complaint && (
                            <div className="flex gap-2">
                              <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">S</span>
                              <div>
                                <span className="text-[10px] text-blue-600 font-semibold uppercase">Subjective</span>
                                <p className="text-sm text-gray-700 whitespace-pre-line">{r.chief_complaint}</p>
                              </div>
                            </div>
                          )}

                          {/* O */}
                          {(r.pulse || r.bp_systolic || r.temperature || r.spo2 || examination) && (
                            <div className="flex gap-2">
                              <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">O</span>
                              <div className="w-full">
                                <span className="text-[10px] text-green-600 font-semibold uppercase">Objective</span>
                                {(r.pulse || r.bp_systolic || r.temperature || r.spo2) && (
                                  <div className="flex flex-wrap gap-2 mt-1 mb-1">
                                    {r.pulse && <VitalBadge label="Pulse" value={`${r.pulse}/min`} />}
                                    {r.bp_systolic && <VitalBadge label="BP" value={`${r.bp_systolic}/${r.bp_diastolic} mmHg`} />}
                                    {r.temperature && <VitalBadge label="Temp" value={`${r.temperature}°F`} />}
                                    {r.spo2 && <VitalBadge label="SpO₂" value={`${r.spo2}%`} />}
                                    {r.weight && <VitalBadge label="Wt" value={`${r.weight} kg`} />}
                                  </div>
                                )}
                                {examination && <p className="text-sm text-gray-700 whitespace-pre-line">{examination}</p>}
                              </div>
                            </div>
                          )}

                          {/* A */}
                          {r.diagnosis && (
                            <div className="flex gap-2">
                              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">A</span>
                              <div>
                                <span className="text-[10px] text-amber-600 font-semibold uppercase">Assessment</span>
                                <p className="text-sm text-gray-700 whitespace-pre-line">{r.diagnosis}</p>
                              </div>
                            </div>
                          )}

                          {/* P */}
                          {plan && (
                            <div className="flex gap-2">
                              <span className="w-5 h-5 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">P</span>
                              <div>
                                <span className="text-[10px] text-red-600 font-semibold uppercase">Plan</span>
                                <p className="text-sm text-gray-700 whitespace-pre-line">{plan}</p>
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex gap-2 pt-2 border-t border-gray-100">
                            <button onClick={() => editRound(r)}
                              className="text-xs text-gray-500 hover:text-indigo-600 flex items-center gap-1">
                              <Edit3 className="w-3 h-3" /> Edit
                            </button>
                            <button onClick={() => deleteRound(r.id)}
                              className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1">
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Helper component ────────────────────────────────────────────
function VitalBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded-full">
      <span className="font-medium">{label}:</span> {value}
    </span>
  )
}