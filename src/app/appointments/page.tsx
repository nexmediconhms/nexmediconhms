'use client'
import { Suspense, useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { escapeLike, formatDate, getHospitalSettings } from '@/lib/utils'
import { createAppointment } from '@/lib/services/appointmentService'
import { getIndiaToday } from '@/lib/utils'

import {
  Calendar, Plus, Search, X, CheckCircle,
  MessageCircle, Phone, Trash2,
  AlertCircle, Stethoscope, User, RefreshCw, Loader2,
  UserCircle, BellRing, Scissors,
} from 'lucide-react'

type ApptStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no-show'
type ViewTab = 'today' | 'upcoming' | 'past' | 'all' | 'custom'

interface Appointment {
  id: string
  patient_id: string
  patient_name: string
  mrn: string
  mobile: string
  date: string
  time: string
  type: string
  notes: string
  status: ApptStatus
  created_at: string
  reminder_sent: boolean
}

const APPT_TYPES = [
  'ANC Follow-up',
  'Follow-up',
  'OPD Consultation',
  'Pre-Surgery Assessment',
  'Post-op Review',
  'Lab Report Discussion',
  'Infertility Counselling',
  'PCOS Follow-up',
  'USG Follow-up',
  'Discharge Follow-up',
  'Contraception Counselling',
  'Colposcopy / Procedure',
  'Other',
]

const STATUS_CONFIG: Record<ApptStatus, { label: string; cls: string; dot: string }> = {
  scheduled: { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  confirmed: { label: 'Confirmed', cls: 'bg-green-50 text-green-700', dot: 'bg-green-500' },
  completed: { label: 'Completed', cls: 'bg-gray-50 text-gray-600', dot: 'bg-gray-400' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-50 text-red-700', dot: 'bg-red-400' },
  'no-show': { label: 'No Show', cls: 'bg-orange-50 text-orange-700', dot: 'bg-orange-400' },
}

const TIME_SLOTS = Array.from({ length: 24 }, (_, h) =>
  [':00', ':15', ':30', ':45'].map(m => `${String(h).padStart(2, '0')}${m}`)
).flat().filter(t => t >= '08:00' && t <= '19:45')

function AppointmentsContent() {
  const [appts, setAppts] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'new' | 'reminder'>('list')
  const [activeTab, setActiveTab_] = useState<ViewTab>('upcoming')
  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<ApptStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const today = getIndiaToday()

  function setViewTab(tab: ViewTab) {
    setActiveTab_(tab)
    if (tab !== 'custom') setDateFilter('')
  }

  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState<any[]>([])
  const [selPatient, setSelPatient] = useState<any>(null)
  const [apptDate, setApptDate] = useState(today)
  const [apptTime, setApptTime] = useState('09:00')
  const [apptType, setApptType] = useState(APPT_TYPES[0])
  const [apptNotes, setApptNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [reminderAppt, setReminderAppt] = useState<Appointment | null>(null)
  const [patientMsg, setPatientMsg] = useState('')
  const [doctorMsg, setDoctorMsg] = useState('')
  const [reminderLoading, setReminderLoading] = useState(false)
  const [copiedPatient, setCopiedPatient] = useState(false)
  const [copiedDoctor, setCopiedDoctor] = useState(false)
  const [reminderTab, setReminderTab] = useState<'patient' | 'doctor'>('patient')

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchParams = useSearchParams()
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : ({} as any)

  const fetchAppts = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('appointments')
      .select('*')
      .order('date', { ascending: activeTab !== 'past' })
      .order('time', { ascending: activeTab !== 'past' })

    switch (activeTab) {
      case 'today':
        query = query.eq('date', today)
        break
      case 'upcoming':
        query = query.gte('date', today)
        break
      case 'past':
        query = query.lt('date', today)
        break
      case 'custom':
        if (dateFilter) query = query.eq('date', dateFilter)
        break
      case 'all':
      default:
        break
    }

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (typeFilter !== 'all') query = query.eq('type', typeFilter)
    query = query.limit(activeTab === 'past' || activeTab === 'all' ? 200 : 500)

    const { data, error } = await query
    if (error) {
      console.error('[Appointments] fetch error:', error.message)
      setAppts([])
    } else {
      setAppts((data ?? []) as Appointment[])
    }
    setLoading(false)
  }, [activeTab, dateFilter, statusFilter, typeFilter, today])

  useEffect(() => { fetchAppts() }, [fetchAppts])

  // ✅ REALTIME AUTO-REFRESH: when prescription updates follow-up -> appointments change -> refresh here
  useEffect(() => {
    const ch = supabase
      .channel('appointments-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments' },
        () => fetchAppts()
      )
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [fetchAppts])

  const [todayCount, setTodayCount] = useState(0)
  const [upcomingCount, setUpcomingCount] = useState(0)
  const [pastCount, setPastCount] = useState(0)

  useEffect(() => {
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('date', today).neq('status', 'cancelled')
      .then(({ count }) => setTodayCount(count || 0))

    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .gt('date', today).in('status', ['scheduled', 'confirmed'])
      .then(({ count }) => setUpcomingCount(count || 0))

    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .lt('date', today)
      .then(({ count }) => setPastCount(count || 0))
  }, [appts, today])

  // ── OT Schedule display in Appointments page ────────────────
  const [otSchedules, setOtSchedules] = useState<any[]>([])
  useEffect(() => {
    async function loadOT() {
      const { data } = await supabase
        .from('ot_schedules')
        .select('id, patient_id, patient_name, mrn, surgery_name, surgery_date, start_time, end_time, surgeon, ot_room, priority, status')
        .gte('surgery_date', today)
        .in('status', ['scheduled', 'in_progress'])
        .order('surgery_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(20)
      setOtSchedules(data || [])
    }
    loadOT()
  }, [today, appts])

  useEffect(() => {
    const pid = searchParams.get('patientId')
    const pname = searchParams.get('patientName')
    if (pid && pname && !selPatient) {
      setSelPatient({ id: pid, full_name: decodeURIComponent(pname), mrn: '', mobile: '', age: '' })
      setView('new')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function searchPatients(q: string) {
    setPatientQuery(q); setSelPatient(null)
    if (q.trim().length < 2) { setPatientResults([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      const safe = escapeLike(q)
      const { data } = await supabase.from('patients')
        .select('id, full_name, mrn, mobile, age')
        .or(`full_name.ilike.%${safe}%,mrn.ilike.%${safe}%,mobile.ilike.%${safe}%`).limit(6)
      setPatientResults(data ?? [])
    }, 300)
  }

  // ✅ BOOK appointment using service (constraint-safe)
  async function bookAppointment() {
    if (!selPatient || !apptDate || !apptTime) return
    setSaving(true); setSaveError('')

    try {
      const newId = await createAppointment({
        patientId: selPatient.id,
        date: apptDate,
        time: apptTime,
        patientName: selPatient.full_name,
        mrn: selPatient.mrn ?? '',
        mobile: selPatient.mobile ?? '',
        notes: apptNotes.trim() || null,
        type: apptType,
      })

      const { data, error } = await supabase.from('appointments').select('*').eq('id', newId).single()
      setSaving(false)

      if (error) {
        setSaveError(`Booked but failed to load: ${error.message}`)
        resetForm()
        setView('list')
        fetchAppts()
        return
      }

      resetForm()
      setView('list')
      fetchAppts()
      if (data) openReminder(data as Appointment)
    } catch (e: any) {
      setSaving(false)
      setSaveError(`Failed to book: ${e?.message || 'Unknown error'}`)
    }
  }

  async function updateStatus(id: string, status: ApptStatus) {
    const { error } = await supabase
      .from('appointments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) setAppts(prev => prev.map(a => a.id === id ? { ...a, status } : a))
  }

  async function deleteAppt(id: string) {
    if (!confirm('Delete this appointment?')) return
    const { error } = await supabase.from('appointments').delete().eq('id', id)
    if (!error) setAppts(prev => prev.filter(a => a.id !== id))
  }

  async function openReminder(appt: Appointment) {
    setReminderAppt(appt)
    setView('reminder')
    setReminderLoading(true)
    setReminderTab('patient')
    setCopiedPatient(false)
    setCopiedDoctor(false)

    const dateStr = new Date(appt.date).toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })

    const [hh, mm] = appt.time.split(':').map(Number)
    const arrivalDate = new Date()
    arrivalDate.setHours(hh, mm - 30, 0, 0)
    if (arrivalDate.getMinutes() < 0) arrivalDate.setHours(hh - 1, 60 + arrivalDate.getMinutes())
    const arrivalTime = arrivalDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

    const [{ data: patient }, { data: lastEnc }, { data: lastRx }] = await Promise.all([
      supabase.from('patients').select('full_name, age, date_of_birth, gender, blood_group, abha_id, address, mediclaim, cashless, policy_tpa_name').eq('id', appt.patient_id).single(),
      supabase.from('encounters').select('encounter_date, encounter_type, diagnosis, chief_complaint, bp_systolic, bp_diastolic, pulse, weight, ob_data').eq('patient_id', appt.patient_id).order('encounter_date', { ascending: false }).limit(1).single(),
      supabase.from('prescriptions').select('medications, follow_up_date, advice, reports_needed').eq('patient_id', appt.patient_id).order('created_at', { ascending: false }).limit(1).single(),
    ])

    const p = patient ?? ({} as any)
    const enc = lastEnc as any
    const rx = lastRx as any

    const medsText = Array.isArray(rx?.medications)
      ? rx.medications.slice(0, 4).map((m: any) => `• ${m.drug} ${m.dose || ''} ${m.frequency || ''} ${m.duration || ''}`.trim()).join('\n')
      : ''

    const pMsg =
      `*${hs.hospitalName || 'NexMedicon Hospital'}*
Namaste ${appt.patient_name} ji 🙏
This is a reminder for your *upcoming appointment*.
📅 *Date:* ${dateStr}
🕐 *Appointment Time:* ${appt.time}
⏰ *Please arrive by:* ${arrivalTime} *(30 minutes early)*
🏥 *Visit Type:* ${appt.type}
📍 *Address:* ${hs.address || 'Hospital address'}
📋 *Please bring:*
✅ Previous prescriptions & reports
✅ Any lab reports / USG reports done recently
✅ Aadhaar card / ID proof${p.mediclaim ? '\n✅ Insurance / Mediclaim card' : ''}
${rx?.reports_needed ? `\n🔬 *Pending tests to get done:*\n${rx.reports_needed}` : ''}
${appt.notes ? `\n📝 *Note from doctor:* ${appt.notes}` : ''}
For queries call: ${hs.phone || 'our helpdesk'}
---
_${hs.hospitalName || 'NexMedicon Hospital'} — Caring for you_ 🙏`

    const dMsg =
      `*${hs.hospitalName || 'NexMedicon Hospital'}*
*Patient Brief — Appointment Alert* 🩺
📅 *Date:* ${dateStr} at *${appt.time}*
🏥 *Visit Type:* ${appt.type}
━━━━━━━━━━━━━━━━
*Name:* ${appt.patient_name}
*MRN:* ${appt.mrn}
*Mobile:* ${appt.mobile}
${enc ? `\nLast Visit: ${formatDate(enc.encounter_date)} · ${enc.encounter_type}` : ''}
${medsText ? `\n\n💊 *Current Medications*\n${medsText}` : ''}`

    setPatientMsg(pMsg)
    setDoctorMsg(dMsg)
    setReminderLoading(false)
  }

  function waLink(mobile: string, msg: string) {
    const num = mobile?.replace(/\D/g, '')
    const full = num?.length === 10 ? '91' + num : num
    return `https://wa.me/${full}?text=${encodeURIComponent(msg)}`
  }

  async function markReminderSent(appt: Appointment) {
    await supabase
      .from('appointments')
      .update({ reminder_sent: true, updated_at: new Date().toISOString() })
      .eq('id', appt.id)

    setAppts(prev => prev.map(a => a.id === appt.id ? { ...a, reminder_sent: true } : a))
  }

  function resetForm() {
    setSelPatient(null); setPatientQuery(''); setPatientResults([])
    setApptDate(today)
    setApptTime('09:00'); setApptType(APPT_TYPES[0]); setApptNotes('')
    setSaveError('')
  }

  // REMINDER VIEW
  if (view === 'reminder' && reminderAppt) {
    const doctorMobile = hs.phone?.replace(/\D/g, '') || ''
    const isDoctorWA = doctorMobile.length >= 10
    return (
      <AppShell>
        <div className="p-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => setView('list')} className="text-gray-400 hover:text-gray-700">
              <X className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <BellRing className="w-5 h-5 text-blue-600" />
                WhatsApp Reminders
              </h1>
              <p className="text-xs text-gray-500">
                {reminderAppt.patient_name} · {reminderAppt.date} at {reminderAppt.time}
              </p>
            </div>
          </div>

          {reminderLoading ? (
            <div className="card p-16 text-center">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500">Loading patient profile...</p>
            </div>
          ) : (
            <>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setReminderTab('patient')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${reminderTab === 'patient'
                      ? 'bg-green-600 text-white border-green-600 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'
                    }`}
                >
                  <MessageCircle className="w-4 h-4" />
                  Patient Message
                </button>

                <button
                  onClick={() => setReminderTab('doctor')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${reminderTab === 'doctor'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                    }`}
                >
                  <Stethoscope className="w-4 h-4" />
                  Doctor Brief
                </button>
              </div>

              {reminderTab === 'patient' && (
                <div className="card p-5 mb-4">
                  <label className="label">Message (editable)</label>
                  <textarea
                    className="input resize-none font-mono text-xs leading-relaxed"
                    rows={16}
                    value={patientMsg}
                    onChange={e => setPatientMsg(e.target.value)}
                  />

                  <div className="flex flex-col gap-2 mt-4">
                    <a
                      href={waLink(reminderAppt.mobile, patientMsg)}
                      target="_blank" rel="noopener noreferrer"
                      onClick={() => { markReminderSent(reminderAppt); setCopiedPatient(true) }}
                      className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Send to Patient via WhatsApp
                    </a>

                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(patientMsg)
                        setCopiedPatient(true)
                        markReminderSent(reminderAppt)
                        setTimeout(() => setCopiedPatient(false), 2500)
                      }}
                      className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-sm transition-colors"
                    >
                      {copiedPatient ? <CheckCircle className="w-4 h-4 text-green-500" /> : <MessageCircle className="w-4 h-4" />}
                      {copiedPatient ? 'Copied!' : 'Copy Message'}
                    </button>

                    {reminderAppt.mobile && (
                      <a href={`tel:${reminderAppt.mobile}`} className="flex items-center justify-center gap-2 text-blue-600 hover:underline text-sm font-medium py-1">
                        <Phone className="w-4 h-4" />
                        Call {reminderAppt.patient_name} ({reminderAppt.mobile})
                      </a>
                    )}
                  </div>
                </div>
              )}

              {reminderTab === 'doctor' && (
                <div className="card p-5 mb-4">
                  <label className="label mt-3">Message (editable)</label>
                  <textarea
                    className="input resize-none font-mono text-xs leading-relaxed"
                    rows={20}
                    value={doctorMsg}
                    onChange={e => setDoctorMsg(e.target.value)}
                  />

                  <div className="flex flex-col gap-2 mt-4">
                    {isDoctorWA ? (
                      <a
                        href={waLink(doctorMobile, doctorMsg)}
                        target="_blank" rel="noopener noreferrer"
                        onClick={() => setCopiedDoctor(true)}
                        className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
                      >
                        <MessageCircle className="w-4 h-4" />
                        Send Patient Brief to Doctor via WhatsApp
                      </a>
                    ) : (
                      <div className="text-center text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-xl py-3">
                        ⚙️ Add doctor's phone number in{' '}
                        <Link href="/settings" className="text-blue-600 underline">Settings</Link>{' '}
                        to enable WhatsApp send to doctor.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </AppShell>
    )
  }

  // NEW APPOINTMENT VIEW
  if (view === 'new') {
    return (
      <AppShell>
        <div className="p-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => { resetForm(); setView('list') }} className="text-gray-400 hover:text-gray-700">
              <X className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold text-gray-900">Book Appointment</h1>
          </div>

          {saveError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="card p-5 mb-4">
            <h2 className="section-title">Patient</h2>
            {selPatient ? (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <div>
                  <div className="font-semibold text-gray-900">{selPatient.full_name}</div>
                  <div className="text-xs text-gray-500">{selPatient.mrn} · {selPatient.mobile}</div>
                </div>
                <button onClick={() => { setSelPatient(null); setPatientQuery('') }}>
                  <X className="w-4 h-4 text-gray-400 hover:text-red-500" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input className="input pl-9" placeholder="Search patient by name, MRN, or mobile…" autoFocus
                  value={patientQuery} onChange={e => searchPatients(e.target.value)} />
                {patientResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 overflow-hidden">
                    {patientResults.map(p => (
                      <button key={p.id} onClick={() => { setSelPatient(p); setPatientResults([]) }}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 text-sm border-b border-gray-50 last:border-0">
                        <span className="font-semibold text-gray-900">{p.full_name}</span>
                        <span className="text-gray-400 ml-2 text-xs">{p.mrn} · {p.mobile}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card p-5 mb-4">
            <h2 className="section-title">Appointment Details</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="label">Date</label>
                <input className="input" type="date" min={today}
                  value={apptDate} onChange={e => setApptDate(e.target.value)} />
              </div>
              <div>
                <label className="label">Time</label>
                <select className="input" value={apptTime} onChange={e => setApptTime(e.target.value)}>
                  {TIME_SLOTS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Visit Type</label>
                <select className="input" value={apptType} onChange={e => setApptType(e.target.value)}>
                  {APPT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Notes (optional)</label>
                <textarea className="input resize-none" rows={2}
                  placeholder="e.g. Bring previous USG reports, fasting required…"
                  value={apptNotes} onChange={e => setApptNotes(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => { resetForm(); setView('list') }} className="btn-secondary">Cancel</button>
            <button onClick={bookAppointment}
              disabled={saving || !selPatient || !apptDate || !apptTime}
              className="btn-primary flex items-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
              {saving ? 'Booking…' : 'Book & Generate Reminder'}
            </button>
          </div>
        </div>
      </AppShell>
    )
  }

  // LIST VIEW (unchanged core UI)
  return (
    <AppShell>
      <div className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-blue-600" /> Appointments
            </h1>
            <p className="text-sm text-gray-500">
              {todayCount} today · {upcomingCount} upcoming · {pastCount} past
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={fetchAppts} className="btn-secondary flex items-center gap-1.5 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>

            <button onClick={() => { resetForm(); setView('new') }}
              className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Book Appointment
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
          {([
            { key: 'today', label: `Today (${todayCount})` },
            { key: 'upcoming', label: `Upcoming (${upcomingCount})` },
            { key: 'past', label: `Past (${pastCount})` },
            { key: 'all', label: 'All' },
            { key: 'custom', label: '📅 Pick date' },
          ] as { key: ViewTab; label: string }[]).map(({ key, label }) => (
            <button key={key} onClick={() => setViewTab(key)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${activeTab === key ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom date picker */}
        {activeTab === 'custom' && (
          <div className="mb-4 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <label className="label mb-0 text-blue-700">Date:</label>
            <input className="input w-40 bg-white" type="date"
              value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
            <button onClick={() => { setDateFilter(today) }}
              className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-3 py-1.5 rounded-lg font-medium">
              Today
            </button>
            <p className="text-xs text-blue-500 ml-auto">Showing appointments for {dateFilter || 'any date'}</p>
          </div>
        )}

        {/* Filters */}
        <div className="card p-3 mb-5 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <label className="label mb-0 text-xs">Status:</label>
            <select className="input text-xs py-1.5 w-36" value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}>
              <option value="all">All statuses</option>
              {(Object.keys(STATUS_CONFIG) as ApptStatus[]).map(s => (
                <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="label mb-0 text-xs">Type:</label>
            <select className="input text-xs py-1.5 w-44" value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              {APPT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <span className="ml-auto text-xs text-gray-400">{appts.length} appointment{appts.length !== 1 ? 's' : ''}</span>
        </div>

        {/* ── OT Schedule Section ────────────────────────────── */}
        {otSchedules.length > 0 && (
          <div className="mb-5 bg-purple-50 border border-purple-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-purple-800 flex items-center gap-2">
                <Scissors className="w-4 h-4" /> Upcoming OT Surgeries ({otSchedules.length})
              </h3>
              <Link href="/ot-schedule" className="text-xs text-purple-600 hover:underline font-medium">View Full Schedule →</Link>
            </div>
            <div className="space-y-2">
              {otSchedules.slice(0, 5).map(ot => (
                <div key={ot.id} className={`flex items-center gap-3 bg-white border rounded-lg p-3 ${
                  ot.surgery_date === today ? 'border-purple-300 shadow-sm' : 'border-gray-100'
                }`}>
                  <div className="text-center min-w-[52px]">
                    <div className="text-sm font-bold text-gray-800">{ot.start_time}</div>
                    <div className="text-xs text-gray-400">{ot.surgery_date === today ? 'Today' : formatDate(ot.surgery_date)}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-900">{ot.patient_name}</span>
                      <span className="text-xs text-gray-400">{ot.mrn}</span>
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                        ot.priority === 'emergency' ? 'bg-red-100 text-red-700' :
                        ot.priority === 'urgent' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>{ot.priority}</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">{ot.surgery_name} · {ot.ot_room} · Dr. {ot.surgeon}</div>
                  </div>
                  <Link href={`/patients/${ot.patient_id}`} className="text-xs text-blue-600 hover:underline">View</Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="card p-12 text-center text-gray-400">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-40" />
            <p className="text-sm">Loading appointments...</p>
          </div>
        ) : appts.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <Calendar className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="font-medium mb-1">No appointments yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {appts.map(appt => {
              const cfg = STATUS_CONFIG[appt.status]
              const isToday = appt.date === today
              const isPast = appt.date < today
              return (
                <div key={appt.id} className={`card p-4 flex items-center gap-4 ${isPast && appt.status === 'scheduled' ? 'border-orange-200 bg-orange-50/30' : ''}`}>
                  <div className="text-center min-w-[52px]">
                    <div className="text-lg font-bold text-gray-800 leading-none">{appt.time}</div>
                    {isToday ? (
                      <div className="text-xs text-blue-600 font-semibold">Today</div>
                    ) : (
                      <div className="text-xs text-gray-400">{formatDate(appt.date)}</div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{appt.patient_name}</span>
                      <span className="text-xs text-gray-400">{appt.mrn}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>
                      {appt.reminder_sent && (
                        <span className="text-xs text-green-600 flex items-center gap-0.5">
                          <CheckCircle className="w-3 h-3" /> Reminded
                        </span>
                      )}
                    </div>
                    {appt.notes && <div className="text-xs text-gray-400 mt-0.5 truncate">{appt.notes}</div>}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {appt.status === 'scheduled' && (
                      <>
                        <button onClick={() => updateStatus(appt.id, 'confirmed')}
                          className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded font-medium">Confirm</button>
                        <button onClick={() => updateStatus(appt.id, 'completed')}
                          className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-1 rounded font-medium">Done</button>
                        <button onClick={() => updateStatus(appt.id, 'no-show')}
                          className="text-xs bg-orange-50 text-orange-700 hover:bg-orange-100 px-2 py-1 rounded font-medium">No-show</button>
                      </>
                    )}

                    <button onClick={() => openReminder(appt)}
                      className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${appt.reminder_sent ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-green-500 text-white hover:bg-green-600 shadow-sm'
                        }`}>
                      <MessageCircle className="w-3.5 h-3.5" /> {appt.reminder_sent ? 'Re-send' : 'Remind'}
                    </button>

                    <Link href={`/opd/new?patient=${appt.patient_id}`} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Start consultation">
                      <Stethoscope className="w-4 h-4" />
                    </Link>

                    <Link href={`/patients/${appt.patient_id}`} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg" title="View patient">
                      <User className="w-4 h-4" />
                    </Link>

                    <button onClick={() => deleteAppt(appt.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg" title="Delete appointment">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default function AppointmentsPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </AppShell>
      }
    >
      <AppointmentsContent />
    </Suspense>
  )
}