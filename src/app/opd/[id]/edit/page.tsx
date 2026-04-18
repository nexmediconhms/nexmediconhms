'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import SmartMic from '@/components/shared/SmartMic'
import { supabase } from '@/lib/supabase'
import { calculateBMI, calculateEDD, calculateGA, getHospitalSettings } from '@/lib/utils'
import type { OBData, Encounter } from '@/types'
import { ArrowLeft, Save, CheckCircle, AlertCircle, ChevronRight } from 'lucide-react'

type Tab = 'vitals' | 'consultation' | 'obgyn'

interface Vitals {
  pulse: string; bp_systolic: string; bp_diastolic: string
  temperature: string; spo2: string; weight: string; height: string
}

export default function EditEncounterPage() {
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()

  const [encounter, setEncounter] = useState<Encounter | null>(null)
  const [patient,   setPatient]   = useState<any>(null)
  const [tab,       setTab]       = useState<Tab>('vitals')
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [error,     setError]     = useState('')

  const [vitals, setVitals] = useState<Vitals>({
    pulse: '', bp_systolic: '', bp_diastolic: '',
    temperature: '', spo2: '', weight: '', height: '',
  })
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [hpi,            setHpi]            = useState('')
  const [diagnosis,      setDiagnosis]      = useState('')
  const [notes,          setNotes]          = useState('')
  const [ob,             setOB]             = useState<OBData>({})

  const bmi = calculateBMI(parseFloat(vitals.weight), parseFloat(vitals.height))
  const edd = ob.lmp ? calculateEDD(ob.lmp) : ''
  const ga  = ob.lmp ? calculateGA(ob.lmp)  : ''

  useEffect(() => { if (id) loadEncounter() }, [id])

  async function loadEncounter() {
    const { data: enc } = await supabase
      .from('encounters').select('*, patients(*)').eq('id', id).single()
    if (!enc) { setLoading(false); return }
    setEncounter(enc)
    setPatient(enc.patients)

    // Pre-fill all fields from existing encounter
    setVitals({
      pulse:        enc.pulse        ? String(enc.pulse)        : '',
      bp_systolic:  enc.bp_systolic  ? String(enc.bp_systolic)  : '',
      bp_diastolic: enc.bp_diastolic ? String(enc.bp_diastolic) : '',
      temperature:  enc.temperature  ? String(enc.temperature)  : '',
      spo2:         enc.spo2         ? String(enc.spo2)         : '',
      weight:       enc.weight       ? String(enc.weight)       : '',
      height:       enc.height       ? String(enc.height)       : '',
    })
    setChiefComplaint(enc.chief_complaint || '')
    setDiagnosis(enc.diagnosis || '')
    setNotes(enc.notes || '')
    setOB((enc.ob_data as OBData) || {})
    setLoading(false)
  }

  function setV(k: keyof Vitals, v: string) { setVitals(p => ({ ...p, [k]: v })) }
  function setO(k: keyof OBData, v: any)    { setOB(p => ({ ...p, [k]: v })) }

  async function handleSave() {
    if (!id) return
    if (!chiefComplaint.trim() && !diagnosis.trim()) {
      setError('Please enter at least a chief complaint or diagnosis.')
      return
    }
    setSaving(true); setError('')

    const obPayload: OBData = { ...ob }
    if (ob.lmp) { obPayload.edd = edd; obPayload.gestational_age = ga }

    const { error: err } = await supabase.from('encounters').update({
      chief_complaint: chiefComplaint.trim() || null,
      pulse:           vitals.pulse       ? parseInt(vitals.pulse)        : null,
      bp_systolic:     vitals.bp_systolic  ? parseInt(vitals.bp_systolic)  : null,
      bp_diastolic:    vitals.bp_diastolic ? parseInt(vitals.bp_diastolic) : null,
      temperature:     vitals.temperature  ? parseFloat(vitals.temperature): null,
      spo2:            vitals.spo2         ? parseInt(vitals.spo2)         : null,
      weight:          vitals.weight       ? parseFloat(vitals.weight)     : null,
      height:          vitals.height       ? parseFloat(vitals.height)     : null,
      diagnosis:       diagnosis.trim()    || null,
      notes:           notes.trim()        || null,
      ob_data:         obPayload,
      doctor_name:     getHospitalSettings().doctorName,
    }).eq('id', id)

    setSaving(false)
    if (err) { setError(`Save failed: ${err.message}`); return }
    setSaved(true)
    setTimeout(() => router.push(`/opd/${id}`), 1200)
  }

  if (loading) return (
    <AppShell><div className="p-6 flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div></AppShell>
  )
  if (!encounter || !patient) return (
    <AppShell><div className="p-6 text-center py-20 text-gray-400">Encounter not found.</div></AppShell>
  )

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">Edit Consultation</h1>
            <p className="text-sm text-gray-500">
              <strong className="text-blue-700">{patient.full_name}</strong>
              <span className="text-gray-400"> · {patient.mrn} · {patient.age}y · </span>
              <span className="text-gray-400">{encounter.encounter_date}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/opd/${id}`} className="btn-secondary text-xs">Cancel</Link>
            <button onClick={handleSave} disabled={saving || saved}
              className="btn-primary flex items-center gap-2 disabled:opacity-60">
              {saving
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : saved
                ? <CheckCircle className="w-4 h-4" />
                : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
            </button>
          </div>
        </div>

        {saved && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> Changes saved. Redirecting…
          </div>
        )}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-5 bg-white rounded-t-xl overflow-hidden shadow-sm">
          {([
            { id:'vitals',       label:'Vitals & Complaints'       },
            { id:'consultation', label:'Consultation & Diagnosis'  },
            { id:'obgyn',        label:'Gynecology / OB Exam'      },
          ] as { id: Tab; label: string }[]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2
                ${tab === t.id
                  ? 'border-blue-600 text-blue-700 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── TAB 1: VITALS ── */}
        {tab === 'vitals' && (
          <div className="space-y-5">
            <div className="card p-5">
              <h2 className="section-title">Vital Signs</h2>
              <div className="grid grid-cols-3 gap-4">
                <VCard label="Pulse" unit="bpm" value={vitals.pulse} onChange={v=>setV('pulse',v)} placeholder="72"/>
                <div>
                  <label className="label">Blood Pressure</label>
                  <div className="flex items-center gap-2">
                    <input className="input text-center" placeholder="120" maxLength={3}
                      value={vitals.bp_systolic} onChange={e=>setV('bp_systolic',e.target.value.replace(/\D/g,''))}/>
                    <span className="text-gray-400 font-bold">/</span>
                    <input className="input text-center" placeholder="80" maxLength={3}
                      value={vitals.bp_diastolic} onChange={e=>setV('bp_diastolic',e.target.value.replace(/\D/g,''))}/>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">mmHg</p>
                </div>
                <VCard label="Temperature" unit="°C" value={vitals.temperature} onChange={v=>setV('temperature',v)} placeholder="37.0"/>
                <VCard label="SpO₂" unit="%" value={vitals.spo2} onChange={v=>setV('spo2',v)} placeholder="98"/>
                <VCard label="Weight" unit="kg" value={vitals.weight} onChange={v=>setV('weight',v)} placeholder="60"/>
                <VCard label="Height" unit="cm" value={vitals.height} onChange={v=>setV('height',v)} placeholder="160"/>
              </div>
              {bmi && (
                <div className="mt-4 inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
                  <span className="text-xs text-gray-500 font-semibold">BMI:</span>
                  <span className={`font-bold text-sm ${parseFloat(bmi)<18.5?'text-blue-600':parseFloat(bmi)<25?'text-green-600':parseFloat(bmi)<30?'text-yellow-600':'text-red-600'}`}>
                    {bmi} kg/m²
                  </span>
                </div>
              )}
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-1">
                <label className="section-title mb-0">Chief Complaint</label>
                <SmartMic field="cc" value={chiefComplaint} onChange={setChiefComplaint} context="Chief Complaint"/>
              </div>
              <textarea className="input resize-none" rows={3}
                placeholder="e.g. Lower abdominal pain for 3 days"
                value={chiefComplaint} onChange={e=>setChiefComplaint(e.target.value)}/>
            </div>
            <div className="flex justify-end">
              <button onClick={()=>setTab('consultation')} className="btn-primary flex items-center gap-2">
                Next: Consultation <ChevronRight className="w-4 h-4"/>
              </button>
            </div>
          </div>
        )}

        {/* ── TAB 2: CONSULTATION ── */}
        {tab === 'consultation' && (
          <div className="space-y-5">
            <div className="card p-5">
              <h2 className="section-title">Consultation Notes</h2>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">History of Present Illness</label>
                    <SmartMic field="hpi" value={hpi} onChange={setHpi} context="History of Present Illness"/>
                  </div>
                  <textarea className="input resize-none" rows={4}
                    placeholder="Detailed history, onset, duration, severity…"
                    value={hpi} onChange={e=>setHpi(e.target.value)}/>
                </div>
                <div>
                  <label className="label">Diagnosis / Impression</label>
                  <input className="input" placeholder="e.g. Polycystic Ovarian Syndrome (PCOS)"
                    value={diagnosis} onChange={e=>setDiagnosis(e.target.value)}/>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">Clinical Notes</label>
                    <SmartMic field="notes" value={notes} onChange={setNotes} context="Clinical Notes"/>
                  </div>
                  <textarea className="input resize-none" rows={5}
                    placeholder="Examination findings, assessment, plan…"
                    value={notes} onChange={e=>setNotes(e.target.value)}/>
                </div>
              </div>
            </div>
            <div className="flex justify-between">
              <button onClick={()=>setTab('vitals')} className="btn-secondary flex items-center gap-2">
                <ArrowLeft className="w-4 h-4"/>Back
              </button>
              <button onClick={()=>setTab('obgyn')} className="btn-primary flex items-center gap-2">
                Next: OB/GYN Exam <ChevronRight className="w-4 h-4"/>
              </button>
            </div>
          </div>
        )}

        {/* ── TAB 3: OB/GYN ── */}
        {tab === 'obgyn' && (
          <div className="space-y-5">

            {/* Obstetric history */}
            <div className="card p-5">
              <h2 className="section-title">A. Obstetric History</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">LMP</label>
                  <input className="input" type="date" max={new Date().toISOString().split('T')[0]}
                    value={ob.lmp||''} onChange={e=>setO('lmp',e.target.value)}/>
                </div>
                <div>
                  <label className="label">EDD (auto)</label>
                  <input className="input bg-blue-50 font-semibold text-blue-700" readOnly
                    value={edd||'Enter LMP to calculate'}/>
                </div>
                <div>
                  <label className="label">Gestational Age</label>
                  <input className="input bg-blue-50 font-semibold text-blue-700" readOnly
                    value={ga||'Enter LMP to calculate'}/>
                </div>
                {(['gravida','para','abortion','living'] as const).map(f => (
                  <div key={f}>
                    <label className="label capitalize">{f}</label>
                    <input className="input" type="number" min="0" placeholder="0"
                      value={(ob as any)[f]??''} onChange={e=>setO(f,parseInt(e.target.value)||0)}/>
                  </div>
                ))}
              </div>
            </div>

            {/* ANC */}
            <div className="card p-5">
              <h2 className="section-title">B. Antenatal Examination</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">FHS (bpm)</label>
                  <input className="input" type="number" min="50" max="200" placeholder="140"
                    value={ob.fhs??''} onChange={e=>setO('fhs',parseInt(e.target.value)||undefined)}/>
                </div>
                <div>
                  <label className="label">Liquor</label>
                  <select className="input" value={ob.liquor||''} onChange={e=>setO('liquor',e.target.value)}>
                    <option value="">Select</option>
                    {['Normal','Reduced','Increased','Absent','Not assessed'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Fundal Height (cm)</label>
                  <input className="input" type="number" placeholder="30"
                    value={ob.fundal_height??''} onChange={e=>setO('fundal_height',parseFloat(e.target.value)||undefined)}/>
                </div>
                <div>
                  <label className="label">Presentation</label>
                  <select className="input" value={ob.presentation||''} onChange={e=>setO('presentation',e.target.value)}>
                    <option value="">Select</option>
                    {['Cephalic','Breech','Transverse','Oblique','Not assessed'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Engagement</label>
                  <select className="input" value={ob.engagement||''} onChange={e=>setO('engagement',e.target.value)}>
                    <option value="">Select</option>
                    {['Engaged','Not engaged','2/5','3/5','4/5','5/5'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Per Abdomen */}
            <div className="card p-5">
              <h2 className="section-title">C. Per Abdomen</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Uterus Size</label>
                  <select className="input" value={ob.uterus_size||''} onChange={e=>setO('uterus_size',e.target.value)}>
                    <option value="">Select</option>
                    {['Not gravid','6 wks','8 wks','10 wks','12 wks','16 wks','20 wks','24 wks','28 wks','32 wks','36 wks','40 wks'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Scar Tenderness</label>
                  <select className="input" value={ob.scar_tenderness||''} onChange={e=>setO('scar_tenderness',e.target.value)}>
                    <option value="">Select</option>
                    {['Present','Absent','Not applicable'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Fetal Movement</label>
                  <select className="input" value={ob.fetal_movement||''} onChange={e=>setO('fetal_movement',e.target.value)}>
                    <option value="">Select</option>
                    {['Present','Absent','Not assessed'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">Per Abdomen Findings</label>
                    <SmartMic field="per_abdomen" value={ob.per_abdomen||''} onChange={v=>setO('per_abdomen',v)} context="Per Abdomen findings"/>
                  </div>
                  <textarea className="input resize-none" rows={2} placeholder="Free text findings…"
                    value={ob.per_abdomen||''} onChange={e=>setO('per_abdomen',e.target.value)}/>
                </div>
              </div>
            </div>

            {/* Per Speculum */}
            <div className="card p-5">
              <h2 className="section-title">D. Per Speculum Examination</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Cervix</label>
                  <select className="input" value={ob.cervix_speculum||''} onChange={e=>setO('cervix_speculum',e.target.value)}>
                    <option value="">Select</option>
                    {['Healthy','Congested','Erosion','Growth','Not examined'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Discharge</label>
                  <input className="input" placeholder="e.g. white, curdy"
                    value={ob.discharge_speculum||''} onChange={e=>setO('discharge_speculum',e.target.value)}/>
                </div>
                <div>
                  <label className="label">Bleeding</label>
                  <select className="input" value={ob.bleeding_speculum||''} onChange={e=>setO('bleeding_speculum',e.target.value)}>
                    <option value="">Select</option>
                    {['Present','Absent','Not examined'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">Per Speculum Findings</label>
                    <SmartMic field="per_speculum" value={ob.per_speculum||''} onChange={v=>setO('per_speculum',v)} context="Per Speculum findings"/>
                  </div>
                  <textarea className="input resize-none" rows={2} placeholder="Additional findings…"
                    value={ob.per_speculum||''} onChange={e=>setO('per_speculum',e.target.value)}/>
                </div>
              </div>
            </div>

            {/* Per Vaginum */}
            <div className="card p-5">
              <h2 className="section-title">E. Per Vaginum (PV)</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Cervix Feel</label>
                  <select className="input" value={ob.cervix_pv||''} onChange={e=>setO('cervix_pv',e.target.value)}>
                    <option value="">Select</option>
                    {['Firm','Soft','Not examined'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Os</label>
                  <select className="input" value={ob.os_pv||''} onChange={e=>setO('os_pv',e.target.value)}>
                    <option value="">Select</option>
                    {['Closed','Fingertip','1 cm','2 cm','3 cm','4 cm','Fully dilated','Not examined'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Uterus Position</label>
                  <select className="input" value={ob.uterus_position||''} onChange={e=>setO('uterus_position',e.target.value)}>
                    <option value="">Select</option>
                    {['Anteverted','Retroverted','Mid-position','Not examined'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">PV Findings / Adnexa</label>
                    <SmartMic field="per_vaginum" value={ob.per_vaginum||''} onChange={v=>setO('per_vaginum',v)} context="Per Vaginum PV findings"/>
                  </div>
                  <textarea className="input resize-none" rows={2} placeholder="Adnexa, fornices, masses…"
                    value={ob.per_vaginum||''} onChange={e=>setO('per_vaginum',e.target.value)}/>
                </div>
              </div>
            </div>

            {/* Ovaries */}
            <div className="card p-5">
              <h2 className="section-title">F. Ovary Findings</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Right Ovary</label>
                  <textarea className="input resize-none" rows={2} placeholder="Size, texture, tenderness, cysts…"
                    value={ob.right_ovary||''} onChange={e=>setO('right_ovary',e.target.value)}/>
                </div>
                <div>
                  <label className="label">Left Ovary</label>
                  <textarea className="input resize-none" rows={2} placeholder="Size, texture, tenderness, cysts…"
                    value={ob.left_ovary||''} onChange={e=>setO('left_ovary',e.target.value)}/>
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <button onClick={()=>setTab('consultation')} className="btn-secondary flex items-center gap-2">
                <ArrowLeft className="w-4 h-4"/>Back
              </button>
              <button onClick={handleSave} disabled={saving || saved}
                className="btn-primary flex items-center gap-2 px-8 disabled:opacity-60">
                {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                  : saved ? <CheckCircle className="w-4 h-4"/>
                  : <Save className="w-4 h-4"/>}
                {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function VCard({ label, unit, value, onChange, placeholder }: {
  label: string; unit: string; value: string; onChange: (v:string)=>void; placeholder?: string
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input className="input" type="number" step="any" placeholder={placeholder}
          value={value} onChange={e=>onChange(e.target.value)}/>
        <span className="text-xs text-gray-400 whitespace-nowrap">{unit}</span>
      </div>
    </div>
  )
}
