'use client'
/**
 * src/components/ipd/SurgeryOTNotes.tsx
 *
 * Complete Surgery / Operation Theatre documentation for Indian Gynaecology.
 * Three collapsible sections: Pre-Op, Intra-Op, Post-Op.
 *
 * Covers: LSCS, Hysterectomy, D&C, Laparoscopy, Tubal Ligation, etc.
 * Stores in `surgery_records` table.
 * Auto-syncs findings to discharge summary.
 *
 * USAGE: <SurgeryOTNotes admissionId="..." patientId="..." currentUser="..." />
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getIndiaToday } from '@/lib/utils'
import {
  Scissors, Save, Loader2, CheckCircle, AlertCircle,
  ChevronDown, ChevronUp, ClipboardCheck, Activity,
  Stethoscope, Clock, Plus, Eye,
} from 'lucide-react'

// ── Common gynaecology surgeries ────────────────────────────────
const COMMON_SURGERIES = [
  'LSCS (Lower Segment Caesarean Section)',
  'Total Abdominal Hysterectomy (TAH)',
  'Vaginal Hysterectomy',
  'Laparoscopic Hysterectomy (TLH)',
  'Diagnostic Laparoscopy',
  'Operative Laparoscopy',
  'D&C (Dilatation and Curettage)',
  'Suction Evacuation',
  'Tubal Ligation',
  'Laparoscopic Tubal Ligation',
  'Cervical Cerclage',
  'Myomectomy',
  'Cystectomy (Ovarian)',
  'Bartholin Cyst Excision',
  'Colporrhaphy (Anterior/Posterior)',
  'Perineal Repair',
  'Hysteroscopy',
  'Polypectomy',
  'Ectopic Pregnancy (Salpingectomy)',
  'Other',
]

const PRE_OP_CHECKLIST_ITEMS = [
  { key: 'consent', label: 'Written Informed Consent' },
  { key: 'npo', label: 'NPO (Nil Per Oral) Status' },
  { key: 'iv_line', label: 'IV Line Secured' },
  { key: 'catheter', label: 'Foley Catheter Inserted' },
  { key: 'blood_group', label: 'Blood Group & Cross Match Done' },
  { key: 'blood_arranged', label: 'Blood Arranged' },
  { key: 'pre_op_labs', label: 'Pre-Op Labs Reviewed' },
  { key: 'ecg_clearance', label: 'ECG / Cardiac Clearance' },
  { key: 'anesthesia_fitness', label: 'Anesthesia Fitness Certified' },
  { key: 'site_marking', label: 'Surgical Site Marking' },
  { key: 'antibiotics', label: 'Prophylactic Antibiotics Given' },
  { key: 'jewelry_removed', label: 'Jewelry / Dentures Removed' },
  { key: 'patient_id_band', label: 'Patient ID Band Verified' },
]

interface SurgeryForm {
  id?: string
  surgery_date: string
  surgery_time: string
  surgery_name: string
  indication: string
  pre_op_diagnosis: string
  consent_taken: boolean
  consent_type: string
  asa_grade: string
  blood_arranged: string
  pre_op_checklist: Record<string, boolean>
  pre_op_investigations: string
  pre_op_notes: string
  surgery_type: string
  approach: string
  surgeon: string
  assistant: string
  anesthesiologist: string
  anesthesia_type: string
  scrub_nurse: string
  ot_number: string
  incision_type: string
  start_time: string
  end_time: string
  duration_minutes: string
  findings: string
  procedure_details: string
  blood_loss_ml: string
  blood_transfusion: string
  specimen_sent: string
  complications_intraop: string
  post_op_diagnosis: string
  implants_used: string
  post_op_instructions: string
  post_op_medications: string
  diet_post_op: string
  drain_details: string
  catheter_removal: string
  ambulation: string
  post_op_vitals_stable: boolean
  post_op_notes: string
  discharge_plan: string
}

const EMPTY_FORM: SurgeryForm = {
  surgery_date: getIndiaToday(),
  surgery_time: '',
  surgery_name: '',
  indication: '',
  pre_op_diagnosis: '',
  consent_taken: false,
  consent_type: 'Written',
  asa_grade: 'ASA I',
  blood_arranged: '',
  pre_op_checklist: {},
  pre_op_investigations: '',
  pre_op_notes: '',
  surgery_type: 'Elective',
  approach: 'Open',
  surgeon: '',
  assistant: '',
  anesthesiologist: '',
  anesthesia_type: '',
  scrub_nurse: '',
  ot_number: '',
  incision_type: '',
  start_time: '',
  end_time: '',
  duration_minutes: '',
  findings: '',
  procedure_details: '',
  blood_loss_ml: '',
  blood_transfusion: '',
  specimen_sent: '',
  complications_intraop: '',
  post_op_diagnosis: '',
  implants_used: '',
  post_op_instructions: '',
  post_op_medications: '',
  diet_post_op: 'NPO for 6 hours, then sips of water',
  drain_details: '',
  catheter_removal: 'After 24 hours',
  ambulation: 'Next day morning',
  post_op_vitals_stable: true,
  post_op_notes: '',
  discharge_plan: '',
}

interface Props {
  admissionId: string
  patientId: string
  currentUser?: string
}

function Section({ title, icon: Icon, color, children, defaultOpen = true }: {
  title: string; icon: any; color: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 ${color} text-left`}>
        <span className="flex items-center gap-2 font-medium text-sm">
          <Icon className="w-4 h-4" /> {title}
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  )
}

export default function SurgeryOTNotes({ admissionId, patientId, currentUser }: Props) {
  const [form, setForm] = useState<SurgeryForm>({ ...EMPTY_FORM })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [tableExists, setTableExists] = useState(true)
  const [records, setRecords] = useState<any[]>([])
  const [editingIdx, setEditingIdx] = useState(-1)
  const [showForm, setShowForm] = useState(false)

  const loadRecords = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from('surgery_records')
        .select('*')
        .eq('ipd_admission_id', admissionId)
        .order('surgery_date', { ascending: false })

      if (err) {
        if (err.message?.includes('does not exist')) {
          setTableExists(false)
          setError('The surgery_records table does not exist. Please run the SQL migration.')
        } else throw err
        setLoading(false)
        return
      }
      setRecords(data || [])
      if (data && data.length > 0 && !showForm) {
        loadFormFromRecord(data[0])
        setEditingIdx(0)
        setShowForm(true)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [admissionId])

  useEffect(() => { loadRecords() }, [loadRecords])

  function loadFormFromRecord(r: any) {
    setForm({
      id: r.id,
      surgery_date: r.surgery_date || '',
      surgery_time: r.surgery_time || '',
      surgery_name: r.surgery_name || '',
      indication: r.indication || '',
      pre_op_diagnosis: r.pre_op_diagnosis || '',
      consent_taken: r.consent_taken || false,
      consent_type: r.consent_type || 'Written',
      asa_grade: r.asa_grade || 'ASA I',
      blood_arranged: r.blood_arranged || '',
      pre_op_checklist: r.pre_op_checklist || {},
      pre_op_investigations: r.pre_op_investigations || '',
      pre_op_notes: r.pre_op_notes || '',
      surgery_type: r.surgery_type || 'Elective',
      approach: r.approach || 'Open',
      surgeon: r.surgeon || '',
      assistant: r.assistant || '',
      anesthesiologist: r.anesthesiologist || '',
      anesthesia_type: r.anesthesia_type || '',
      scrub_nurse: r.scrub_nurse || '',
      ot_number: r.ot_number || '',
      incision_type: r.incision_type || '',
      start_time: r.start_time || '',
      end_time: r.end_time || '',
      duration_minutes: r.duration_minutes?.toString() || '',
      findings: r.findings || '',
      procedure_details: r.procedure_details || '',
      blood_loss_ml: r.blood_loss_ml?.toString() || '',
      blood_transfusion: r.blood_transfusion || '',
      specimen_sent: r.specimen_sent || '',
      complications_intraop: r.complications_intraop || '',
      post_op_diagnosis: r.post_op_diagnosis || '',
      implants_used: r.implants_used || '',
      post_op_instructions: r.post_op_instructions || '',
      post_op_medications: r.post_op_medications || '',
      diet_post_op: r.diet_post_op || '',
      drain_details: r.drain_details || '',
      catheter_removal: r.catheter_removal || '',
      ambulation: r.ambulation || '',
      post_op_vitals_stable: r.post_op_vitals_stable ?? true,
      post_op_notes: r.post_op_notes || '',
      discharge_plan: r.discharge_plan || '',
    })
  }

  function setField(field: keyof SurgeryForm, value: any) {
    setForm(prev => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  function setChecklist(key: string, val: boolean) {
    setForm(prev => ({
      ...prev,
      pre_op_checklist: { ...prev.pre_op_checklist, [key]: val }
    }))
    setSaved(false)
  }

  async function saveRecord() {
    if (!form.surgery_name) {
      setError('Please select a surgery/procedure name.')
      return
    }
    setSaving(true)
    setError('')

    const payload: any = {
      ipd_admission_id: admissionId,
      patient_id: patientId,
      surgery_date: form.surgery_date || null,
      surgery_time: form.surgery_time || null,
      surgery_name: form.surgery_name,
      indication: form.indication || null,
      pre_op_diagnosis: form.pre_op_diagnosis || null,
      consent_taken: form.consent_taken,
      consent_type: form.consent_type || null,
      asa_grade: form.asa_grade || null,
      blood_arranged: form.blood_arranged || null,
      pre_op_checklist: form.pre_op_checklist,
      pre_op_investigations: form.pre_op_investigations || null,
      pre_op_notes: form.pre_op_notes || null,
      surgery_type: form.surgery_type || null,
      approach: form.approach || null,
      surgeon: form.surgeon || null,
      assistant: form.assistant || null,
      anesthesiologist: form.anesthesiologist || null,
      anesthesia_type: form.anesthesia_type || null,
      scrub_nurse: form.scrub_nurse || null,
      ot_number: form.ot_number || null,
      incision_type: form.incision_type || null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
      findings: form.findings || null,
      procedure_details: form.procedure_details || null,
      blood_loss_ml: form.blood_loss_ml ? Number(form.blood_loss_ml) : null,
      blood_transfusion: form.blood_transfusion || null,
      specimen_sent: form.specimen_sent || null,
      complications_intraop: form.complications_intraop || null,
      post_op_diagnosis: form.post_op_diagnosis || null,
      implants_used: form.implants_used || null,
      post_op_instructions: form.post_op_instructions || null,
      post_op_medications: form.post_op_medications || null,
      diet_post_op: form.diet_post_op || null,
      drain_details: form.drain_details || null,
      catheter_removal: form.catheter_removal || null,
      ambulation: form.ambulation || null,
      post_op_vitals_stable: form.post_op_vitals_stable,
      post_op_notes: form.post_op_notes || null,
      discharge_plan: form.discharge_plan || null,
      updated_by: currentUser || null,
      updated_at: new Date().toISOString(),
    }

    try {
      if (form.id) {
        const { error: e } = await supabase.from('surgery_records').update(payload).eq('id', form.id)
        if (e) throw e
      } else {
        payload.created_by = currentUser || null
        const { data: newRec, error: e } = await supabase.from('surgery_records').insert(payload).select().single()
        if (e) throw e
        if (newRec) setForm(prev => ({ ...prev, id: newRec.id }))
      }

      // Sync to discharge summary
      try {
        const { data: ds } = await supabase.from('discharge_summaries')
          .select('id, treatment_given').eq('patient_id', patientId)
          .order('created_at', { ascending: false }).limit(1).single()
        if (ds?.id) {
          const treatmentLine = `Surgery: ${form.surgery_name}${form.approach ? ` (${form.approach})` : ''} on ${form.surgery_date || ''}`
          const existing = ds.treatment_given || ''
          if (!existing.includes(form.surgery_name)) {
            await supabase.from('discharge_summaries').update({
              treatment_given: existing ? `${existing}\n${treatmentLine}` : treatmentLine,
              updated_at: new Date().toISOString(),
            }).eq('id', ds.id)
          }
        }
      } catch { /* non-critical */ }

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      loadRecords()
    } catch (err: any) {
      setError(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
        <span className="ml-2 text-sm text-gray-500">Loading surgery records...</span>
      </div>
    )
  }

  if (!tableExists) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
        <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto mb-3" />
        <h3 className="font-semibold text-gray-800 mb-2">Database Setup Required</h3>
        <p className="text-sm text-gray-600">
          Run <code className="bg-gray-100 px-1 rounded">surgery_and_packages_migration.sql</code> in Supabase SQL Editor.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <Scissors className="w-5 h-5 text-orange-500" /> Surgery / OT Notes
          {records.length > 0 && <span className="text-xs text-gray-400 font-normal">({records.length} record{records.length > 1 ? 's' : ''})</span>}
        </h3>
        <div className="flex gap-2">
          {saved && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Saved</span>}
          {!showForm && (
            <button onClick={() => { setForm({ ...EMPTY_FORM }); setShowForm(true); setEditingIdx(-1) }}
              className="bg-orange-600 hover:bg-orange-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1">
              <Plus className="w-4 h-4" /> New Surgery Record
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {!showForm && records.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <Scissors className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No surgery/OT notes recorded.</p>
          <p className="text-xs mt-1">Click "New Surgery Record" to document a procedure.</p>
        </div>
      )}

      {showForm && (
        <>
          {/* ═══ PRE-OP ═══ */}
          <Section title="Pre-Operative Assessment" icon={ClipboardCheck} color="bg-blue-50 text-blue-800">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-gray-500 block mb-1">Surgery / Procedure *</label>
                <select value={form.surgery_name} onChange={e => setField('surgery_name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                  <option value="">— Select —</option>
                  {COMMON_SURGERIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <Fld label="Surgery Date" value={form.surgery_date} onChange={v => setField('surgery_date', v)} type="date" />
              <Fld label="Indication" value={form.indication} onChange={v => setField('indication', v)} placeholder="e.g., Fetal distress, Fibroid uterus" full />
              <Fld label="Pre-Op Diagnosis" value={form.pre_op_diagnosis} onChange={v => setField('pre_op_diagnosis', v)} full />
              <Sel label="Surgery Type" value={form.surgery_type} onChange={v => setField('surgery_type', v)} options={['Elective', 'Emergency']} />
              <Sel label="ASA Grade" value={form.asa_grade} onChange={v => setField('asa_grade', v)} options={['ASA I', 'ASA II', 'ASA III', 'ASA IV', 'ASA V']} />
              <Fld label="Blood Arranged" value={form.blood_arranged} onChange={v => setField('blood_arranged', v)} placeholder="e.g., 2 units PRBC" />
            </div>

            <div className="border-t pt-3 mt-2">
              <p className="text-xs text-gray-500 font-medium mb-2">Pre-Op Checklist</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {PRE_OP_CHECKLIST_ITEMS.map(item => (
                  <label key={item.key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={!!form.pre_op_checklist[item.key]}
                      onChange={e => setChecklist(item.key, e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600" />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>

            <Fld label="Pre-Op Investigations Summary" value={form.pre_op_investigations} onChange={v => setField('pre_op_investigations', v)} full rows={2} placeholder="Hb: 11, TLC: 8000, Platelets: 2.5L, Blood Group: B+ve, HIV/HBsAg: Negative..." />
            <Fld label="Pre-Op Notes" value={form.pre_op_notes} onChange={v => setField('pre_op_notes', v)} full rows={2} />
          </Section>

          {/* ═══ INTRA-OP ═══ */}
          <Section title="Intra-Operative Details" icon={Scissors} color="bg-orange-50 text-orange-800">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Sel label="Approach" value={form.approach} onChange={v => setField('approach', v)} options={['Open', 'Laparoscopic', 'Vaginal', 'Hysteroscopic', 'Combined']} />
              <Sel label="Anesthesia Type" value={form.anesthesia_type} onChange={v => setField('anesthesia_type', v)} options={['', 'Spinal', 'Epidural', 'General (GA)', 'Local', 'Combined Spinal-Epidural', 'Sedation']} />
              <Sel label="Incision" value={form.incision_type} onChange={v => setField('incision_type', v)} options={['', 'Pfannenstiel', 'Midline (Infraumbilical)', 'Joel-Cohen', 'Laparoscopic Ports', 'None (Vaginal)']} />
              <Fld label="Surgeon" value={form.surgeon} onChange={v => setField('surgeon', v)} placeholder="Dr." />
              <Fld label="Assistant" value={form.assistant} onChange={v => setField('assistant', v)} placeholder="Dr." />
              <Fld label="Anesthesiologist" value={form.anesthesiologist} onChange={v => setField('anesthesiologist', v)} placeholder="Dr." />
              <Fld label="Scrub Nurse" value={form.scrub_nurse} onChange={v => setField('scrub_nurse', v)} />
              <Fld label="OT Number" value={form.ot_number} onChange={v => setField('ot_number', v)} placeholder="e.g., OT-1" />
              <Fld label="Start Time" value={form.start_time} onChange={v => setField('start_time', v)} placeholder="HH:MM" />
              <Fld label="End Time" value={form.end_time} onChange={v => setField('end_time', v)} placeholder="HH:MM" />
              <Fld label="Duration (min)" value={form.duration_minutes} onChange={v => setField('duration_minutes', v)} />
              <Fld label="Blood Loss (ml)" value={form.blood_loss_ml} onChange={v => setField('blood_loss_ml', v)} />
            </div>
            <Fld label="Findings" value={form.findings} onChange={v => setField('findings', v)} full rows={3} placeholder="Uterus: bulky / normal, Adnexa, Adhesions, Fluid, etc..." />
            <Fld label="Procedure Details" value={form.procedure_details} onChange={v => setField('procedure_details', v)} full rows={4} placeholder="Step-by-step operative procedure..." />
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Blood Transfusion" value={form.blood_transfusion} onChange={v => setField('blood_transfusion', v)} placeholder="None / 1 unit PRBC" />
              <Fld label="Specimen Sent" value={form.specimen_sent} onChange={v => setField('specimen_sent', v)} placeholder="e.g., Uterus + cervix for HPE" />
              <Fld label="Complications (Intra-Op)" value={form.complications_intraop} onChange={v => setField('complications_intraop', v)} placeholder="None / Describe" />
              <Fld label="Post-Op Diagnosis" value={form.post_op_diagnosis} onChange={v => setField('post_op_diagnosis', v)} />
            </div>
          </Section>

          {/* ═══ POST-OP ═══ */}
          <Section title="Post-Operative Care" icon={Activity} color="bg-green-50 text-green-800" defaultOpen={false}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Sel label="Diet" value={form.diet_post_op} onChange={v => setField('diet_post_op', v)}
                options={['NPO for 6 hours, then sips of water', 'Sips of water after 4 hours', 'Liquid diet after 6 hours', 'Soft diet', 'Normal diet next day']} />
              <Fld label="Catheter Removal" value={form.catheter_removal} onChange={v => setField('catheter_removal', v)} placeholder="After 24 hours" />
              <Fld label="Ambulation" value={form.ambulation} onChange={v => setField('ambulation', v)} placeholder="Next day morning" />
              <Fld label="Drain Details" value={form.drain_details} onChange={v => setField('drain_details', v)} placeholder="None / Abdominal drain" />
              <label className="flex items-center gap-2 text-sm text-gray-700 py-2">
                <input type="checkbox" checked={form.post_op_vitals_stable}
                  onChange={e => setField('post_op_vitals_stable', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-green-600" />
                Post-Op Vitals Stable
              </label>
            </div>
            <Fld label="Post-Op Instructions" value={form.post_op_instructions} onChange={v => setField('post_op_instructions', v)} full rows={3} placeholder="Monitor vitals q4h, strict I/O, watch for bleeding..." />
            <Fld label="Post-Op Medications" value={form.post_op_medications} onChange={v => setField('post_op_medications', v)} full rows={3} placeholder="Inj. Ceftriaxone 1g IV BD, Inj. Metronidazole 500mg IV TDS..." />
            <Fld label="Post-Op Notes" value={form.post_op_notes} onChange={v => setField('post_op_notes', v)} full rows={2} />
            <Fld label="Discharge Plan" value={form.discharge_plan} onChange={v => setField('discharge_plan', v)} full rows={2} placeholder="Stitch removal on Day 7, follow-up after 2 weeks..." />
          </Section>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { setShowForm(false); setForm({ ...EMPTY_FORM }) }}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm">Cancel</button>
            <button onClick={saveRecord} disabled={saving}
              className="bg-orange-600 hover:bg-orange-700 text-white px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Surgery Record
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────
function Fld({ label, value, onChange, type = 'text', placeholder, full, rows }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; full?: boolean; rows?: number
}) {
  const cls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500'
  return (
    <div className={full ? 'md:col-span-3' : ''}>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {rows ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder} className={cls} />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      )}
    </div>
  )
}

function Sel({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
        {options.map(o => <option key={o} value={o}>{o || '— Select —'}</option>)}
      </select>
    </div>
  )
}