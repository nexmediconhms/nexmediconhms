'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
// Hospital print settings loaded dynamically from localStorage via getHospitalSettings()
import SmartMic from '@/components/shared/SmartMic'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings } from '@/lib/utils'
import type { Patient, Encounter, Prescription, DischargeSummary } from '@/types'
import {
  ArrowLeft, Sparkles, Save, Printer, CheckCircle,
  AlertCircle, Loader2, FileText, Baby, Stethoscope, Edit3
} from 'lucide-react'

interface DSForm {
  admission_date: string; discharge_date: string
  final_diagnosis: string; secondary_diagnosis: string
  clinical_summary: string; investigations: string; treatment_given: string
  condition_at_discharge: string; discharge_advice: string; diet_advice: string
  medications_at_discharge: string; follow_up_date: string; follow_up_note: string
  delivery_type: string; baby_sex: string; baby_weight: string
  apgar_score: string; baby_birth_time: string; delivery_date: string; complications: string
  lactation_advice: string; signed_by: string
}

const EMPTY: DSForm = {
  admission_date: '', discharge_date: new Date().toISOString().split('T')[0],
  final_diagnosis: '', secondary_diagnosis: '',
  clinical_summary: '', investigations: '', treatment_given: '',
  condition_at_discharge: 'Stable, afebrile, ambulant',
  discharge_advice: '', diet_advice: '', medications_at_discharge: '',
  follow_up_date: '', follow_up_note: '',
  delivery_type: '', baby_sex: '', baby_weight: '', apgar_score: '',
  baby_birth_time: '', delivery_date: '', complications: '', lactation_advice: '',
  signed_by: '',  // filled from getHospitalSettings().doctorName when form loads
}

type AIState   = 'idle' | 'generating' | 'done' | 'error'
type SaveState = 'idle' | 'saving'     | 'saved' | 'error'

// ─────────────────────────────────────────────────────────────
// CRITICAL: DSTextArea and DSTextInput are defined OUTSIDE the
// page component. This gives them stable identity across renders
// so React does NOT unmount/remount them on each keystroke.
// Defining them inside the page component caused inputs to lose
// focus after every character typed.
// ─────────────────────────────────────────────────────────────

interface FieldProps {
  field: keyof DSForm; form: DSForm; isFinal: boolean
  set: (f: keyof DSForm, v: string) => void
}

function DSTextArea({ field, form, isFinal, set, label, rows = 3, placeholder, withMic = false }:
  FieldProps & { label: string; rows?: number; placeholder?: string; withMic?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="label">{label}</label>
        {withMic && (
          <SmartMic field={field} value={form[field] as string}
            onChange={v => set(field, v)} context={label} disabled={isFinal} />
        )}
      </div>
      <textarea
        className={`input resize-none ${isFinal ? 'bg-gray-50 text-gray-500' : ''}`}
        rows={rows} disabled={isFinal}
        placeholder={isFinal ? '' : placeholder}
        value={form[field] as string}
        onChange={e => set(field, e.target.value)}
      />
    </div>
  )
}

function DSTextInput({ field, form, isFinal, set, label, placeholder, type = 'text', withMic = false }:
  FieldProps & { label: string; placeholder?: string; type?: string; withMic?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="label">{label}</label>
        {withMic && type === 'text' && (
          <SmartMic field={field} value={form[field] as string}
            onChange={v => set(field, v)} context={label} disabled={isFinal} />
        )}
      </div>
      <input
        className={`input ${isFinal ? 'bg-gray-50 text-gray-500' : ''}`}
        type={type} disabled={isFinal}
        placeholder={isFinal ? '' : placeholder}
        value={form[field] as string}
        onChange={e => set(field, e.target.value)}
      />
    </div>
  )
}

function PrintSection({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3 border border-gray-200 rounded p-3">
      <div className="font-bold mb-1">{label}:</div>
      <div className="text-gray-700 whitespace-pre-wrap">{value}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function DischargeSummaryPage() {
  const { id: patientId } = useParams<{ id: string }>()
  const router = useRouter()

  const [patient,       setPatient]       = useState<Patient | null>(null)
  const [encounters,    setEncounters]    = useState<Encounter[]>([])
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [existing,      setExisting]      = useState<DischargeSummary | null>(null)
  const [form,          setForm]          = useState<DSForm>(EMPTY)
  const [showOB,        setShowOB]        = useState(false)
  const [aiState,       setAiState]       = useState<AIState>('idle')
  const [saveState,     setSaveState]     = useState<SaveState>('idle')
  const [isFinal,       setIsFinal]       = useState(false)
  const [aiError,       setAiError]       = useState('')
  const [loading,       setLoading]       = useState(true)
  // Live hospital settings for print view — reads from localStorage
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : { hospitalName:'NexMedicon Demo Hospital', address:'123 Hospital Road, City', phone:'+91 98765 43210', regNo:'MH/12345', gstin:'27ABCDE1234F1Z5', doctorName:'Dr. Demo', doctorQual:'MBBS, MD (OBG)', doctorReg:'MH/12345' }

  useEffect(() => { if (patientId) loadAll() }, [patientId])

  async function loadAll() {
    setLoading(true)
    const [{ data: p }, { data: enc }, { data: rx }, { data: ds }] = await Promise.all([
      supabase.from('patients').select('*').eq('id', patientId).single(),
      supabase.from('encounters').select('*').eq('patient_id', patientId).order('encounter_date', { ascending: true }),
      supabase.from('prescriptions').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('discharge_summaries').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(1).single(),
    ])
    setPatient(p); setEncounters(enc || []); setPrescriptions(rx || [])

    if (ds) {
      setExisting(ds); setIsFinal(ds.is_final || false)
      setForm({
        admission_date: ds.admission_date || enc?.[0]?.encounter_date || '',
        discharge_date: ds.discharge_date || new Date().toISOString().split('T')[0],
        final_diagnosis: ds.final_diagnosis || '', secondary_diagnosis: ds.secondary_diagnosis || '',
        clinical_summary: ds.clinical_summary || '', investigations: ds.investigations || '',
        treatment_given: ds.treatment_given || '',
        condition_at_discharge: ds.condition_at_discharge || 'Stable, afebrile, ambulant',
        discharge_advice: ds.discharge_advice || '', diet_advice: ds.diet_advice || '',
        medications_at_discharge: ds.medications_at_discharge || '',
        follow_up_date: ds.follow_up_date || '', follow_up_note: ds.follow_up_note || '',
        delivery_type: ds.delivery_type || '', baby_sex: ds.baby_sex || '',
        baby_weight: ds.baby_weight || '', apgar_score: ds.apgar_score || '',
        baby_birth_time: (ds as any).baby_birth_time || '',
        delivery_date: ds.delivery_date || '', complications: ds.complications || '',
        lactation_advice: ds.lactation_advice || '', signed_by: ds.signed_by || getHospitalSettings().doctorName,
      })
      if (ds.delivery_type || ds.baby_weight) setShowOB(true)
    } else if (enc && enc.length > 0) {
      setForm(prev => ({ ...prev, admission_date: enc[0].encounter_date || '' }))
      if (enc.some(e => e.ob_data && Object.keys(e.ob_data as object).length > 0)) setShowOB(true)
    }
    setLoading(false)
  }

  function set(field: keyof DSForm, value: string) {
    if (isFinal) return
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function generateWithAI() {
    if (!patient || encounters.length === 0) {
      setAiError('No consultation data found. Create at least one OPD consultation first.')
      setAiState('error'); return
    }
    setAiState('generating'); setAiError('')
    const encCtx = encounters.map((e, i) => {
      const ob = e.ob_data as any
      const obTxt = ob && Object.keys(ob).length > 0
        ? ` | OB: LMP=${ob.lmp||'—'}, FHS=${ob.fhs||'—'}bpm, Liquor=${ob.liquor||'—'}, Presentation=${ob.presentation||'—'}`
        : ''
      return `Visit ${i+1} (${e.encounter_date}): CC=${e.chief_complaint||'—'} | BP=${e.bp_systolic||'—'}/${e.bp_diastolic||'—'}, Pulse=${e.pulse||'—'}, Wt=${e.weight||'—'}kg | Dx=${e.diagnosis||'—'} | Notes=${e.notes||'—'}${obTxt}`
    }).join('\n')
    const rxCtx = prescriptions.slice(0,2).map(rx => {
      const meds = Array.isArray(rx.medications) ? rx.medications.map((m:any)=>`${m.drug} ${m.dose} ${m.frequency}`).join(', ') : '—'
      return `Rx (${rx.created_at?.split('T')[0]}): ${meds} | FU=${rx.follow_up_date||'—'}`
    }).join('\n')

    const prompt = `Generate a discharge summary for: ${patient.full_name}, Age ${patient.age}y, ${patient.gender}, MRN ${patient.mrn}.
Admission: ${form.admission_date||'—'}, Discharge: ${form.discharge_date}.
ENCOUNTERS:\n${encCtx}\nPRESCRIPTIONS:\n${rxCtx||'—'}
Return ONLY valid JSON with keys: final_diagnosis, secondary_diagnosis, clinical_summary, investigations, treatment_given, condition_at_discharge, discharge_advice, diet_advice, medications_at_discharge, follow_up_note, lactation_advice, complications`

    try {
      const res = await fetch('/api/discharge-ai', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({prompt}) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'AI generation failed')
      setForm(prev => ({
        ...prev,
        ...(data.final_diagnosis          && { final_diagnosis:          data.final_diagnosis }),
        ...(data.secondary_diagnosis      && { secondary_diagnosis:      data.secondary_diagnosis }),
        ...(data.clinical_summary         && { clinical_summary:         data.clinical_summary }),
        ...(data.investigations           && { investigations:           data.investigations }),
        ...(data.treatment_given          && { treatment_given:          data.treatment_given }),
        ...(data.condition_at_discharge   && { condition_at_discharge:   data.condition_at_discharge }),
        ...(data.discharge_advice         && { discharge_advice:         data.discharge_advice }),
        ...(data.diet_advice              && { diet_advice:              data.diet_advice }),
        ...(data.medications_at_discharge && { medications_at_discharge: data.medications_at_discharge }),
        ...(data.follow_up_note           && { follow_up_note:           data.follow_up_note }),
        ...(data.lactation_advice         && { lactation_advice:         data.lactation_advice }),
        ...(data.complications            && { complications:            data.complications }),
      }))
      setAiState('done')
    } catch (err: any) { setAiError(err.message || 'AI failed. Fill manually.'); setAiState('error') }
  }

  async function handleSave(finalise = false) {
    if (!patientId) return
    setSaveState('saving')
    const payload = {
      patient_id: patientId, ...Object.fromEntries(
        Object.entries(form).map(([k,v]) => [k, v || null])
      ),
      is_final: finalise, signed_at: finalise ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    let err
    if (existing) {
      const r = await supabase.from('discharge_summaries').update({ ...payload, version:(existing.version||1)+(finalise?1:0) }).eq('id',existing.id)
      err = r.error
    } else {
      const r = await supabase.from('discharge_summaries').insert({...payload,version:1}).select().single()
      if (r.data) setExisting(r.data as DischargeSummary)
      err = r.error
    }
    if (err) { setSaveState('error'); return }
    if (finalise) setIsFinal(true)
    setSaveState('saved'); setTimeout(()=>setSaveState('idle'), 3000)
  }

  if (loading) return <AppShell><div className="p-6 flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div></AppShell>
  if (!patient) return <AppShell><div className="p-6 text-center py-20 text-gray-500">Patient not found.<Link href="/patients" className="text-blue-600 text-sm block mt-2">← Back</Link></div></AppShell>

  const fp = { form, isFinal, set }
  function addDays(n:number){ if(isFinal)return; const d=new Date(); d.setDate(d.getDate()+n); set('follow_up_date',d.toISOString().split('T')[0]) }

  return (
    <AppShell>
      <div className="no-print p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <button onClick={()=>router.back()} className="text-gray-400 hover:text-gray-700"><ArrowLeft className="w-5 h-5"/></button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><FileText className="w-5 h-5 text-blue-600"/> Discharge Summary</h1>
            <p className="text-sm text-gray-500">{patient.full_name} · {patient.mrn} · {patient.age}y · {patient.gender}
              {isFinal && <span className="ml-2 badge-green text-xs">✓ Finalised</span>}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={()=>window.print()} className="btn-secondary flex items-center gap-2 text-xs"><Printer className="w-3.5 h-3.5"/>Print</button>
            {!isFinal && <>
              <button onClick={()=>handleSave(false)} disabled={saveState==='saving'} className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-60">
                {saveState==='saving'?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<Save className="w-3.5 h-3.5"/>}
                {saveState==='saved'?'Saved!':'Save Draft'}
              </button>
              <button onClick={()=>handleSave(true)} disabled={saveState==='saving'||!form.final_diagnosis}
                title={!form.final_diagnosis?'Enter final diagnosis first':''} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-60">
                <CheckCircle className="w-3.5 h-3.5"/> Sign Off & Finalise
              </button>
            </>}
          </div>
        </div>

        {saveState==='error' && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4"/>Save failed. Please try again.</div>}
        {saveState==='saved' && <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4"/>Discharge summary saved.</div>}
        {isFinal && <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4"/>Signed off by <strong className="mx-1">{form.signed_by}</strong> and locked.
          <button onClick={()=>setIsFinal(false)} className="ml-auto text-xs underline">Unlock for editing</button>
        </div>}

        {/* AI Generate */}
        {!isFinal && (
          <div className="card p-5 mb-5 bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center flex-shrink-0"><Sparkles className="w-6 h-6 text-purple-600"/></div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">AI Auto-Generate</h3>
                <p className="text-xs text-gray-500 mt-0.5">{encounters.length>0?`Reads all ${encounters.length} consultation(s) and auto-drafts the summary. Every field is editable after.`:'No consultations found. Create at least one OPD consultation first.'}</p>
                {aiError && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3"/>{aiError}</p>}
              </div>
              <button onClick={generateWithAI} disabled={aiState==='generating'||encounters.length===0}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors disabled:opacity-60 flex-shrink-0">
                {aiState==='generating'?<><Loader2 className="w-4 h-4 animate-spin"/>Generating...</>
                  :aiState==='done'?<><CheckCircle className="w-4 h-4"/>Regenerate</>
                  :<><Sparkles className="w-4 h-4"/>Generate with AI</>}
              </button>
            </div>
          </div>
        )}

        {/* Section 1 — Admission Details */}
        <div className="card p-5 mb-4">
          <h2 className="section-title flex items-center gap-2"><Stethoscope className="w-4 h-4 text-blue-600"/>Admission Details</h2>
          <div className="grid grid-cols-3 gap-4">
            <DSTextInput {...fp} label="Admission Date"     field="admission_date"  type="date"/>
            <DSTextInput {...fp} label="Discharge Date"     field="discharge_date"  type="date"/>
            <DSTextInput {...fp} label="Signed By (Doctor)" field="signed_by"       placeholder="Dr. Name, Qualification" withMic/>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <DSTextInput {...fp} label="Final Diagnosis *"   field="final_diagnosis"     placeholder="e.g. PCOS — ICD: E28.2" withMic/>
            <DSTextInput {...fp} label="Secondary Diagnosis" field="secondary_diagnosis" placeholder="e.g. Hypothyroidism, Anaemia" withMic/>
          </div>
        </div>

        {/* Section 2 — Clinical Summary */}
        <div className="card p-5 mb-4">
          <h2 className="section-title flex items-center gap-2"><Edit3 className="w-4 h-4 text-blue-600"/>Clinical Summary</h2>
          <div className="space-y-4">
            <DSTextArea {...fp} label="Clinical Summary"      field="clinical_summary"      rows={4} withMic placeholder="Presenting complaints, key findings, procedures..."/>
            <DSTextArea {...fp} label="Investigations Done"   field="investigations"         rows={3} withMic placeholder="CBC, TSH, USG findings, lab values..."/>
            <DSTextArea {...fp} label="Treatment Given"       field="treatment_given"        rows={3} withMic placeholder="Medications given, procedures, surgeries..."/>
            <div className="grid grid-cols-2 gap-4">
              <DSTextArea {...fp} label="Condition at Discharge" field="condition_at_discharge" rows={2} withMic placeholder="Stable, afebrile, ambulant"/>
              <DSTextArea {...fp} label="Complications (if any)" field="complications"           rows={2} withMic placeholder="None / PPH managed / Wound infection treated"/>
            </div>
          </div>
        </div>

        {/* Section 3 — Discharge Instructions */}
        <div className="card p-5 mb-4">
          <h2 className="section-title">Discharge Instructions</h2>
          <div className="grid grid-cols-2 gap-4">
            <DSTextArea {...fp} label="Discharge Advice"           field="discharge_advice"         rows={3} withMic placeholder="Rest, activity restrictions, wound care..."/>
            <DSTextArea {...fp} label="Dietary Advice"             field="diet_advice"              rows={3} withMic placeholder="High protein diet, iron-rich foods..."/>
            <DSTextArea {...fp} label="Medications at Discharge"   field="medications_at_discharge" rows={3} withMic placeholder="Tab Iron + Folic Acid OD × 3 months..."/>
            <div>
              <DSTextInput {...fp} label="Follow-up Date" field="follow_up_date" type="date"/>
              <div className="flex gap-2 mt-2 mb-3">
                {[{l:'+2 weeks',d:14},{l:'+1 month',d:30},{l:'+3 months',d:90}].map(({l,d})=>(
                  <button key={l} type="button" onClick={()=>addDays(d)} disabled={isFinal}
                    className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded border border-blue-100 disabled:opacity-40">{l}</button>
                ))}
              </div>
              <DSTextArea {...fp} label="Follow-up Note" field="follow_up_note" rows={2} withMic placeholder="Review with USG and CBC..."/>
            </div>
          </div>
        </div>

        {/* Section 4 — OB/Delivery */}
        <div className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="section-title mb-0 flex items-center gap-2"><Baby className="w-4 h-4 text-pink-500"/>Obstetric / Delivery Details</h2>
            <button type="button" onClick={()=>setShowOB(!showOB)} className="text-xs text-blue-600 hover:underline">
              {showOB?'▲ Hide (non-obstetric)':'▼ Show (maternity / delivery case)'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-3">Enable for maternity or delivery discharge cases.</p>
          {showOB && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Delivery Type</label>
                <select className={`input ${isFinal?'bg-gray-50 text-gray-500':''}`} disabled={isFinal} value={form.delivery_type} onChange={e=>set('delivery_type',e.target.value)}>
                  <option value="">Select</option>
                  {['NVD (Normal Vaginal Delivery)','LSCS (Caesarean Section)','Forceps Delivery','Vacuum Delivery','Instrumental Delivery'].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              <DSTextInput {...fp} label="Delivery Date" field="delivery_date" type="date"/>
              <div>
                <label className="label">Baby Sex</label>
                <select className={`input ${isFinal?'bg-gray-50 text-gray-500':''}`} disabled={isFinal} value={form.baby_sex} onChange={e=>set('baby_sex',e.target.value)}>
                  <option value="">Select</option><option>Male</option><option>Female</option>
                </select>
              </div>
              <DSTextInput {...fp} label="Baby Birth Weight" field="baby_weight" placeholder="e.g. 3.1 kg"/>
              <DSTextInput {...fp} label="APGAR Score"       field="apgar_score" placeholder="e.g. 8/9 at 1/5 min"/>
              <DSTextInput {...fp} label="Birth Time"        field="baby_birth_time" type="time" placeholder="HH:MM"/>
              <DSTextArea  {...fp} label="Lactation Advice"  field="lactation_advice" rows={2} withMic placeholder="Exclusive breastfeeding..."/>
            </div>
          )}
        </div>

        {/* Reference encounters */}
        {encounters.length > 0 && (
          <div className="card p-4 bg-gray-50 border-gray-100 mb-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Encounter History (reference)</p>
            <div className="space-y-1">
              {encounters.slice(0,6).map((e,i)=>(
                <div key={e.id} className="text-xs text-gray-600 flex gap-3">
                  <span className="text-gray-400 w-20 flex-shrink-0">{formatDate(e.encounter_date)}</span>
                  <span className="font-medium">{e.diagnosis||e.chief_complaint||`Visit ${i+1}`}</span>
                </div>
              ))}
              {encounters.length>6&&<p className="text-xs text-gray-400">+{encounters.length-6} more visits</p>}
            </div>
          </div>
        )}
      </div>

      {/* PRINT VIEW */}
      <div className="print-only print-container p-10 max-w-[750px] mx-auto text-[12px]">
        <div className="text-center pb-4 mb-4 border-b-2 border-gray-900">
          {/* hospital header via constants */}
          <div className="text-2xl font-bold tracking-widest uppercase">{hs.hospitalName}</div>
          <div className="text-sm text-gray-600">{hs.address} — Tel: {hs.phone}</div>
          <div className="text-xs text-gray-500">Reg. No: {hs.regNo} · GSTIN: {hs.gstin}</div>
          <div className="text-lg font-bold mt-2 tracking-wide uppercase">Discharge Summary</div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-4 border border-gray-300 rounded p-3 bg-gray-50 text-[11px]">
          <div><span className="font-bold">Patient Name: </span>{patient.full_name}</div>
          <div><span className="font-bold">MRN: </span>{patient.mrn}</div>
          <div><span className="font-bold">Age / Gender: </span>{patient.age}y / {patient.gender}</div>
          <div><span className="font-bold">Blood Group: </span>{patient.blood_group||'—'}</div>
          <div><span className="font-bold">Mobile: </span>{patient.mobile}</div>
          <div><span className="font-bold">ABHA ID: </span>{patient.abha_id||'—'}</div>
          <div><span className="font-bold">Date of Admission: </span>{form.admission_date?formatDate(form.admission_date):'—'}</div>
          <div><span className="font-bold">Date of Discharge: </span>{form.discharge_date?formatDate(form.discharge_date):'—'}</div>
        </div>
        <div className="mb-3 border border-gray-300 rounded p-3">
          <div><span className="font-bold">Final Diagnosis: </span>{form.final_diagnosis||'—'}</div>
          {form.secondary_diagnosis&&<div className="mt-1"><span className="font-bold">Secondary: </span>{form.secondary_diagnosis}</div>}
        </div>
        {[{label:'Clinical Summary',val:form.clinical_summary},{label:'Investigations',val:form.investigations},{label:'Treatment Given',val:form.treatment_given},{label:'Condition at Discharge',val:form.condition_at_discharge},{label:'Complications',val:form.complications}].filter(s=>s.val).map(s=><PrintSection key={s.label} label={s.label} value={s.val!}/>)}
        {showOB&&(form.delivery_type||form.baby_weight)&&(
          <div className="mb-3 border border-pink-200 rounded p-3 bg-pink-50">
            <div className="font-bold mb-2 text-pink-800">Obstetric / Delivery Details</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {form.delivery_type&&<div><span className="font-semibold">Delivery: </span>{form.delivery_type}</div>}
              {form.delivery_date&&<div><span className="font-semibold">Date: </span>{formatDate(form.delivery_date)}</div>}
              {form.baby_sex&&<div><span className="font-semibold">Baby Sex: </span>{form.baby_sex}</div>}
              {form.baby_weight&&<div><span className="font-semibold">Birth Weight: </span>{form.baby_weight}</div>}
              {form.apgar_score&&<div><span className="font-semibold">APGAR: </span>{form.apgar_score}</div>}
            </div>
            {form.lactation_advice&&<div className="mt-1"><span className="font-semibold">Lactation: </span>{form.lactation_advice}</div>}
          </div>
        )}
        {[{label:'Discharge Advice',val:form.discharge_advice},{label:'Dietary Advice',val:form.diet_advice},{label:'Medications at Discharge',val:form.medications_at_discharge}].filter(s=>s.val).map(s=><PrintSection key={s.label} label={s.label} value={s.val!}/>)}
        {(form.follow_up_date||form.follow_up_note)&&(
          <div className="mb-3 border border-green-200 rounded p-3 bg-green-50">
            <span className="font-bold">Follow-up: </span>
            {form.follow_up_date&&<span>{formatDate(form.follow_up_date)} </span>}
            {form.follow_up_note&&<span>— {form.follow_up_note}</span>}
          </div>
        )}
        <div className="flex justify-between items-end mt-10 pt-4 border-t-2 border-gray-400">
          <div className="text-gray-500 text-[10px]">
            <div>Printed: {new Date().toLocaleString('en-IN')}</div>
            {existing&&<div>Version: {existing.version}</div>}
            {isFinal&&<div className="font-semibold text-green-700">✓ Finalised</div>}
          </div>
          <div className="text-right">
            <div className="border-t-2 border-gray-800 pt-2 mt-12 w-52">
              <div className="font-bold text-sm">{form.signed_by||'Doctor Name'}</div>
              <div className="text-xs text-gray-500">{hs.doctorQual}</div>
              <div className="text-xs text-gray-500">Reg. No: {hs.doctorReg}</div>
              <div className="text-xs text-gray-500">{hs.hospitalName}</div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
