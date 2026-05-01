'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import FormScanner from '@/components/shared/FormScanner'
import ClinicalSafetyModal from '@/components/clinical/ClinicalSafetyModal'
import type { ClinicalAlert } from '@/components/clinical/ClinicalSafetyModal'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings, minFollowUpDate, isSunday } from '@/lib/utils'
import { searchDrugs } from '@/lib/drug-database'
import { runPrescriptionSafetyChecks } from '@/lib/prescription-safety'
import { audit, auditSafetyOverride } from '@/lib/audit'
import type { Medication } from '@/types'
import type { OCRResult } from '@/lib/ocr'
import { Plus, Trash2, Printer, Save, ArrowLeft, CheckCircle, Shield, AlertTriangle } from 'lucide-react'
import SmartMic from '@/components/shared/SmartMic'

const ROUTES = ['Oral','IV','IM','Topical','Sublingual','Inhalation','Rectal','Nasal']
const FREQS  = ['Once daily','Twice daily','Thrice daily','Four times daily',
                'Every 6 hours','Every 8 hours','At bedtime','SOS / As needed','Once weekly']
const COMMON = [
  'Folic Acid 5mg','Iron + Folic Acid','Calcium 500mg','Vitamin D3 60000 IU',
  'Progesterone 200mg SR','Dydrogesterone 10mg','Methyldopa 250mg',
  'Labetalol 100mg','Nifedipine 10mg','Nifedipine 30mg SR',
  'Metformin 500mg','Metformin 1000mg','Tranexamic acid 500mg',
  'Mefenamic acid 500mg','Norethisterone 5mg','Clomiphene 50mg',
  'Letrozole 2.5mg','Azithromycin 500mg','Amoxicillin 500mg',
  'Metronidazole 400mg','Ondansetron 4mg','Domperidone 10mg',
  'Pantoprazole 40mg','Paracetamol 500mg','Ibuprofen 400mg',
]

// Common gynecology investigations grouped by category
const REPORT_OPTIONS = [
  // Blood
  'CBC (Complete Blood Count)',
  'Hb (Haemoglobin)',
  'Blood group & Rh',
  'Blood sugar fasting',
  'Blood sugar PP (post-prandial)',
  'HbA1c',
  'Thyroid function test (TSH, T3, T4)',
  'LH / FSH',
  'Prolactin',
  'AMH (Anti-Mullerian Hormone)',
  'Beta-hCG (Pregnancy test)',
  'CA-125',
  'Lipid profile',
  'Liver function test (LFT)',
  'Kidney function test (KFT)',
  'Coagulation profile (PT, INR, aPTT)',
  'Serum iron & ferritin',
  'Vitamin D3',
  'Vitamin B12',
  // Urine
  'Urine routine & microscopy',
  'Urine culture & sensitivity',
  // Imaging
  'USG Pelvis (Transvaginal)',
  'USG Pelvis (Transabdominal)',
  'USG Abdomen',
  'USG Pelvis for follicular study',
  'USG Obstetric (dating / anomaly)',
  'Fetal growth scan',
  'Colour Doppler study',
  'Mammography',
  'CT scan abdomen & pelvis',
  'MRI pelvis',
  // Swabs / Smears
  'PAP smear / cervical cytology',
  'High vaginal swab (HVS) culture',
  'Colposcopy',
  // Cardiac
  'ECG',
  'ECHO (Echocardiogram)',
  // Endoscopy
  'Hysteroscopy',
  'Laparoscopy (diagnostic)',
  // Other
  'OGTT (Glucose tolerance test)',
  'Semen analysis (husband)',
  'Karyotype / Genetic study',
  'Antiphospholipid antibody panel',
  'COVID-19 RTPCR / Rapid antigen',
]

const emptyMed = (): Medication => ({
  drug:'', dose:'', route:'Oral', frequency:'Twice daily', duration:'', instructions:''
})

export default function PrescriptionPage() {
  const { id: encounterId } = useParams<{ id: string }>()
  const router = useRouter()

  const [encounter, setEncounter] = useState<any>(null)
  const [patient,   setPatient]   = useState<any>(null)
  const [existing,  setExisting]  = useState<any>(null)

  const [meds,          setMeds]          = useState<Medication[]>([emptyMed()])
  const [advice,        setAdvice]        = useState('')
  const [dietaryAdvice, setDietaryAdvice] = useState('')
  const [reportsNeeded, setReportsNeeded] = useState('')
  const [followUpDate,  setFollowUpDate]  = useState('')
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [drugSuggestion, setDrugSuggestion] = useState<{idx:number;list:string[]}|null>(null)
  const [safetyAlerts,  setSafetyAlerts]  = useState<ClinicalAlert[]>([])
  const [showSafetyModal, setShowSafetyModal] = useState(false)
  const [safetyChecked, setSafetyChecked] = useState(false)
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : { hospitalName:'NexMedicon Demo Hospital', address:'', phone:'', regNo:'', gstin:'', doctorName:'Dr. Demo', doctorQual:'MBBS, MD (OBG)', doctorReg:'', footerNote:'' }

  useEffect(() => { if (encounterId) loadData() }, [encounterId])

  async function loadData() {
    const { data: enc } = await supabase
      .from('encounters').select('*, patients(*)').eq('id', encounterId).single()
    if (enc) { setEncounter(enc); setPatient(enc.patients) }

    const { data: rx } = await supabase
      .from('prescriptions').select('*').eq('encounter_id', encounterId).single()
    if (rx) {
      setExisting(rx)
      setMeds(rx.medications?.length ? rx.medications : [emptyMed()])
      setAdvice(rx.advice || '')
      setDietaryAdvice(rx.dietary_advice || '')
      setReportsNeeded(rx.reports_needed || '')
      setFollowUpDate(rx.follow_up_date || '')
    }
  }

  // OCR: scan a lab report or old prescription to fill medications
  function handleOCR(result: OCRResult) {
    if (result.prescription) {
      const rx = result.prescription
      if (rx.medications?.length) {
        const mapped: Medication[] = rx.medications.map(m => ({
          drug: m.drug || '', dose: m.dose || '', route: m.route || 'Oral',
          frequency: m.frequency || 'Twice daily', duration: m.duration || '',
          instructions: m.instructions || '',
        }))
        setMeds(prev => {
          const hasEmpty = prev.length === 1 && !prev[0].drug.trim()
          return hasEmpty ? mapped : [...prev, ...mapped]
        })
      }
      if (rx.advice) setAdvice(prev => prev ? prev + '\n' + rx.advice : rx.advice!)
      if (rx.follow_up_date) setFollowUpDate(rx.follow_up_date)
    }
    if (result.lab?.all_results) {
      setReportsNeeded(prev => prev ? prev + '\n' + result.lab!.all_results : result.lab!.all_results!)
    }
  }

  function updateMed(idx: number, field: keyof Medication, val: string) {
    setMeds(prev => prev.map((m,i) => i===idx ? {...m,[field]:val} : m))
  }
  function addMed() { setMeds(prev => [...prev, emptyMed()]) }
  function removeMed(idx: number) {
    setMeds(prev => prev.length===1 ? [emptyMed()] : prev.filter((_,i)=>i!==idx))
  }
  function handleDrugInput(idx: number, val: string) {
    updateMed(idx,'drug',val)
    setSafetyChecked(false) // Reset safety check when meds change
    if (val.length >= 2) {
      // Search from comprehensive drug database (200+ drugs) + common list
      const dbMatches = searchDrugs(val, 4).map(d => `${d.generic} ${d.strengths[0] || ''}`.trim())
      const commonMatches = COMMON.filter(d => d.toLowerCase().includes(val.toLowerCase()))
      const allMatches = Array.from(new Set([...dbMatches, ...commonMatches])).slice(0, 8)
      setDrugSuggestion(allMatches.length ? {idx, list: allMatches} : null)
    } else setDrugSuggestion(null)
  }

  // ── Safety Check before Save ────────────────────────────────
  async function handleSaveWithSafetyCheck() {
    if (!encounterId || !patient) return
    const validMeds = meds.filter(m => m.drug.trim())
    if (validMeds.length === 0) { handleSave(); return }

    // Run all clinical safety checks
    const isPregnant = encounter?.ob_data?.lmp || encounter?.ob_data?.edd
    const result = await runPrescriptionSafetyChecks({
      medications: validMeds,
      patientId: patient.id,
      patientAge: patient.age,
      patientWeight: patient.weight_kg || encounter?.weight,
      isPregnant: !!isPregnant,
      gestationalAge: encounter?.ob_data?.gestational_age,
    })

    if (result.hasAlerts) {
      setSafetyAlerts(result.alerts)
      setShowSafetyModal(true)
    } else {
      setSafetyChecked(true)
      handleSave()
    }
  }

  async function handleSafetyAcknowledge(overrideReason?: string) {
    setShowSafetyModal(false)
    setSafetyChecked(true)

    // Log safety override in audit trail
    if (overrideReason) {
      await auditSafetyOverride('drug_interaction', encounterId, patient?.full_name || '', {
        alerts: safetyAlerts.map(a => ({ level: a.level, title: a.title, category: a.category })),
        overrideReason,
        medications: meds.filter(m => m.drug.trim()).map(m => m.drug),
      })
    }

    handleSave()
  }

  async function handleSave() {
    if (!encounterId || !patient) return
    setSaving(true)
    const validMeds = meds.filter(m => m.drug.trim())
    const payload = {
      encounter_id: encounterId, patient_id: patient.id, medications: validMeds,
      advice: advice.trim()||null, dietary_advice: dietaryAdvice.trim()||null,
      reports_needed: reportsNeeded.trim()||null, follow_up_date: followUpDate||null,
    }
    if (existing) await supabase.from('prescriptions').update(payload).eq('id', existing.id)
    else { const {data} = await supabase.from('prescriptions').insert(payload).select().single(); setExisting(data) }

    // Audit the prescription save
    await audit('create', 'prescription', encounterId, patient?.full_name || '')

    // ── FIX #8: Sync follow-up date → appointments table ─────────────
    // When a follow-up date is set, automatically create (or update) a
    // corresponding appointment so it appears in the Appointments page
    // and the Reminders queue without the doctor having to do it manually.
    if (followUpDate) {
      try {
        // Check if a follow-up appointment already exists for this encounter
        const { data: existing_appt } = await supabase
          .from('appointments')
          .select('id')
          .eq('patient_id', patient.id)
          .eq('type', 'follow_up')
          .eq('date', followUpDate)
          .maybeSingle()

        if (!existing_appt) {
          await supabase.from('appointments').insert({
            patient_id:   patient.id,
            patient_name: patient.full_name,
            mrn:          patient.mrn,
            mobile:       patient.phone || null,
            date:         followUpDate,
            time:         '10:00',
            type:         'follow_up',
            status:       'scheduled',
            notes:        `Follow-up from encounter on ${encounter?.encounter_date || 'recent visit'}`,
          })
        }
      } catch (e) {
        // Non-fatal — prescription still saved even if appointment sync fails
        console.warn('[Prescription] follow-up appointment sync failed:', e)
      }
    }

    setSaving(false); setSaved(true); setTimeout(()=>setSaved(false), 3000)
  }

  if (!encounter || !patient) return (
    <AppShell><div className="p-6 flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div></AppShell>
  )

  return (
    <AppShell>
      {/* SCREEN */}
      <div className="no-print p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-5">
          <div className="flex items-center gap-2">
            <button onClick={()=>router.back()} className="text-gray-400 hover:text-gray-700" title="Back">
              <ArrowLeft className="w-5 h-5"/>
            </button>
            <a href={`/opd/${encounterId}/edit`}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1 border border-blue-200 rounded-lg px-2 py-1 bg-blue-50">
              ✏️ Edit Vitals / Diagnosis
            </a>
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">Prescription</h1>
            <p className="text-sm text-gray-500">
              {patient.full_name} · {patient.mrn} · {encounter.encounter_date && formatDate(encounter.encounter_date)}
            </p>
          </div>
          <div className="flex gap-2">
            {patient && (
              <Link href={`/billing?patientId=${patient.id}&patientName=${encodeURIComponent((patient as any).full_name||'Patient')}&mrn=${(patient as any).mrn||''}&encounterType=${encounter?.encounter_type||'OPD'}`}
                className="btn-secondary flex items-center gap-1.5 text-xs bg-green-50 border-green-200 text-green-700 hover:bg-green-100">
                <span>💳</span> Collect Payment
              </Link>
            )}
            <button onClick={()=>window.print()} className="btn-secondary flex items-center gap-2 text-xs">
              <Printer className="w-3.5 h-3.5"/>Print
            </button>
            <button onClick={handleSaveWithSafetyCheck} disabled={saving}
              className={`flex items-center gap-2 text-xs px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-60
                ${saved?'bg-green-600 text-white':safetyChecked?'bg-blue-600 hover:bg-blue-700 text-white':'bg-blue-600 hover:bg-blue-700 text-white'}`}>
              {saving ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                : saved ? <CheckCircle className="w-3.5 h-3.5"/> : <Shield className="w-3.5 h-3.5"/>}
              {saving?'Saving...':saved?'Saved!':'Save'}
            </button>
          </div>
        </div>

        {/* OCR Scanner */}
        <FormScanner formType="prescription" onExtracted={handleOCR}
          label="Scan Lab Report or Old Prescription — auto-fills medicines and results"
          className="mb-5" />

        {/* Medications */}
        <div className="card p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title mb-0">Medications</h2>
            <button onClick={addMed} className="btn-secondary text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5"/>Add Medicine
            </button>
          </div>
          <div className="space-y-3">
            {meds.map((med, idx) => (
              <div key={idx} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-4 relative">
                    <label className="label">Medicine Name</label>
                    <input className="input bg-white" placeholder="e.g. Folic Acid 5mg" value={med.drug}
                      onChange={e => handleDrugInput(idx, e.target.value)}
                      onBlur={()=>setTimeout(()=>setDrugSuggestion(null),200)} />
                    {drugSuggestion?.idx===idx && drugSuggestion.list.length>0 && (
                      <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-lg shadow-lg mt-1">
                        {drugSuggestion.list.map(d=>(
                          <button key={d} type="button" onMouseDown={()=>{updateMed(idx,'drug',d);setDrugSuggestion(null)}}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 last:border-0">{d}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-span-2">
                    <label className="label">Dose</label>
                    <input className="input bg-white" placeholder="500mg" value={med.dose}
                      onChange={e=>updateMed(idx,'dose',e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className="label">Route</label>
                    <select className="input bg-white" value={med.route} onChange={e=>updateMed(idx,'route',e.target.value)}>
                      {ROUTES.map(r=><option key={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="label">Frequency</label>
                    <select className="input bg-white" value={med.frequency} onChange={e=>updateMed(idx,'frequency',e.target.value)}>
                      {FREQS.map(f=><option key={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className="label">Duration</label>
                    <input className="input bg-white" placeholder="7 days" value={med.duration}
                      onChange={e=>updateMed(idx,'duration',e.target.value)} />
                  </div>
                  <div className="col-span-1 flex items-end">
                    <button type="button" onClick={()=>removeMed(idx)}
                      className="w-full p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-4 h-4 mx-auto"/>
                    </button>
                  </div>
                  <div className="col-span-11">
                    <label className="label">Instructions</label>
                    <input className="input bg-white" placeholder="e.g. Take after food" value={med.instructions||''}
                      onChange={e=>updateMed(idx,'instructions',e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Advice */}
        <div className="card p-5 mb-4">
          <h2 className="section-title">Advice & Follow-up</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label flex items-center gap-2">Specific Advice <SmartMic field="advice" value={advice} onChange={setAdvice} context="Patient advice and instructions" size="sm"/></label>
              <textarea className="input resize-none" rows={3}
                placeholder="Rest, avoid intercourse, etc."
                value={advice} onChange={e=>setAdvice(e.target.value)} />
            </div>
            <div>
              <label className="label flex items-center gap-2">Dietary Advice <SmartMic field="dietary_advice" value={dietaryAdvice} onChange={setDietaryAdvice} context="Dietary advice and nutrition" size="sm"/></label>
              <textarea className="input resize-none" rows={3}
                placeholder="High protein diet, iron-rich foods..."
                value={dietaryAdvice} onChange={e=>setDietaryAdvice(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">Reports / Investigations Needed</label>
              {/* Quick-add dropdown */}
              <div className="flex gap-2 mb-2 flex-wrap">
                <select className="input flex-1 text-sm py-1.5"
                  onChange={e => {
                    const val = e.target.value
                    if (!val) return
                    setReportsNeeded(prev => {
                      const existing = prev.trim()
                      if (existing.includes(val)) return prev  // already added
                      return existing ? existing + ',\n' + val : val
                    })
                    e.target.value = ''  // reset select
                  }}>
                  <option value="">+ Add from common list…</option>
                  {REPORT_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              {/* Selected / typed investigations */}
              <textarea className="input resize-none font-mono text-sm" rows={3}
                placeholder="Selected investigations appear here. You can also type freely or add custom tests."
                value={reportsNeeded} onChange={e=>setReportsNeeded(e.target.value)} />
              <p className="text-xs text-gray-400 mt-1">
                One per line. Use the dropdown to add common tests, or type custom tests directly.
              </p>
            </div>
            <div>
              <label className="label">Follow-up Date</label>
              <input className="input" type="date" min={minFollowUpDate()}
                value={followUpDate}
                onChange={e => {
                  const val = e.target.value
                  if (!val) { setFollowUpDate(''); return }
                  // Never allow Sunday — move to the next Monday
                  if (isSunday(val)) {
                    const d = new Date(val)
                    d.setDate(d.getDate() + 1)
                    setFollowUpDate(d.toISOString().split('T')[0])
                  } else {
                    setFollowUpDate(val)
                  }
                }}/>
              {followUpDate && isSunday(followUpDate) === false && new Date(followUpDate).getDay() !== 0
                ? null
                : followUpDate && <p className="text-xs text-orange-500 mt-1">Sundays excluded — date moved to Monday</p>
              }
              <div className="flex gap-2 mt-2">
                {[{l:'+1 week',d:7},{l:'+2 weeks',d:14},{l:'+1 month',d:30},{l:'+3 months',d:90}].map(({l,d})=>(
                  <button key={l} type="button" onClick={()=>{
                    const dt=new Date(); dt.setDate(dt.getDate()+d);
                    if(dt.getDay()===0) dt.setDate(dt.getDate()+1);  // skip Sunday
                    setFollowUpDate(dt.toISOString().split('T')[0])
                  }} className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded border border-blue-100">{l}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PRINT VIEW */}
      <div className="print-only print-container p-8 max-w-[700px] mx-auto">
        <div className="text-center border-b-2 border-gray-800 pb-4 mb-4">
          <h1 className="text-2xl font-bold tracking-wide">{hs.hospitalName}</h1>
          <p className="text-sm text-gray-600">{hs.address} — Phone: {hs.phone}</p>
          <p className="text-xs text-gray-500">Reg. No: {hs.regNo} · GSTIN: {hs.gstin}</p>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm border border-gray-300 rounded p-3">
          <div><span className="font-semibold">Patient: </span>{patient.full_name}</div>
          <div><span className="font-semibold">MRN: </span>{patient.mrn}</div>
          <div><span className="font-semibold">Age/Gender: </span>{patient.age}y / {patient.gender}</div>
          <div><span className="font-semibold">Date: </span>{formatDate(encounter.encounter_date)}</div>
          <div><span className="font-semibold">Mobile: </span>{patient.mobile}</div>
          {encounter.diagnosis && <div><span className="font-semibold">Dx: </span>{encounter.diagnosis}</div>}
        </div>
        {(encounter.pulse||encounter.bp_systolic||encounter.temperature) && (
          <div className="flex gap-4 mb-4 text-xs flex-wrap border border-gray-200 rounded p-2 bg-gray-50">
            {encounter.pulse       && <span>Pulse: <b>{encounter.pulse} bpm</b></span>}
            {encounter.bp_systolic && <span>BP: <b>{encounter.bp_systolic}/{encounter.bp_diastolic} mmHg</b></span>}
            {encounter.temperature && <span>Temp: <b>{encounter.temperature}°C</b></span>}
            {encounter.spo2        && <span>SpO₂: <b>{encounter.spo2}%</b></span>}
            {encounter.weight      && <span>Wt: <b>{encounter.weight} kg</b></span>}
          </div>
        )}
        <div className="mb-4">
          <div className="text-3xl font-bold text-gray-700 mb-3" style={{fontFamily:'serif'}}>℞</div>
          <div className="space-y-2">
            {meds.filter(m=>m.drug.trim()).map((m,i)=>(
              <div key={i} className="flex gap-3 text-sm border-b border-gray-100 pb-2">
                <span className="font-bold w-6 text-gray-500">{i+1}.</span>
                <div>
                  <div className="font-semibold">{m.drug}</div>
                  <div className="text-gray-600 text-xs">
                    {m.dose&&<span>{m.dose} · </span>}
                    {m.route&&<span>{m.route} · </span>}
                    <span>{m.frequency}</span>
                    {m.duration&&<span> · {m.duration}</span>}
                    {m.instructions&&<span> — <em>{m.instructions}</em></span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {(advice||dietaryAdvice||reportsNeeded) && (
          <div className="mb-4 border border-gray-200 rounded p-3 text-sm">
            <div className="font-semibold mb-2">Advice:</div>
            {advice&&<div className="mb-1">• {advice}</div>}
            {dietaryAdvice&&<div className="mb-1">• Dietary: {dietaryAdvice}</div>}
            {reportsNeeded&&<div className="mb-1">• Reports: {reportsNeeded}</div>}
          </div>
        )}
        {followUpDate&&<div className="mb-6 text-sm font-semibold">Follow-up: {formatDate(followUpDate)}</div>}
        <div className="flex justify-between items-end mt-8 pt-4 border-t border-gray-300 text-sm">
          <div className="text-gray-500 text-xs">Printed: {new Date().toLocaleDateString('en-IN')}</div>
          <div className="text-right">
            <div className="border-t border-gray-800 pt-2 mt-8 w-40">
              <div className="font-semibold">{hs.doctorName}</div>
              <div className="text-xs text-gray-500">{hs.doctorQual}</div>
              <div className="text-xs text-gray-500">Reg. No: {hs.doctorReg}</div>
            </div>
          </div>
        </div>
        {hs.footerNote && (
          <div className="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-400 text-center">{hs.footerNote}</div>
        )}
      </div>

      {/* Clinical Safety Modal */}
      {showSafetyModal && safetyAlerts.length > 0 && (
        <ClinicalSafetyModal
          alerts={safetyAlerts}
          onAcknowledge={handleSafetyAcknowledge}
          onCancel={() => setShowSafetyModal(false)}
          patientName={patient?.full_name}
        />
      )}
    </AppShell>
  )
}
