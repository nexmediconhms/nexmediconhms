'use client'
/**
 * src/app/ipd/page.tsx
 *
 * IPD (In-Patient Department) Module
 * Features:
 *  - IPD Admission Form (admit a patient to a bed)
 *  - Active IPD census (all currently admitted patients)
 *  - Nursing chart: vitals, I/O charting, nursing notes
 *  - Multi-doctor assignment per admission
 *  - Discharge workflow (leads to discharge summary)
 *
 * Storage: Supabase tables `ipd_admissions` + `ipd_nursing`
 * (migrated away from localStorage per requirement #7)
 */

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime, getHospitalSettings } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import {
  BedDouble, UserPlus, Search, RefreshCw, Stethoscope,
  AlertTriangle, Activity, ClipboardList, LogOut, Clock,
  Plus, Trash2, Save, CheckCircle, ChevronDown, ChevronUp,
  IndianRupee, FileText, Users, X
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────

interface IPDAdmission {
  id: string
  patient_id: string
  patient_name: string
  mrn: string
  mobile: string
  age: number | null
  gender: string | null
  bed_id: string
  bed_number: string
  ward: string
  admission_date: string
  admission_time: string
  admitting_doctor: string
  consulting_doctors: string[]   // multi-doctor support
  diagnosis_on_admission: string
  chief_complaint: string
  status: 'active' | 'discharged' | 'transferred'
  diet_type: string
  allergies: string
  comorbidities: string
  insurance_details: string
  relative_name: string
  relative_contact: string
  relative_relation: string
  created_at: string
  updated_at: string
}

interface NursingEntry {
  id: string
  ipd_admission_id: string
  entry_type: 'vital' | 'io' | 'note' | 'medication'
  recorded_time: string
  pulse?: string
  bp_systolic?: string
  bp_diastolic?: string
  temperature?: string
  spo2?: string
  weight?: string
  rr?: string                  // respiratory rate
  vital_note?: string
  io_type?: 'Input' | 'Output'
  io_label?: string
  io_amount_ml?: number
  medication_name?: string
  medication_dose?: string
  medication_route?: string
  medication_given_by?: string
  nurse_name: string
  note_text?: string
  created_at: string
}

// ── Helpers ────────────────────────────────────────────────────

function statusBadge(s: IPDAdmission['status']) {
  if (s === 'active')      return <span className="badge-green text-xs">Active</span>
  if (s === 'discharged')  return <span className="badge-red text-xs">Discharged</span>
  return <span className="badge-yellow text-xs">Transferred</span>
}

function daysSince(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

// ── Main Component ─────────────────────────────────────────────

export default function IPDPage() {
  const { user, can } = useAuth()
  const [admissions, setAdmissions] = useState<IPDAdmission[]>([])
  const [loading, setLoading]       = useState(true)
  const [query, setQuery]           = useState('')
  const [view, setView]             = useState<'census' | 'admit' | 'chart'>('census')
  const [selectedAdmission, setSelectedAdmission] = useState<IPDAdmission | null>(null)

  useEffect(() => { loadAdmissions() }, [])

  async function loadAdmissions() {
    setLoading(true)
    const { data } = await supabase
      .from('ipd_admissions')
      .select('*')
      .eq('status', 'active')
      .order('admission_date', { ascending: false })
    setAdmissions((data || []) as IPDAdmission[])
    setLoading(false)
  }

  const filtered = admissions.filter(a => {
    const q = query.toLowerCase()
    return !q || a.patient_name.toLowerCase().includes(q)
      || a.mrn.toLowerCase().includes(q)
      || a.bed_number.toLowerCase().includes(q)
      || a.ward.toLowerCase().includes(q)
  })

  function openChart(adm: IPDAdmission) {
    setSelectedAdmission(adm)
    setView('chart')
  }

  return (
    <AppShell>
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BedDouble className="w-6 h-6 text-purple-500"/> IPD Management
            </h1>
            <p className="text-sm text-gray-500">
              In-patient admissions, nursing charts, multi-doctor care
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={loadAdmissions} disabled={loading}
              className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-60">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/> Refresh
            </button>
            {can('encounters.create') && (
              <button onClick={() => setView('admit')}
                className="btn-primary flex items-center gap-2 text-xs">
                <UserPlus className="w-3.5 h-3.5"/> Admit Patient
              </button>
            )}
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit">
          {[
            { key: 'census', label: 'IPD Census', icon: Users },
            { key: 'admit',  label: 'New Admission', icon: UserPlus },
          ].map(({ key, label, icon: Icon }) => (
            <button key={key}
              onClick={() => setView(key as any)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${view === key ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon className="w-3.5 h-3.5"/> {label}
            </button>
          ))}
        </div>

        {/* Census View */}
        {view === 'census' && (
          <CensusView
            admissions={filtered}
            loading={loading}
            query={query}
            setQuery={setQuery}
            onOpenChart={openChart}
            onDischarge={loadAdmissions}
            canManage={can('encounters.edit')}
          />
        )}

        {/* Admit View */}
        {view === 'admit' && (
          <AdmitForm
            onSuccess={() => { setView('census'); loadAdmissions() }}
            onCancel={() => setView('census')}
          />
        )}

        {/* Nursing Chart View */}
        {view === 'chart' && selectedAdmission && (
          <NursingChart
            admission={selectedAdmission}
            onBack={() => { setView('census'); setSelectedAdmission(null) }}
            currentUserName={user?.full_name || 'Nurse'}
          />
        )}

      </div>
    </AppShell>
  )
}

// ── Census Table ───────────────────────────────────────────────

function CensusView({
  admissions, loading, query, setQuery, onOpenChart, onDischarge, canManage
}: {
  admissions: IPDAdmission[]
  loading: boolean
  query: string
  setQuery: (q: string) => void
  onOpenChart: (a: IPDAdmission) => void
  onDischarge: () => void
  canManage: boolean
}) {
  async function markDischarged(id: string) {
    if (!confirm('Mark this patient as discharged?')) return
    await supabase
      .from('ipd_admissions')
      .update({ status: 'discharged', updated_at: new Date().toISOString() })
      .eq('id', id)
    // Free the bed
    const adm = admissions.find(a => a.id === id)
    if (adm?.bed_id) {
      await supabase
        .from('beds')
        .update({ status: 'cleaning', patient_id: null, patient_name: null })
        .eq('id', adm.bed_id)
    }
    onDischarge()
  }

  return (
    <>
      <div className="card p-4 mb-5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <input className="input pl-9 bg-gray-50"
            placeholder="Search patient name, MRN, bed number, ward…"
            value={query} onChange={e => setQuery(e.target.value)}/>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-purple-400 border-t-transparent rounded-full animate-spin"/>
        </div>
      ) : admissions.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <BedDouble className="w-12 h-12 mx-auto mb-3 opacity-20"/>
          <p className="font-medium">No active IPD admissions</p>
          <p className="text-sm mt-1">Admit a patient to see them here</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              Active IPD Census
              <span className="ml-2 text-sm font-normal text-gray-400">({admissions.length} patients)</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['Patient', 'Bed / Ward', 'Admitted', 'Days', 'Doctors', 'Diagnosis', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {admissions.map(adm => (
                  <tr key={adm.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/patients/${adm.patient_id}`}
                        className="font-semibold text-gray-900 hover:text-blue-600 hover:underline">
                        {adm.patient_name}
                      </Link>
                      <div className="text-xs text-gray-400">{adm.mrn} · {adm.age}y · {adm.gender}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-purple-700">{adm.bed_number}</div>
                      <div className="text-xs text-gray-400">{adm.ward}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDate(adm.admission_date)}
                      <div className="text-gray-400">{adm.admission_time}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold ${daysSince(adm.admission_date) > 7 ? 'text-orange-600' : 'text-gray-700'}`}>
                        {daysSince(adm.admission_date)}d
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[160px]">
                      <div className="font-medium">{adm.admitting_doctor}</div>
                      {adm.consulting_doctors?.map((d, i) => (
                        <div key={i} className="text-gray-400">+ {d}</div>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[180px] truncate">
                      {adm.diagnosis_on_admission || '—'}
                    </td>
                    <td className="px-4 py-3">{statusBadge(adm.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => onOpenChart(adm)}
                          className="btn-secondary text-xs py-1 px-2 flex items-center gap-1">
                          <Activity className="w-3 h-3"/> Chart
                        </button>
                        {canManage && (
                          <button onClick={() => markDischarged(adm.id)}
                            className="text-xs py-1 px-2 rounded border border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1">
                            <LogOut className="w-3 h-3"/> DC
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ── Admit Form ─────────────────────────────────────────────────

function AdmitForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState<any[]>([])
  const [selectedPatient, setSelectedPatient] = useState<any>(null)
  const [beds, setBeds] = useState<any[]>([])
  const [doctors, setDoctors] = useState<any[]>([])  // all doctors in clinic
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [form, setForm] = useState({
    bed_id: '',
    admission_date: new Date().toISOString().split('T')[0],
    admission_time: new Date().toTimeString().slice(0, 5),
    admitting_doctor: '',
    consulting_doctors: [] as string[],
    diagnosis_on_admission: '',
    chief_complaint: '',
    diet_type: 'Normal',
    allergies: '',
    comorbidities: '',
    insurance_details: '',
    relative_name: '',
    relative_contact: '',
    relative_relation: '',
  })

  // Load available beds and doctors
  useEffect(() => {
    supabase.from('beds').select('id, bed_number, ward, status')
      .eq('status', 'available').order('ward').order('bed_number')
      .then(({ data }) => setBeds(data || []))

    supabase.from('clinic_users').select('id, full_name, role')
      .eq('is_active', true).in('role', ['admin', 'doctor'])
      .order('full_name')
      .then(({ data }) => setDoctors(data || []))
  }, [])

  // Patient search
  const searchPatients = useCallback(async (q: string) => {
    if (q.length < 2) { setPatientResults([]); return }
    const { data } = await supabase
      .from('patients')
      .select('id, full_name, mrn, age, gender, mobile')
      .or(`full_name.ilike.%${q}%,mrn.ilike.%${q}%,mobile.ilike.%${q}%`)
      .limit(8)
    setPatientResults(data || [])
  }, [])

  function setField(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function toggleConsultingDoctor(name: string) {
    setForm(prev => {
      const existing = prev.consulting_doctors.includes(name)
      return {
        ...prev,
        consulting_doctors: existing
          ? prev.consulting_doctors.filter(d => d !== name)
          : [...prev.consulting_doctors, name],
      }
    })
  }

  async function handleSave() {
    if (!selectedPatient) { alert('Select a patient first'); return }
    if (!form.bed_id)    { alert('Select a bed'); return }
    if (!form.admitting_doctor) { alert('Select admitting doctor'); return }

    setSaving(true)

    // Create IPD admission record
    const payload = {
      patient_id:             selectedPatient.id,
      patient_name:           selectedPatient.full_name,
      mrn:                    selectedPatient.mrn,
      mobile:                 selectedPatient.mobile,
      age:                    selectedPatient.age,
      gender:                 selectedPatient.gender,
      bed_id:                 form.bed_id,
      bed_number:             beds.find(b => b.id === form.bed_id)?.bed_number || '',
      ward:                   beds.find(b => b.id === form.bed_id)?.ward || '',
      admission_date:         form.admission_date,
      admission_time:         form.admission_time,
      admitting_doctor:       form.admitting_doctor,
      consulting_doctors:     form.consulting_doctors,
      diagnosis_on_admission: form.diagnosis_on_admission,
      chief_complaint:        form.chief_complaint,
      diet_type:              form.diet_type,
      allergies:              form.allergies,
      comorbidities:          form.comorbidities,
      insurance_details:      form.insurance_details,
      relative_name:          form.relative_name,
      relative_contact:       form.relative_contact,
      relative_relation:      form.relative_relation,
      status:                 'active',
    }

    const { error } = await supabase.from('ipd_admissions').insert(payload)

    if (!error) {
      // Mark bed as occupied
      await supabase.from('beds').update({
        status:           'occupied',
        patient_id:       selectedPatient.id,
        patient_name:     selectedPatient.full_name,
        admission_date:   form.admission_date,
      }).eq('id', form.bed_id)

      setSaved(true)
      setTimeout(() => { setSaved(false); onSuccess() }, 1500)
    } else {
      alert('Error saving admission: ' + error.message)
    }
    setSaving(false)
  }

  const selectedBed = beds.find(b => b.id === form.bed_id)

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5"/>
        </button>
        <h2 className="text-lg font-bold text-gray-900">New IPD Admission</h2>
      </div>

      <div className="space-y-5">

        {/* Patient Search */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-500"/> Patient
          </h3>
          {selectedPatient ? (
            <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <div>
                <div className="font-bold text-blue-900">{selectedPatient.full_name}</div>
                <div className="text-xs text-blue-600">{selectedPatient.mrn} · {selectedPatient.age}y · {selectedPatient.gender} · {selectedPatient.mobile}</div>
              </div>
              <button onClick={() => { setSelectedPatient(null); setPatientResults([]) }}
                className="text-blue-400 hover:text-blue-600">
                <X className="w-4 h-4"/>
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
              <input className="input pl-9"
                placeholder="Search patient by name, MRN, or mobile…"
                value={patientQuery}
                onChange={e => { setPatientQuery(e.target.value); searchPatients(e.target.value) }}/>
              {patientResults.length > 0 && (
                <div className="absolute z-10 top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                  {patientResults.map(p => (
                    <button key={p.id}
                      className="w-full text-left px-4 py-2.5 hover:bg-blue-50 flex items-center gap-3 border-b border-gray-50 last:border-0"
                      onClick={() => { setSelectedPatient(p); setPatientResults([]); setPatientQuery('') }}>
                      <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center text-xs font-bold text-blue-700 flex-shrink-0">
                        {p.full_name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 text-sm">{p.full_name}</div>
                        <div className="text-xs text-gray-400">{p.mrn} · {p.age}y · {p.mobile}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bed + Dates */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <BedDouble className="w-4 h-4 text-purple-500"/> Bed Assignment
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Available Bed *</label>
              <select className="input" value={form.bed_id}
                onChange={e => setField('bed_id', e.target.value)}>
                <option value="">— Select bed —</option>
                {beds.map(b => (
                  <option key={b.id} value={b.id}>{b.bed_number} — {b.ward}</option>
                ))}
              </select>
              {selectedBed && (
                <p className="text-xs text-green-600 mt-1">✓ {selectedBed.ward}</p>
              )}
            </div>
            <div>
              <label className="label">Diet Type</label>
              <select className="input" value={form.diet_type}
                onChange={e => setField('diet_type', e.target.value)}>
                {['Normal', 'Soft', 'Liquid', 'NPO (Nothing by mouth)', 'Diabetic diet', 'Low salt', 'High protein'].map(d => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Admission Date *</label>
              <input className="input" type="date" value={form.admission_date}
                onChange={e => setField('admission_date', e.target.value)}/>
            </div>
            <div>
              <label className="label">Admission Time</label>
              <input className="input" type="time" value={form.admission_time}
                onChange={e => setField('admission_time', e.target.value)}/>
            </div>
          </div>
        </div>

        {/* Multi-Doctor Assignment */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-green-500"/> Doctors
            <span className="text-xs text-gray-400 font-normal">(multiple doctors supported)</span>
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="label">Admitting / Primary Doctor *</label>
              <select className="input" value={form.admitting_doctor}
                onChange={e => setField('admitting_doctor', e.target.value)}>
                <option value="">— Select doctor —</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.full_name}>{d.full_name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Consulting Doctors (tick to add)</label>
            <div className="flex flex-wrap gap-2">
              {doctors
                .filter(d => d.full_name !== form.admitting_doctor)
                .map(d => (
                  <button key={d.id}
                    type="button"
                    onClick={() => toggleConsultingDoctor(d.full_name)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      form.consulting_doctors.includes(d.full_name)
                        ? 'bg-green-100 border-green-300 text-green-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>
                    {form.consulting_doctors.includes(d.full_name) ? '✓ ' : '+ '}{d.full_name}
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* Clinical Details */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-orange-500"/> Clinical Details
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Chief Complaint</label>
              <input className="input" placeholder="e.g. Abdominal pain, fever since 2 days"
                value={form.chief_complaint} onChange={e => setField('chief_complaint', e.target.value)}/>
            </div>
            <div className="col-span-2">
              <label className="label">Diagnosis on Admission</label>
              <input className="input" placeholder="Primary diagnosis"
                value={form.diagnosis_on_admission} onChange={e => setField('diagnosis_on_admission', e.target.value)}/>
            </div>
            <div>
              <label className="label">Allergies</label>
              <input className="input" placeholder="Drug / food allergies or NKDA"
                value={form.allergies} onChange={e => setField('allergies', e.target.value)}/>
            </div>
            <div>
              <label className="label">Co-morbidities</label>
              <input className="input" placeholder="DM, HTN, Thyroid, etc."
                value={form.comorbidities} onChange={e => setField('comorbidities', e.target.value)}/>
            </div>
            <div>
              <label className="label">Insurance / TPA</label>
              <input className="input" placeholder="Insurance company, policy no."
                value={form.insurance_details} onChange={e => setField('insurance_details', e.target.value)}/>
            </div>
          </div>
        </div>

        {/* Relative / Attendant */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-3">Attendant / Relative</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Name</label>
              <input className="input" placeholder="Attendant name"
                value={form.relative_name} onChange={e => setField('relative_name', e.target.value)}/>
            </div>
            <div>
              <label className="label">Contact</label>
              <input className="input" type="tel" placeholder="Mobile number"
                value={form.relative_contact} onChange={e => setField('relative_contact', e.target.value)}/>
            </div>
            <div>
              <label className="label">Relation</label>
              <select className="input" value={form.relative_relation}
                onChange={e => setField('relative_relation', e.target.value)}>
                <option value="">— Select —</option>
                {['Husband', 'Wife', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'].map(r => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving || saved}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold transition-colors disabled:opacity-60
              ${saved ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
              : saved ? <CheckCircle className="w-4 h-4"/>
              : <Save className="w-4 h-4"/>}
            {saving ? 'Admitting…' : saved ? 'Admitted!' : 'Admit Patient'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Nursing Chart ──────────────────────────────────────────────

function NursingChart({ admission, onBack, currentUserName }: {
  admission: IPDAdmission
  onBack: () => void
  currentUserName: string
}) {
  const [entries, setEntries] = useState<NursingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [addType, setAddType] = useState<NursingEntry['entry_type']>('vital')
  const [saving, setSaving] = useState(false)
  const [openSection, setOpenSection] = useState<string>('vitals')

  // Vital form
  const [vitalForm, setVitalForm] = useState({
    recorded_time: new Date().toTimeString().slice(0, 5),
    pulse: '', bp_systolic: '', bp_diastolic: '',
    temperature: '', spo2: '', rr: '', weight: '', vital_note: '',
  })

  // I/O form
  const [ioForm, setIoForm] = useState({
    recorded_time: new Date().toTimeString().slice(0, 5),
    io_type: 'Input' as 'Input' | 'Output',
    io_label: '',
    io_amount_ml: '',
  })

  // Note / medication form
  const [noteForm, setNoteForm] = useState({
    recorded_time: new Date().toTimeString().slice(0, 5),
    entry_type: 'note' as NursingEntry['entry_type'],
    note_text: '',
    medication_name: '', medication_dose: '', medication_route: 'IV',
    medication_given_by: currentUserName,
  })

  useEffect(() => { loadEntries() }, [admission.id])

  async function loadEntries() {
    setLoading(true)
    const { data } = await supabase
      .from('ipd_nursing')
      .select('*')
      .eq('ipd_admission_id', admission.id)
      .order('created_at', { ascending: false })
    setEntries((data || []) as NursingEntry[])
    setLoading(false)
  }

  async function saveVital() {
    setSaving(true)
    const { error } = await supabase.from('ipd_nursing').insert({
      ipd_admission_id: admission.id,
      patient_id:       admission.patient_id,
      entry_type:       'vital',
      nurse_name:       currentUserName,
      ...vitalForm,
      recorded_time:    vitalForm.recorded_time,
    })
    if (!error) {
      setVitalForm({ recorded_time: new Date().toTimeString().slice(0, 5), pulse: '', bp_systolic: '', bp_diastolic: '', temperature: '', spo2: '', rr: '', weight: '', vital_note: '' })
      await loadEntries()
    }
    setSaving(false)
  }

  async function saveIO() {
    setSaving(true)
    await supabase.from('ipd_nursing').insert({
      ipd_admission_id: admission.id,
      patient_id:       admission.patient_id,
      entry_type:       'io',
      nurse_name:       currentUserName,
      recorded_time:    ioForm.recorded_time,
      io_type:          ioForm.io_type,
      io_label:         ioForm.io_label,
      io_amount_ml:     parseFloat(ioForm.io_amount_ml) || 0,
    })
    setIoForm({ recorded_time: new Date().toTimeString().slice(0, 5), io_type: 'Input', io_label: '', io_amount_ml: '' })
    await loadEntries()
    setSaving(false)
  }

  async function saveNote() {
    setSaving(true)
    const payload: any = {
      ipd_admission_id:    admission.id,
      patient_id:          admission.patient_id,
      entry_type:          noteForm.entry_type,
      nurse_name:          currentUserName,
      recorded_time:       noteForm.recorded_time,
      note_text:           noteForm.note_text,
    }
    if (noteForm.entry_type === 'medication') {
      payload.medication_name     = noteForm.medication_name
      payload.medication_dose     = noteForm.medication_dose
      payload.medication_route    = noteForm.medication_route
      payload.medication_given_by = noteForm.medication_given_by
    }
    await supabase.from('ipd_nursing').insert(payload)
    setNoteForm({ recorded_time: new Date().toTimeString().slice(0, 5), entry_type: 'note', note_text: '', medication_name: '', medication_dose: '', medication_route: 'IV', medication_given_by: currentUserName })
    await loadEntries()
    setSaving(false)
  }

  // I/O balance
  const totalInput  = entries.filter(e => e.entry_type === 'io' && e.io_type === 'Input').reduce((s, e) => s + (e.io_amount_ml || 0), 0)
  const totalOutput = entries.filter(e => e.entry_type === 'io' && e.io_type === 'Output').reduce((s, e) => s + (e.io_amount_ml || 0), 0)
  const ioBalance   = totalInput - totalOutput

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5"/>
        </button>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Nursing Chart — {admission.patient_name}</h2>
          <p className="text-xs text-gray-500">
            {admission.bed_number} · {admission.ward} · Admitted {formatDate(admission.admission_date)}
            {' '} · Dr. {admission.admitting_doctor}
            {admission.consulting_doctors?.length > 0 && ` + ${admission.consulting_doctors.join(', ')}`}
          </p>
        </div>
      </div>

      {/* I/O Summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Total Input', value: `${totalInput} mL`, cls: 'text-blue-700 bg-blue-50' },
          { label: 'Total Output', value: `${totalOutput} mL`, cls: 'text-orange-700 bg-orange-50' },
          { label: 'Net Balance', value: `${ioBalance > 0 ? '+' : ''}${ioBalance} mL`, cls: ioBalance >= 0 ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50' },
        ].map(({ label, value, cls }) => (
          <div key={label} className={`card p-3 ${cls.split(' ')[1]}`}>
            <div className={`text-xl font-bold ${cls.split(' ')[0]}`}>{value}</div>
            <div className="text-xs font-medium text-gray-600">{label}</div>
          </div>
        ))}
      </div>

      {/* Entry Form Tabs */}
      <div className="card p-5 mb-5">
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
          {(['vital', 'io', 'note', 'medication'] as const).map(t => (
            <button key={t}
              onClick={() => setAddType(t)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors capitalize ${addType === t ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
              {t === 'vital' ? '🩺 Vital Signs' : t === 'io' ? '💧 I/O' : t === 'note' ? '📝 Note' : '💊 Medication'}
            </button>
          ))}
        </div>

        {/* Vital Signs form */}
        {addType === 'vital' && (
          <div>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div><label className="label">Time</label><input className="input" type="time" value={vitalForm.recorded_time} onChange={e => setVitalForm(p => ({ ...p, recorded_time: e.target.value }))}/></div>
              <div><label className="label">Pulse (bpm)</label><input className="input" type="number" placeholder="72" value={vitalForm.pulse} onChange={e => setVitalForm(p => ({ ...p, pulse: e.target.value }))}/></div>
              <div><label className="label">BP Systolic</label><input className="input" type="number" placeholder="120" value={vitalForm.bp_systolic} onChange={e => setVitalForm(p => ({ ...p, bp_systolic: e.target.value }))}/></div>
              <div><label className="label">BP Diastolic</label><input className="input" type="number" placeholder="80" value={vitalForm.bp_diastolic} onChange={e => setVitalForm(p => ({ ...p, bp_diastolic: e.target.value }))}/></div>
              <div><label className="label">Temperature (°F)</label><input className="input" type="number" step="0.1" placeholder="98.6" value={vitalForm.temperature} onChange={e => setVitalForm(p => ({ ...p, temperature: e.target.value }))}/></div>
              <div><label className="label">SpO₂ (%)</label><input className="input" type="number" placeholder="98" value={vitalForm.spo2} onChange={e => setVitalForm(p => ({ ...p, spo2: e.target.value }))}/></div>
              <div><label className="label">RR (breaths/min)</label><input className="input" type="number" placeholder="16" value={vitalForm.rr} onChange={e => setVitalForm(p => ({ ...p, rr: e.target.value }))}/></div>
              <div><label className="label">Weight (kg)</label><input className="input" type="number" step="0.1" placeholder="55.0" value={vitalForm.weight} onChange={e => setVitalForm(p => ({ ...p, weight: e.target.value }))}/></div>
            </div>
            <div className="mb-3">
              <label className="label">Nurse Note (optional)</label>
              <textarea className="input" rows={2} placeholder="Any observation…" value={vitalForm.vital_note} onChange={e => setVitalForm(p => ({ ...p, vital_note: e.target.value }))}/>
            </div>
            <button onClick={saveVital} disabled={saving}
              className="btn-primary flex items-center gap-2 text-xs disabled:opacity-60">
              <Save className="w-3.5 h-3.5"/>{saving ? 'Saving…' : 'Save Vitals'}
            </button>
          </div>
        )}

        {/* I/O form */}
        {addType === 'io' && (
          <div className="grid grid-cols-4 gap-3 items-end">
            <div><label className="label">Time</label><input className="input" type="time" value={ioForm.recorded_time} onChange={e => setIoForm(p => ({ ...p, recorded_time: e.target.value }))}/></div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={ioForm.io_type} onChange={e => setIoForm(p => ({ ...p, io_type: e.target.value as 'Input' | 'Output' }))}>
                <option>Input</option><option>Output</option>
              </select>
            </div>
            <div>
              <label className="label">Label</label>
              <select className="input" value={ioForm.io_label} onChange={e => setIoForm(p => ({ ...p, io_label: e.target.value }))}>
                <option value="">— Select —</option>
                {ioForm.io_type === 'Input'
                  ? ['IV Fluids', 'Oral fluids', 'Blood transfusion', 'NG feeds', 'Medications'].map(l => <option key={l}>{l}</option>)
                  : ['Urine', 'Drain', 'Vomiting', 'NG aspirate', 'Stool', 'Blood loss'].map(l => <option key={l}>{l}</option>)
                }
              </select>
            </div>
            <div><label className="label">Amount (mL)</label><input className="input" type="number" placeholder="500" value={ioForm.io_amount_ml} onChange={e => setIoForm(p => ({ ...p, io_amount_ml: e.target.value }))}/></div>
            <button onClick={saveIO} disabled={saving}
              className="btn-primary flex items-center gap-2 text-xs col-span-4 w-fit disabled:opacity-60">
              <Save className="w-3.5 h-3.5"/>{saving ? 'Saving…' : 'Save I/O Entry'}
            </button>
          </div>
        )}

        {/* Note / Medication */}
        {(addType === 'note' || addType === 'medication') && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Time</label><input className="input" type="time" value={noteForm.recorded_time} onChange={e => setNoteForm(p => ({ ...p, recorded_time: e.target.value }))}/></div>
              <div>
                <label className="label">Entry Type</label>
                <select className="input" value={noteForm.entry_type} onChange={e => setNoteForm(p => ({ ...p, entry_type: e.target.value as any }))}>
                  <option value="note">Nursing Note</option>
                  <option value="medication">Medication Given</option>
                </select>
              </div>
            </div>
            {noteForm.entry_type === 'medication' && (
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">Drug Name</label><input className="input" placeholder="e.g. Metronidazole" value={noteForm.medication_name} onChange={e => setNoteForm(p => ({ ...p, medication_name: e.target.value }))}/></div>
                <div><label className="label">Dose</label><input className="input" placeholder="500mg" value={noteForm.medication_dose} onChange={e => setNoteForm(p => ({ ...p, medication_dose: e.target.value }))}/></div>
                <div><label className="label">Route</label>
                  <select className="input" value={noteForm.medication_route} onChange={e => setNoteForm(p => ({ ...p, medication_route: e.target.value }))}>
                    {['IV', 'IM', 'SC', 'Oral', 'Rectal', 'Topical', 'Inhalation'].map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div>
              <label className="label">{noteForm.entry_type === 'medication' ? 'Administration Note' : 'Note'}</label>
              <textarea className="input" rows={3} placeholder={noteForm.entry_type === 'medication' ? 'Any adverse reaction, site, timing notes…' : 'Nursing observation, patient complaint, action taken…'}
                value={noteForm.note_text} onChange={e => setNoteForm(p => ({ ...p, note_text: e.target.value }))}/>
            </div>
            <button onClick={saveNote} disabled={saving}
              className="btn-primary flex items-center gap-2 text-xs disabled:opacity-60">
              <Save className="w-3.5 h-3.5"/>{saving ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
        )}
      </div>

      {/* Chart History */}
      {loading ? (
        <div className="flex items-center justify-center h-24">
          <div className="w-6 h-6 border-4 border-purple-400 border-t-transparent rounded-full animate-spin"/>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Chart History ({entries.length} entries)</h3>
          </div>
          {entries.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">No entries yet</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b">
                  {['Time', 'Type', 'Details', 'Recorded by'].map(h => (
                    <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-gray-500">
                      {e.recorded_time}
                      <div className="text-gray-300">{new Date(e.created_at).toLocaleDateString('en-IN')}</div>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize
                        ${e.entry_type === 'vital' ? 'bg-blue-50 text-blue-700'
                          : e.entry_type === 'io' ? 'bg-cyan-50 text-cyan-700'
                          : e.entry_type === 'medication' ? 'bg-purple-50 text-purple-700'
                          : 'bg-gray-100 text-gray-600'}`}>
                        {e.entry_type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      {e.entry_type === 'vital' && (
                        <span>
                          {e.pulse && `P: ${e.pulse}bpm`}
                          {e.bp_systolic && ` BP: ${e.bp_systolic}/${e.bp_diastolic}`}
                          {e.temperature && ` T: ${e.temperature}°F`}
                          {e.spo2 && ` SpO₂: ${e.spo2}%`}
                          {e.rr && ` RR: ${e.rr}`}
                          {e.weight && ` Wt: ${e.weight}kg`}
                          {e.vital_note && <span className="text-gray-400"> — {e.vital_note}</span>}
                        </span>
                      )}
                      {e.entry_type === 'io' && (
                        <span className={e.io_type === 'Input' ? 'text-blue-700' : 'text-orange-700'}>
                          {e.io_type}: {e.io_label} — {e.io_amount_ml} mL
                        </span>
                      )}
                      {e.entry_type === 'medication' && (
                        <span>{e.medication_name} {e.medication_dose} {e.medication_route}{e.note_text && ` — ${e.note_text}`}</span>
                      )}
                      {e.entry_type === 'note' && <span>{e.note_text}</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{e.nurse_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}