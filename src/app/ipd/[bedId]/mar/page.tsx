'use client'
/**
 * src/app/ipd/[bedId]/mar/page.tsx
 *
 * Medication Administration Record (MAR) — Standalone IPD Page
 *
 * Displays a grid-style chart of all prescribed medications and their
 * administration status throughout the day. Nurses mark each dose as
 * given / missed / held / refused with timestamp and signature.
 *
 * NEW FILE — does not modify any existing page or component.
 * Access via: /ipd/[bedId]/mar
 * Linked from the nursing chart page.
 *
 * Data flow:
 *   Reads from: prescriptions, ipd_admissions, patients, beds
 *   Writes to: medication_administrations
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatDate, getIndiaToday } from '@/lib/utils'
import {
  Pill, ArrowLeft, Loader2, CheckCircle, AlertCircle,
  Clock, User, Calendar, ChevronLeft, ChevronRight,
  Plus, XCircle, PauseCircle, Ban, Activity, RefreshCw,
} from 'lucide-react'

// ── Time slots for the MAR grid ─────────────────────────────────
const TIME_SLOTS = [
  '06:00', '08:00', '10:00', '12:00', '14:00',
  '16:00', '18:00', '20:00', '22:00', '00:00',
]

const TIME_LABELS: Record<string, string> = {
  '06:00': '6 AM', '08:00': '8 AM', '10:00': '10 AM', '12:00': '12 PM',
  '14:00': '2 PM', '16:00': '4 PM', '18:00': '6 PM', '20:00': '8 PM',
  '22:00': '10 PM', '00:00': '12 AM',
}

// Map frequency to scheduled times
const FREQ_TIMES: Record<string, string[]> = {
  'OD':   ['08:00'],
  'BD':   ['08:00', '20:00'],
  'TDS':  ['08:00', '14:00', '20:00'],
  'QID':  ['06:00', '12:00', '18:00', '00:00'],
  'Q4H':  ['06:00', '10:00', '14:00', '18:00', '22:00'],
  'Q6H':  ['06:00', '12:00', '18:00', '00:00'],
  'Q8H':  ['06:00', '14:00', '22:00'],
  'Q12H': ['08:00', '20:00'],
  'HS':   ['22:00'],
  'Stat': ['08:00'],
  'SOS':  [],
  'Once daily': ['08:00'],
  'Twice daily': ['08:00', '20:00'],
  'Thrice daily': ['08:00', '14:00', '20:00'],
}

function getScheduledTimes(frequency: string): string[] {
  if (!frequency) return ['08:00']
  const key = Object.keys(FREQ_TIMES).find(k =>
    frequency.toUpperCase().includes(k.toUpperCase())
  )
  return key ? FREQ_TIMES[key] : ['08:00']
}

// ── Status config ───────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; icon: any; bg: string; text: string }> = {
  scheduled: { label: 'Due',      icon: Clock,       bg: 'bg-gray-100',   text: 'text-gray-500' },
  given:     { label: 'Given',    icon: CheckCircle, bg: 'bg-green-100',  text: 'text-green-700' },
  missed:    { label: 'Missed',   icon: XCircle,     bg: 'bg-red-100',    text: 'text-red-700' },
  held:      { label: 'Held',     icon: PauseCircle, bg: 'bg-yellow-100', text: 'text-yellow-700' },
  refused:   { label: 'Refused',  icon: Ban,         bg: 'bg-orange-100', text: 'text-orange-700' },
  discontinued: { label: 'D/C',   icon: XCircle,     bg: 'bg-gray-200',   text: 'text-gray-500' },
}

// ── Types ────────────────────────────────────────────────────────
interface MedRow {
  rxId: string
  drug: string
  dose: string
  route: string
  frequency: string
  duration: string
  scheduledTimes: string[]
}

interface AdminRecord {
  id: string
  drug_name: string
  scheduled_time: string
  scheduled_date: string
  status: string
  administered_at: string | null
  administered_by: string | null
  notes: string | null
  reason_not_given: string | null
  site: string | null
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════
export default function MARPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const bedId = params.bedId as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bed, setBed] = useState<any>(null)
  const [patient, setPatient] = useState<any>(null)
  const [admissionId, setAdmissionId] = useState('')
  const [medications, setMedications] = useState<MedRow[]>([])
  const [adminRecords, setAdminRecords] = useState<AdminRecord[]>([])
  const [selectedDate, setSelectedDate] = useState(getIndiaToday())
  const [tableExists, setTableExists] = useState(true)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [modalDrug, setModalDrug] = useState('')
  const [modalTime, setModalTime] = useState('')
  const [modalStatus, setModalStatus] = useState('given')
  const [modalNotes, setModalNotes] = useState('')
  const [modalReason, setModalReason] = useState('')
  const [modalSite, setModalSite] = useState('')
  const [modalExistingId, setModalExistingId] = useState('')
  const [modalSaving, setModalSaving] = useState(false)

  // Quick add medication
  const [showAddMed, setShowAddMed] = useState(false)
  const [newDrug, setNewDrug] = useState('')
  const [newDose, setNewDose] = useState('')
  const [newRoute, setNewRoute] = useState('Oral')
  const [newFreq, setNewFreq] = useState('BD')

  const currentUser = user?.full_name || user?.email || ''

  // ── Load all data ─────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      // 1. Load bed and patient
      const { data: b } = await supabase.from('beds').select('*').eq('id', bedId).single()
      if (!b) { setError('Bed not found'); setLoading(false); return }
      setBed(b)

      if (b.patient_id) {
        const { data: p } = await supabase.from('patients').select('*').eq('id', b.patient_id).single()
        if (p) setPatient(p)
      }

      // 2. Find active admission
      const { data: adm } = await supabase.from('ipd_admissions')
        .select('id, admission_date').eq('bed_id', bedId).eq('status', 'active').single()
      if (adm) setAdmissionId(adm.id)

      // 3. Load prescriptions
      if (b.patient_id) {
        const { data: rxList } = await supabase.from('prescriptions')
          .select('*').eq('patient_id', b.patient_id)
          .order('created_at', { ascending: false }).limit(10)

        const meds: MedRow[] = []
        const seen = new Set<string>()

        ;(rxList || []).forEach((rx: any) => {
          if (rx.medications && Array.isArray(rx.medications)) {
            rx.medications.forEach((m: any) => {
              const key = `${m.drug}|${m.dose}|${m.frequency}`
              if (!seen.has(key)) {
                seen.add(key)
                meds.push({
                  rxId: rx.id,
                  drug: m.drug || '',
                  dose: m.dose || '',
                  route: m.route || 'Oral',
                  frequency: m.frequency || 'BD',
                  duration: m.duration || '',
                  scheduledTimes: getScheduledTimes(m.frequency || 'BD'),
                })
              }
            })
          }
        })
        setMedications(meds)
      }

      // 4. Load admin records for selected date
      await loadAdminRecords(adm?.id)

    } catch (err: any) {
      setError(err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [bedId])

  async function loadAdminRecords(admId?: string) {
    const aid = admId || admissionId
    if (!aid) return

    try {
      const { data, error: err } = await supabase
        .from('medication_administrations')
        .select('*')
        .eq('ipd_admission_id', aid)
        .eq('scheduled_date', selectedDate)
        .order('scheduled_time', { ascending: true })

      if (err) {
        if (err.message?.includes('does not exist')) {
          setTableExists(false)
        } else throw err
        return
      }
      setAdminRecords(data || [])
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        setTableExists(false)
      }
    }
  }

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { if (admissionId) loadAdminRecords() }, [selectedDate, admissionId])

  // ── Get status for a drug at a time ───────────────────────────
  function getAdminStatus(drug: string, time: string): AdminRecord | null {
    return adminRecords.find(r =>
      r.drug_name === drug && r.scheduled_time === time
    ) || null
  }

  // ── Open admin modal ──────────────────────────────────────────
  function openAdminModal(drug: string, time: string) {
    const existing = getAdminStatus(drug, time)
    setModalDrug(drug)
    setModalTime(time)
    setModalStatus(existing?.status || 'given')
    setModalNotes(existing?.notes || '')
    setModalReason(existing?.reason_not_given || '')
    setModalSite(existing?.site || '')
    setModalExistingId(existing?.id || '')
    setShowModal(true)
  }

  // ── Save administration ───────────────────────────────────────
  async function saveAdmin() {
    if (!admissionId || !patient) return
    setModalSaving(true)

    const payload: any = {
      ipd_admission_id: admissionId,
      patient_id: patient.id,
      drug_name: modalDrug,
      scheduled_date: selectedDate,
      scheduled_time: modalTime,
      status: modalStatus,
      administered_by: currentUser,
      notes: modalNotes || null,
      site: modalSite || null,
      updated_at: new Date().toISOString(),
      updated_by: currentUser,
    }

    if (modalStatus === 'given') {
      payload.administered_at = new Date().toISOString()
    } else {
      payload.reason_not_given = modalReason || null
      payload.administered_at = null
    }

    try {
      if (modalExistingId) {
        await supabase.from('medication_administrations')
          .update(payload).eq('id', modalExistingId)
      } else {
        payload.created_by = currentUser
        await supabase.from('medication_administrations').insert(payload)
      }

      setShowModal(false)
      await loadAdminRecords()
    } catch (err: any) {
      setError(`Save failed: ${err.message}`)
    } finally {
      setModalSaving(false)
    }
  }

  // ── Quick add medication ──────────────────────────────────────
  async function addQuickMed() {
    if (!newDrug.trim()) return
    const med: MedRow = {
      rxId: '',
      drug: newDrug,
      dose: newDose,
      route: newRoute,
      frequency: newFreq,
      duration: '',
      scheduledTimes: getScheduledTimes(newFreq),
    }
    setMedications(prev => [...prev, med])
    setNewDrug('')
    setNewDose('')
    setShowAddMed(false)
  }

  // ── Date navigation ───────────────────────────────────────────
  function changeDate(delta: number) {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + delta)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  const isToday = selectedDate === getIndiaToday()

  // ── Stats ─────────────────────────────────────────────────────
  const totalScheduled = medications.reduce((s, m) => s + m.scheduledTimes.length, 0)
  const givenCount = adminRecords.filter(r => r.status === 'given').length
  const missedCount = adminRecords.filter(r => r.status === 'missed').length
  const pendingCount = totalScheduled - adminRecords.length

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          <span className="ml-2 text-gray-500">Loading MAR...</span>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="max-w-full mx-auto px-4 py-4">
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Pill className="w-5 h-5 text-purple-500" />
                Medication Administration Record
              </h1>
              {patient && bed && (
                <p className="text-sm text-gray-500">
                  {patient.full_name} · MRN: {patient.mrn || '—'} · Bed {bed.bed_number} ({bed.ward || ''})
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/ipd/${bedId}`}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
              ← Nursing Chart
            </Link>
            <Link href={`/ipd/${bedId}/billing`}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
              Billing →
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            <button onClick={() => setError('')} className="ml-auto text-red-400">×</button>
          </div>
        )}

        {!tableExists && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center mb-4">
            <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto mb-3" />
            <h3 className="font-semibold text-gray-800 mb-2">Database Setup Required</h3>
            <p className="text-sm text-gray-600">
              Run <code className="bg-gray-100 px-1 rounded">medication_admin_migration.sql</code> in Supabase SQL Editor.
            </p>
          </div>
        )}

        {/* ── Date Selector + Stats ───────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <button onClick={() => changeDate(-1)} className="p-1.5 rounded hover:bg-gray-100">
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <input type="date" value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                {isToday && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Today</span>}
              </div>
              <button onClick={() => changeDate(1)} className="p-1.5 rounded hover:bg-gray-100">
                <ChevronRight className="w-5 h-5 text-gray-600" />
              </button>
              {!isToday && (
                <button onClick={() => setSelectedDate(getIndiaToday())}
                  className="text-xs text-blue-600 hover:underline ml-2">Go to Today</button>
              )}
            </div>

            {/* Stats */}
            <div className="flex gap-3 text-xs">
              <div className="bg-green-50 rounded-lg px-3 py-1.5 text-center">
                <div className="font-bold text-green-700 text-lg">{givenCount}</div>
                <div className="text-green-600">Given</div>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-1.5 text-center">
                <div className="font-bold text-gray-600 text-lg">{pendingCount > 0 ? pendingCount : 0}</div>
                <div className="text-gray-500">Pending</div>
              </div>
              <div className="bg-red-50 rounded-lg px-3 py-1.5 text-center">
                <div className="font-bold text-red-700 text-lg">{missedCount}</div>
                <div className="text-red-600">Missed</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── MAR Grid ────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {medications.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Pill className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No medications prescribed.</p>
              <p className="text-xs mt-1">Add medications using the button below, or prescribe from the consultation page.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left p-3 text-xs font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[200px]">
                      Medication
                    </th>
                    {TIME_SLOTS.map(t => (
                      <th key={t} className="text-center p-2 text-xs font-medium text-gray-500 min-w-[70px]">
                        {TIME_LABELS[t]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {medications.map((med, idx) => (
                    <tr key={`${med.drug}-${idx}`} className="border-b border-gray-100 hover:bg-gray-50/50">
                      {/* Medication name cell */}
                      <td className="p-3 sticky left-0 bg-white z-10 border-r border-gray-200">
                        <div className="font-medium text-gray-800">{med.drug}</div>
                        <div className="text-xs text-gray-500">
                          {med.dose} · {med.route} · {med.frequency}
                          {med.duration && <span className="ml-1">× {med.duration}</span>}
                        </div>
                      </td>

                      {/* Time slot cells */}
                      {TIME_SLOTS.map(time => {
                        const isScheduled = med.scheduledTimes.includes(time)
                        const record = getAdminStatus(med.drug, time)
                        const status = record?.status || (isScheduled ? 'scheduled' : null)
                        const cfg = status ? STATUS_CONFIG[status] : null

                        if (!isScheduled && !record) {
                          // Not scheduled for this time
                          return (
                            <td key={time} className="p-1 text-center">
                              <span className="text-gray-200">—</span>
                            </td>
                          )
                        }

                        const Icon = cfg?.icon || Clock
                        return (
                          <td key={time} className="p-1 text-center">
                            <button
                              onClick={() => openAdminModal(med.drug, time)}
                              className={`w-full py-2 px-1 rounded-lg text-xs font-medium transition-all hover:shadow-md ${cfg?.bg} ${cfg?.text} ${
                                status === 'scheduled' ? 'border-2 border-dashed border-gray-300 hover:border-blue-400' : ''
                              }`}
                              title={record?.administered_by ? `By: ${record.administered_by}` : 'Click to record'}
                            >
                              <Icon className="w-3.5 h-3.5 mx-auto mb-0.5" />
                              <span className="block text-[10px]">{cfg?.label}</span>
                              {record?.administered_by && (
                                <span className="block text-[8px] opacity-70 truncate">{record.administered_by.split(' ')[0]}</span>
                              )}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Quick add medication */}
          <div className="p-3 border-t border-gray-200 bg-gray-50">
            {showAddMed ? (
              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="text-[10px] text-gray-400 block">Drug Name *</label>
                  <input type="text" value={newDrug} onChange={e => setNewDrug(e.target.value)}
                    placeholder="e.g., Inj. Ceftriaxone" className="px-2 py-1.5 border border-gray-300 rounded text-sm w-48" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 block">Dose</label>
                  <input type="text" value={newDose} onChange={e => setNewDose(e.target.value)}
                    placeholder="e.g., 1g" className="px-2 py-1.5 border border-gray-300 rounded text-sm w-24" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 block">Route</label>
                  <select value={newRoute} onChange={e => setNewRoute(e.target.value)}
                    className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">
                    {['Oral', 'IV', 'IM', 'SC', 'Topical', 'PR', 'Nebulization', 'Eye drops', 'Ear drops'].map(r => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 block">Frequency</label>
                  <select value={newFreq} onChange={e => setNewFreq(e.target.value)}
                    className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">
                    {['OD', 'BD', 'TDS', 'QID', 'Q4H', 'Q6H', 'Q8H', 'Q12H', 'HS', 'SOS', 'Stat'].map(f => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <button onClick={addQuickMed} className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded text-sm">Add</button>
                <button onClick={() => setShowAddMed(false)} className="text-gray-400 hover:text-gray-600 text-sm">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setShowAddMed(true)}
                className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Medication to Chart
              </button>
            )}
          </div>
        </div>

        {/* ── Legend ───────────────────────────────────────────── */}
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 mb-2">Legend</p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
              const Icon = cfg.icon
              return (
                <span key={key} className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${cfg.bg} ${cfg.text}`}>
                  <Icon className="w-3 h-3" /> {cfg.label}
                </span>
              )
            })}
          </div>
        </div>

        {/* ── Recent Administration History ────────────────────── */}
        {adminRecords.length > 0 && (
          <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Administration Log — {formatDate(selectedDate)}
            </h3>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {adminRecords.map(r => {
                const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.scheduled
                const Icon = cfg.icon
                return (
                  <div key={r.id} className={`flex items-start gap-3 text-xs p-2 rounded-lg ${cfg.bg}`}>
                    <Icon className={`w-4 h-4 mt-0.5 ${cfg.text}`} />
                    <div className="flex-1">
                      <span className="font-medium text-gray-800">{r.drug_name}</span>
                      <span className="text-gray-500 ml-2">@ {TIME_LABELS[r.scheduled_time] || r.scheduled_time}</span>
                      <span className={`ml-2 font-semibold ${cfg.text}`}>{cfg.label}</span>
                      {r.administered_by && <span className="text-gray-400 ml-2">by {r.administered_by}</span>}
                      {r.site && <span className="text-gray-400 ml-2">({r.site})</span>}
                      {r.reason_not_given && <span className="text-gray-500 ml-2">Reason: {r.reason_not_given}</span>}
                      {r.notes && <p className="text-gray-500 mt-0.5">{r.notes}</p>}
                    </div>
                    {r.administered_at && (
                      <span className="text-gray-400 text-[10px] shrink-0">
                        {new Date(r.administered_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ═══════ ADMIN MODAL ═══════ */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4 space-y-4">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <Pill className="w-5 h-5 text-purple-500" /> Record Administration
            </h3>

            <div className="bg-purple-50 rounded-lg p-3 text-sm">
              <div className="font-medium text-purple-800">{modalDrug}</div>
              <div className="text-xs text-purple-600 mt-0.5">
                Scheduled: {TIME_LABELS[modalTime] || modalTime} · {formatDate(selectedDate)}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Status *</label>
              <div className="grid grid-cols-3 gap-2">
                {['given', 'missed', 'held', 'refused'].map(s => {
                  const cfg = STATUS_CONFIG[s]
                  const Icon = cfg.icon
                  const isActive = modalStatus === s
                  return (
                    <button key={s} onClick={() => setModalStatus(s)}
                      className={`p-2 rounded-lg text-xs font-medium flex flex-col items-center gap-1 border-2 transition-all ${
                        isActive ? `${cfg.bg} ${cfg.text} border-current shadow-sm` : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}>
                      <Icon className="w-4 h-4" />
                      {cfg.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {modalStatus !== 'given' && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Reason *</label>
                <input type="text" value={modalReason} onChange={e => setModalReason(e.target.value)}
                  placeholder="Why was this dose not given?"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            )}

            {modalStatus === 'given' && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Injection Site (if applicable)</label>
                <select value={modalSite} onChange={e => setModalSite(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                  <option value="">N/A</option>
                  {['Left Arm', 'Right Arm', 'Left Deltoid', 'Right Deltoid', 'Left Thigh', 'Right Thigh', 'Abdomen', 'Left Gluteal', 'Right Gluteal'].map(s => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs text-gray-500 block mb-1">Notes (optional)</label>
              <textarea value={modalNotes} onChange={e => setModalNotes(e.target.value)}
                rows={2} placeholder="Any observations or comments..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>

            <div className="text-xs text-gray-400">
              Recording as: <strong>{currentUser}</strong> · {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={saveAdmin} disabled={modalSaving}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                {modalSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}