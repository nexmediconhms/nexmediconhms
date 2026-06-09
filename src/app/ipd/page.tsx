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

import { Suspense, useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { escapeLike, formatDate, formatDateTime, getHospitalSettings, getIndiaToday } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { checkIPDDoubleAdmit } from '@/lib/booking-guards'
import {
  BedDouble, UserPlus, Search, RefreshCw, Stethoscope,
  AlertTriangle, Activity, ClipboardList, LogOut, Clock,
  Plus, Trash2, Save, CheckCircle, ChevronDown, ChevronUp,
  IndianRupee, FileText, Users, X
} from 'lucide-react'
import DischargeModal from '@/components/ipd/DischargeModal'
import IPDFileUpload from '@/components/ipd/IPDFileUpload'

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
  if (s === 'active') return <span className="badge-green text-xs">Active</span>
  if (s === 'discharged') return <span className="badge-red text-xs">Discharged</span>
  return <span className="badge-yellow text-xs">Transferred</span>
}

function daysSince(dateStr: string) {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  return Math.max(0, days) // Never show negative days
}

// ── Main Component ─────────────────────────────────────────────

export default function IPDPageWrapper() {
  return (
    <Suspense fallback={<AppShell><div className="p-6 flex items-center justify-center h-40"><div className="w-6 h-6 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" /></div></AppShell>}>
      <IPDPageContent />
    </Suspense>
  )
}

function IPDPageContent() {
  const { user, can } = useAuth()
  const searchParams = useSearchParams()
  const [admissions, setAdmissions] = useState<IPDAdmission[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'census' | 'admit' | 'chart'>('census')
  const [selectedAdmission, setSelectedAdmission] = useState<IPDAdmission | null>(null)

  // Auto-switch to admit view when arriving with patientId in URL
  const urlPatientId = searchParams.get('patientId')
  useEffect(() => {
    if (urlPatientId) {
      setView('admit')
    }
  }, [urlPatientId])

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
              <BedDouble className="w-6 h-6 text-purple-500" /> IPD Management
            </h1>
            <p className="text-sm text-gray-500">
              In-patient admissions, nursing charts, multi-doctor care
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={loadAdmissions} disabled={loading}
              className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-60">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            {can('encounters.create') && (
              <button onClick={() => setView('admit')}
                className="btn-primary flex items-center gap-2 text-xs">
                <UserPlus className="w-3.5 h-3.5" /> Admit Patient
              </button>
            )}
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit">
          {[
            { key: 'census', label: 'IPD Census', icon: Users },
            { key: 'admit', label: 'New Admission', icon: UserPlus },
          ].map(({ key, label, icon: Icon }) => (
            <button key={key}
              onClick={() => setView(key as any)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${view === key ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon className="w-3.5 h-3.5" /> {label}
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
            prefillPatientId={urlPatientId || undefined}
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
  const [dischargeAdmission, setDischargeAdmission] = useState<IPDAdmission | null>(null)

  async function markDischarged(id: string) {
    // Navigate to full discharge workflow page
    window.location.href = `/ipd/discharge/${id}`
  }

  return (
    <>
      <div className="card p-4 mb-5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input pl-9 bg-gray-50"
            placeholder="Search patient name, MRN, bed number, ward…"
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-purple-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : admissions.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <BedDouble className="w-12 h-12 mx-auto mb-3 opacity-20" />
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
                        {/*
                          ── Chart button — UNIFICATION FIX (June 2026) ─────────────────
                          BACKGROUND
                            The application historically had TWO different "chart"
                            views for an IPD admission:
                              A. The inline NursingChart panel rendered inside this
                                 file (the legacy view, opened via onOpenChart()).
                              B. The full /ipd/[bedId] route — the modern page used
                                 by Bed Management's "Nursing Chart" link, which has
                                 Vitals / I/O / Nursing Notes / Doctor Notes /
                                 Files & Photos tabs PLUS the IPD Bill button.
                            Page B is a strict superset of A and is what every other
                            entry point in the app links to.  Having two pages for
                            the same workflow caused user confusion and made deep
                            links / browser-back behave inconsistently.

                          DECISION (lead-developer view)
                            Make /ipd/[bedId] the single source of truth.  Route
                            "Chart" through a <Link> so we get:
                              - shared destination with Bed Management
                              - browser history + cmd/ctrl-click for new tab
                              - deep-linkable URL for notifications + audit trail

                          SAFETY FALLBACK
                            Some legacy admission rows can have bed_id = null
                            (e.g. transferred admissions in older schemas).  For
                            those rows /ipd/null would 404, so we fall back to
                            the inline panel via the original onOpenChart() prop.
                            Prop signature, the legacy NursingChart component, and
                            the openChart() handler are ALL preserved untouched —
                            no caller / test that relies on them is broken.
                        */}
                        {adm.bed_id ? (
                          <Link
                            href={`/ipd/${adm.bed_id}`}
                            className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                            title="Open the full IPD chart (Vitals, I/O, Notes, Doctor Notes, Files, Bill)"
                          >
                            <Activity className="w-3 h-3" /> Chart
                          </Link>
                        ) : (
                          <button
                            onClick={() => onOpenChart(adm)}
                            className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                            title="This admission has no bed_id — opening the legacy chart panel"
                          >
                            <Activity className="w-3 h-3" /> Chart
                          </button>
                        )}
                        {canManage && (
                          <button onClick={() => markDischarged(adm.id)}
                            className="text-xs py-1 px-2 rounded border border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1">
                            <LogOut className="w-3 h-3" /> DC
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

      {/* Enhanced Discharge Modal */}
      {dischargeAdmission && (
        <DischargeModal
          admission={dischargeAdmission}
          onClose={() => setDischargeAdmission(null)}
          onDischarged={() => { setDischargeAdmission(null); onDischarge() }}
        />
      )}
    </>
  )
}

// ── Admit Form ─────────────────────────────────────────────────

function AdmitForm({ onSuccess, onCancel, prefillPatientId }: { onSuccess: () => void; onCancel: () => void; prefillPatientId?: string }) {
  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState<any[]>([])
  const [selectedPatient, setSelectedPatient] = useState<any>(null)
  const [beds, setBeds] = useState<any[]>([])
  const [doctors, setDoctors] = useState<any[]>([])  // all doctors in clinic
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [form, setForm] = useState({
    bed_id: '',
    admission_date: getIndiaToday(),
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

    // Load clinic_users + augment with hospital settings default doctor.
    // (Previously the dropdown only showed clinic_users rows, so on a
    // fresh install — or any install where the configured Default Doctor
    // is NOT also a clinic_users login account — the doctor would be
    // missing from this dropdown and only the admin login would appear.
    // We now read the Default Doctor Details from hospital settings and
    // inject it as a synthetic option if it isn't already present.)
    supabase.from('clinic_users').select('id, full_name, role, med_reg_no')
      .eq('is_active', true).in('role', ['admin', 'doctor'])
      .order('full_name')
      .then(({ data }) => {
        const clinicians = (data || []).filter((d: any) =>
          d.role === 'doctor' ||
          (d.role === 'admin' && String(d.med_reg_no || '').trim() !== '')
        )

        // v7 FIX: merge in hospital-settings default doctor as a synthetic
        // entry. The form stores admitting_doctor/consulting_doctors as
        // plain strings (full_name), so a synthetic id is fine — no FK.
        try {
          const hs: any = typeof window !== 'undefined' ? getHospitalSettings() : {}
          const settingsDoctorName = String(hs?.doctorName || '').trim()
          if (settingsDoctorName) {
            const alreadyListed = clinicians.some((c: any) =>
              String(c.full_name || '').trim().toLowerCase() ===
              settingsDoctorName.toLowerCase()
            )
            if (!alreadyListed) {
              clinicians.unshift({
                id: 'hospital-settings-default-doctor',
                full_name: settingsDoctorName,
                role: 'doctor',
                med_reg_no: String(hs?.doctorRegNo || hs?.doctorRegistration || ''),
              })
            }
          }
        } catch (e) {
          console.warn('[IPD] Could not read hospital-settings default doctor:', e)
        }

        setDoctors(clinicians)
      })
  }, [])

  // Pre-fill patient when arriving from Patients page with patientId in URL
  useEffect(() => {
    if (!prefillPatientId) return
    async function loadPatient() {
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, mrn, age, gender, mobile')
        .eq('id', prefillPatientId)
        .single()
      if (data) {
        setSelectedPatient(data)
      }
    }
    loadPatient()
  }, [prefillPatientId])

  // Patient search
  const searchPatients = useCallback(async (q: string) => {
    if (q.length < 2) { setPatientResults([]); return }
    const safe = escapeLike(q)
    const { data } = await supabase
      .from('patients')
      .select('id, full_name, mrn, age, gender, mobile')
      .or(`full_name.ilike.%${safe}%,mrn.ilike.%${safe}%,mobile.ilike.%${safe}%`)
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
    if (!form.bed_id) { alert('Select a bed'); return }
    if (!form.admitting_doctor) { alert('Select admitting doctor'); return }

    setSaving(true)

    // Create IPD admission record
    const payload = {
      patient_id: selectedPatient.id,
      patient_name: selectedPatient.full_name,
      mrn: selectedPatient.mrn,
      mobile: selectedPatient.mobile,
      age: selectedPatient.age,
      gender: selectedPatient.gender,
      bed_id: form.bed_id,
      bed_number: beds.find(b => b.id === form.bed_id)?.bed_number || '',
      ward: beds.find(b => b.id === form.bed_id)?.ward || '',
      admission_date: form.admission_date,
      admission_time: form.admission_time,
      admitting_doctor: form.admitting_doctor,
      consulting_doctors: form.consulting_doctors,
      diagnosis_on_admission: form.diagnosis_on_admission,
      chief_complaint: form.chief_complaint,
      diet_type: form.diet_type,
      allergies: form.allergies,
      comorbidities: form.comorbidities,
      insurance_details: form.insurance_details,
      relative_name: form.relative_name,
      relative_contact: form.relative_contact,
      relative_relation: form.relative_relation,
      status: 'active',
    }
    // ── Phase 1 additive guard: patient already admitted or bed occupied? ──
    const ipdGuard = await checkIPDDoubleAdmit({
      patientId: payload.patient_id,
      bedId: payload.bed_id ?? null,
    })
    if (!ipdGuard.ok) {
      setSaving(false)
      alert(ipdGuard.reason)
      return
    }

    // ── IPD-1 + IPD-5 fix: transactional bed flip with future-date awareness ──
    //
    // PRE-FIX BEHAVIOUR (two bugs):
    //   1. INSERT into ipd_admissions, then UPDATE beds.status='occupied'.
    //      If the bed update failed (network blip, RLS), we ended up with a
    //      "ghost" active admission and a still-available bed. The next
    //      reception staff using the bed could admit a second patient and
    //      the DB unique constraint uniq_ipd_bed_active would catch it
    //      with an opaque error — by which time the UI is already broken.
    //
    //   2. Bed status flipped to 'occupied' immediately even when the
    //      admission_date was in the FUTURE. A bed pre-booked for an
    //      elective C-section on June 6 was unusable on June 4 / 5 even
    //      though the patient hadn't arrived yet — physical bed sat empty
    //      while the system claimed it was occupied.
    //
    // NEW BEHAVIOUR:
    //   a. We FIRST update the bed using a compare-and-set guard:
    //        UPDATE beds SET <new state> WHERE id = X AND status = 'available'
    //      If 0 rows match, another reception just claimed this bed — abort
    //      with a clean error rather than half-creating an admission.
    //   b. If the admission_date is TODAY or in the past, the bed flips to
    //      'occupied' as before.
    //   c. If the admission_date is in the FUTURE, the bed instead flips to
    //      'reserved' (an existing status the schema already supports) with
    //      reservedfor=patient name and reservednote noting the upcoming
    //      admit date. The bed remains physically available for emergency
    //      use today; on/after the admit date staff can flip it to
    //      'occupied' from the IPD chart, or the patient simply arrives.
    //   d. Only AFTER the bed is successfully claimed do we INSERT the
    //      admission row. If the admission insert fails we revert the bed
    //      back to 'available' (best-effort; the unique constraint at the
    //      DB level remains the ultimate guard).
    const todayStr = getIndiaToday()
    const isFutureAdmission = form.admission_date > todayStr
    const targetBed = beds.find(b => b.id === form.bed_id)
    const newBedState: Record<string, unknown> = isFutureAdmission
      ? {
          status: 'reserved',
          reservedfor: selectedPatient.full_name,
          reservednote:
            `IPD admission scheduled for ${form.admission_date}` +
            (form.admitting_doctor ? ` — Dr. ${form.admitting_doctor}` : ''),
          reservedat: new Date().toISOString(),
          // For future admissions we DON'T set patient_id / admission_date on
          // the bed yet — those are written when the patient actually arrives
          // and the bed is flipped to 'occupied'. This keeps the bed
          // physically available for emergency walk-ins today.
          updated_at: new Date().toISOString(),
        }
      : {
          status: 'occupied',
          patient_id: selectedPatient.id,
          patient_name: selectedPatient.full_name,
          admission_date: form.admission_date,
          updated_at: new Date().toISOString(),
        }

    // Compare-and-set bed update — only succeeds if bed is still 'available'.
    // Returns the affected rows so we can detect the "lost the race" case.
    const { data: claimedBeds, error: bedClaimErr } = await supabase
      .from('beds')
      .update(newBedState)
      .eq('id', form.bed_id)
      .eq('status', 'available')
      .select('id')

    if (bedClaimErr) {
      setSaving(false)
      alert('Error claiming bed: ' + bedClaimErr.message)
      return
    }
    if (!claimedBeds || claimedBeds.length === 0) {
      // Either the bed status changed between when we loaded the list and
      // when we tried to claim it, OR our schema doesn't support `status`
      // filtering on update for some reason. Refuse to proceed.
      setSaving(false)
      alert(
        'This bed is no longer available — it may have been just claimed by ' +
        'another user or its status changed. Please refresh and choose ' +
        'another bed.',
      )
      return
    }

    // Bed is now ours. Insert the admission record.
    const { error } = await supabase.from('ipd_admissions').insert(payload)

    if (!error) {
      // Send notification for IPD admission
      try {
        const { default: notify } = await import('@/lib/notifications')
        await notify.ipdAdmission(
          selectedPatient.id,
          selectedPatient.full_name,
          targetBed?.bed_number || '',
          targetBed?.ward || ''
        )
      } catch { /* non-fatal */ }

      setSaved(true)
      setTimeout(() => { setSaved(false); onSuccess() }, 1500)
    } else {
      // ── IPD-5: revert the bed claim so we don't leak a held bed ──
      // Best-effort revert. We set status back to 'available' and clear the
      // fields we just wrote. If THIS update fails too (very unlikely) the
      // bed will appear claimed by a non-existent admission until staff
      // manually fixes it from /ipd/beds — at least the audit trail is clear.
      try {
        await supabase.from('beds').update({
          status: 'available',
          patient_id: null,
          patient_name: null,
          admission_date: null,
          reservedfor: null,
          reservednote: null,
          reservedat: null,
          updated_at: new Date().toISOString(),
        }).eq('id', form.bed_id)
      } catch (revertErr) {
        console.error(
          '[IPD admit] Could not revert bed state after admission insert ' +
          'failure. Bed may be in an inconsistent state — please fix from ' +
          '/ipd/beds. Original admission error:', error,
          'Revert error:', revertErr,
        )
      }
      alert('Error saving admission: ' + error.message)
    }
    setSaving(false)
  }

  const selectedBed = beds.find(b => b.id === form.bed_id)

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-bold text-gray-900">New IPD Admission</h2>
      </div>

      <div className="space-y-5">

        {/* Patient Search */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-500" /> Patient
          </h3>
          {selectedPatient ? (
            <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <div>
                <div className="font-bold text-blue-900">{selectedPatient.full_name}</div>
                <div className="text-xs text-blue-600">{selectedPatient.mrn} · {selectedPatient.age}y · {selectedPatient.gender} · {selectedPatient.mobile}</div>
              </div>
              <button onClick={() => { setSelectedPatient(null); setPatientResults([]) }}
                className="text-blue-400 hover:text-blue-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-9"
                placeholder="Search patient by name, MRN, or mobile…"
                value={patientQuery}
                onChange={e => { setPatientQuery(e.target.value); searchPatients(e.target.value) }} />
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
            <BedDouble className="w-4 h-4 text-purple-500" /> Bed Assignment
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
                onChange={e => setField('admission_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Admission Time</label>
              <input className="input" type="time" value={form.admission_time}
                onChange={e => setField('admission_time', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Multi-Doctor Assignment */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-green-500" /> Doctors
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
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${form.consulting_doctors.includes(d.full_name)
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
            <ClipboardList className="w-4 h-4 text-orange-500" /> Clinical Details
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Chief Complaint</label>
              <input className="input" placeholder="e.g. Abdominal pain, fever since 2 days"
                value={form.chief_complaint} onChange={e => setField('chief_complaint', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">Diagnosis on Admission</label>
              <input className="input" placeholder="Primary diagnosis"
                value={form.diagnosis_on_admission} onChange={e => setField('diagnosis_on_admission', e.target.value)} />
            </div>
            <div>
              <label className="label">Allergies</label>
              <input className="input" placeholder="Drug / food allergies or NKDA"
                value={form.allergies} onChange={e => setField('allergies', e.target.value)} />
            </div>
            <div>
              <label className="label">Co-morbidities</label>
              <input className="input" placeholder="DM, HTN, Thyroid, etc."
                value={form.comorbidities} onChange={e => setField('comorbidities', e.target.value)} />
            </div>
            <div>
              <label className="label">Insurance / TPA</label>
              <input className="input" placeholder="Insurance company, policy no."
                value={form.insurance_details} onChange={e => setField('insurance_details', e.target.value)} />
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
                value={form.relative_name} onChange={e => setField('relative_name', e.target.value)} />
            </div>
            <div>
              <label className="label">Contact</label>
              <input className="input" type="tel" placeholder="Mobile number"
                value={form.relative_contact} onChange={e => setField('relative_contact', e.target.value)} />
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
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : saved ? <CheckCircle className="w-4 h-4" />
                : <Save className="w-4 h-4" />}
            {saving ? 'Admitting…' : saved ? 'Admitted!' : 'Admit Patient'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Nursing Chart ──────────────────────────────────────────────
//
// @deprecated  As of June 2026 the IPD Census "Chart" button routes
// directly to /ipd/[bedId] (the full clinical chart with Doctor Notes,
// Files & Photos, OCR autofill, and the IPD Bill button).  This inline
// component is retained ONLY as a fallback for the rare admission row
// that has bed_id = null (e.g. transferred admissions in legacy
// schemas) — those would otherwise 404 at /ipd/null.  Do NOT add new
// features here; extend src/app/ipd/[bedId]/page.tsx instead.  This
// component is scheduled for removal once the legacy schema cases are
// fully migrated and we have one quarter of usage telemetry showing
// nobody hits this path.
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

  // Self-healing: ensure ipd_nursing schema exists
  async function ensureNursingSchema() {
    try {
      await fetch('/api/ensure-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: ['ipd_nursing'] }),
      })
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    // Proactively ensure schema before first load
    ensureNursingSchema().then(() => loadEntries())
  }, [admission.id])

  async function loadEntries() {
    setLoading(true)
    const { data, error } = await supabase
      .from('ipd_nursing')
      .select('*')
      .eq('ipd_admission_id', admission.id)
      .order('created_at', { ascending: false })
    if (error && (error.message?.includes('schema cache') || error.message?.includes('column') || error.code === '42P01')) {
      // Self-heal and retry
      await ensureNursingSchema()
      const retry = await supabase.from('ipd_nursing').select('*').eq('ipd_admission_id', admission.id).order('created_at', { ascending: false })
      setEntries((retry.data || []) as NursingEntry[])
    } else {
      setEntries((data || []) as NursingEntry[])
    }
    setLoading(false)
  }

  async function saveVital() {
    setSaving(true)
    const vitalPayload = {
      ipd_admission_id: admission.id,
      patient_id: admission.patient_id,
      entry_type: 'vital',
      nurse_name: currentUserName,
      ...vitalForm,
      recorded_time: vitalForm.recorded_time,
    }
    let { error } = await supabase.from('ipd_nursing').insert(vitalPayload)
    if (error && (error.message?.includes('schema cache') || error.message?.includes('column'))) {
      await ensureNursingSchema()
      const retry = await supabase.from('ipd_nursing').insert(vitalPayload)
      error = retry.error
    }
    if (!error) {
      setVitalForm({ recorded_time: new Date().toTimeString().slice(0, 5), pulse: '', bp_systolic: '', bp_diastolic: '', temperature: '', spo2: '', rr: '', weight: '', vital_note: '' })
      await loadEntries()
    }
    setSaving(false)
  }

  async function saveIO() {
    setSaving(true)
    const ioPayload = {
      ipd_admission_id: admission.id,
      patient_id: admission.patient_id,
      entry_type: 'io',
      nurse_name: currentUserName,
      recorded_time: ioForm.recorded_time,
      io_type: ioForm.io_type,
      io_label: ioForm.io_label,
      io_amount_ml: parseFloat(ioForm.io_amount_ml) || 0,
    }
    let { error } = await supabase.from('ipd_nursing').insert(ioPayload)
    if (error && (error.message?.includes('schema cache') || error.message?.includes('column'))) {
      await ensureNursingSchema()
      const retry = await supabase.from('ipd_nursing').insert(ioPayload)
      error = retry.error
    }
    if (!error) {
      setIoForm({ recorded_time: new Date().toTimeString().slice(0, 5), io_type: 'Input', io_label: '', io_amount_ml: '' })
      await loadEntries()
    }
    setSaving(false)
  }

  async function saveNote() {
    setSaving(true)
    const payload: any = {
      ipd_admission_id: admission.id,
      patient_id: admission.patient_id,
      entry_type: noteForm.entry_type,
      nurse_name: currentUserName,
      recorded_time: noteForm.recorded_time,
      note_text: noteForm.note_text,
    }
    if (noteForm.entry_type === 'medication') {
      payload.medication_name = noteForm.medication_name
      payload.medication_dose = noteForm.medication_dose
      payload.medication_route = noteForm.medication_route
      payload.medication_given_by = noteForm.medication_given_by
    }
    let { error } = await supabase.from('ipd_nursing').insert(payload)
    if (error && (error.message?.includes('schema cache') || error.message?.includes('column'))) {
      await ensureNursingSchema()
      const retry = await supabase.from('ipd_nursing').insert(payload)
      error = retry.error
    }
    if (!error) {
      setNoteForm({ recorded_time: new Date().toTimeString().slice(0, 5), entry_type: 'note', note_text: '', medication_name: '', medication_dose: '', medication_route: 'IV', medication_given_by: currentUserName })
      await loadEntries()
    }
    setSaving(false)
  }

  // I/O balance
  const totalInput = entries.filter(e => e.entry_type === 'io' && e.io_type === 'Input').reduce((s, e) => s + (e.io_amount_ml || 0), 0)
  const totalOutput = entries.filter(e => e.entry_type === 'io' && e.io_type === 'Output').reduce((s, e) => s + (e.io_amount_ml || 0), 0)
  const ioBalance = totalInput - totalOutput

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Nursing Chart — {admission.patient_name}</h2>
          <p className="text-xs text-gray-500">
            {admission.bed_number} · {admission.ward} · Admitted {formatDate(admission.admission_date)}
            {' '} · Dr. {admission.admitting_doctor}
            {admission.consulting_doctors?.length > 0 && ` + ${admission.consulting_doctors.join(', ')}`}
          </p>
          {/*
            ── Legacy-view banner (June 2026 unification fix) ──────────
            We're showing the inline panel because this admission has
            no bed_id, which means the modern /ipd/[bedId] route can't
            be opened.  Tell the user so they know why this looks
            different from the chart they see for other patients.
          */}
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1 inline-block">
            ⚠ Legacy chart view (this admission has no linked bed). For
            full clinical features (Doctor Notes, Files, IPD Bill), please
            re-link a bed from /ipd/beds.
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
              <div><label className="label">Time</label><input className="input" type="time" value={vitalForm.recorded_time} onChange={e => setVitalForm(p => ({ ...p, recorded_time: e.target.value }))} /></div>
              <div><label className="label">Pulse (bpm)</label><input className="input" type="number" placeholder="72" value={vitalForm.pulse} onChange={e => setVitalForm(p => ({ ...p, pulse: e.target.value }))} /></div>
              <div><label className="label">BP Systolic</label><input className="input" type="number" placeholder="120" value={vitalForm.bp_systolic} onChange={e => setVitalForm(p => ({ ...p, bp_systolic: e.target.value }))} /></div>
              <div><label className="label">BP Diastolic</label><input className="input" type="number" placeholder="80" value={vitalForm.bp_diastolic} onChange={e => setVitalForm(p => ({ ...p, bp_diastolic: e.target.value }))} /></div>
              <div><label className="label">Temperature (°F)</label><input className="input" type="number" step="0.1" placeholder="98.6" value={vitalForm.temperature} onChange={e => setVitalForm(p => ({ ...p, temperature: e.target.value }))} /></div>
              <div><label className="label">SpO₂ (%)</label><input className="input" type="number" placeholder="98" value={vitalForm.spo2} onChange={e => setVitalForm(p => ({ ...p, spo2: e.target.value }))} /></div>
              <div><label className="label">RR (breaths/min)</label><input className="input" type="number" placeholder="16" value={vitalForm.rr} onChange={e => setVitalForm(p => ({ ...p, rr: e.target.value }))} /></div>
              <div><label className="label">Weight (kg)</label><input className="input" type="number" step="0.1" placeholder="55.0" value={vitalForm.weight} onChange={e => setVitalForm(p => ({ ...p, weight: e.target.value }))} /></div>
            </div>
            <div className="mb-3">
              <label className="label">Nurse Note (optional)</label>
              <textarea className="input" rows={2} placeholder="Any observation…" value={vitalForm.vital_note} onChange={e => setVitalForm(p => ({ ...p, vital_note: e.target.value }))} />
            </div>
            <button onClick={saveVital} disabled={saving}
              className="btn-primary flex items-center gap-2 text-xs disabled:opacity-60">
              <Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save Vitals'}
            </button>
          </div>
        )}

        {/* I/O form */}
        {addType === 'io' && (
          <div className="grid grid-cols-4 gap-3 items-end">
            <div><label className="label">Time</label><input className="input" type="time" value={ioForm.recorded_time} onChange={e => setIoForm(p => ({ ...p, recorded_time: e.target.value }))} /></div>
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
            <div><label className="label">Amount (mL)</label><input className="input" type="number" placeholder="500" value={ioForm.io_amount_ml} onChange={e => setIoForm(p => ({ ...p, io_amount_ml: e.target.value }))} /></div>
            <button onClick={saveIO} disabled={saving}
              className="btn-primary flex items-center gap-2 text-xs col-span-4 w-fit disabled:opacity-60">
              <Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save I/O Entry'}
            </button>
          </div>
        )}

        {/* Note / Medication */}
        {(addType === 'note' || addType === 'medication') && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Time</label><input className="input" type="time" value={noteForm.recorded_time} onChange={e => setNoteForm(p => ({ ...p, recorded_time: e.target.value }))} /></div>
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
                <div><label className="label">Drug Name</label><input className="input" placeholder="e.g. Metronidazole" value={noteForm.medication_name} onChange={e => setNoteForm(p => ({ ...p, medication_name: e.target.value }))} /></div>
                <div><label className="label">Dose</label><input className="input" placeholder="500mg" value={noteForm.medication_dose} onChange={e => setNoteForm(p => ({ ...p, medication_dose: e.target.value }))} /></div>
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
                value={noteForm.note_text} onChange={e => setNoteForm(p => ({ ...p, note_text: e.target.value }))} />
            </div>
            <button onClick={saveNote} disabled={saving}
              className="btn-primary flex items-center gap-2 text-xs disabled:opacity-60">
              <Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
        )}
      </div>

      {/* Photos & Documents Upload */}
      <div className="card p-5 mb-5">
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-green-500" /> Photos &amp; Documents
          <span className="text-xs text-gray-400 font-normal">(AI auto-extraction enabled)</span>
        </h3>
        <IPDFileUpload
          ipdAdmissionId={admission.id}
          patientId={admission.patient_id}
          uploadedBy={currentUserName}
          uploadedByRole="nurse"
          onFileUploaded={(file, aiData) => {
            // If AI extracted vital data, pre-fill the vital form
            if (aiData && !aiData._error) {
              if (aiData.pulse || aiData.bp_systolic || aiData.temperature) {
                setVitalForm(prev => ({
                  ...prev,
                  pulse: aiData.pulse || prev.pulse,
                  bp_systolic: aiData.bp_systolic || prev.bp_systolic,
                  bp_diastolic: aiData.bp_diastolic || prev.bp_diastolic,
                  temperature: aiData.temperature || prev.temperature,
                  spo2: aiData.spo2 || prev.spo2,
                  rr: aiData.respiratory_rate || aiData.rr || prev.rr,
                  weight: aiData.weight || prev.weight,
                }))
              }
            }
          }}
        />
      </div>

      {/* Chart History */}
      {loading ? (
        <div className="flex items-center justify-center h-24">
          <div className="w-6 h-6 border-4 border-purple-400 border-t-transparent rounded-full animate-spin" />
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