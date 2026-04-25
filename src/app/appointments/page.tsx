'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings, isSunday } from '@/lib/utils'
import {
  Calendar, Plus, Search, X, Clock, CheckCircle,
  MessageCircle, Phone, ChevronRight, Trash2,
  AlertCircle, Stethoscope, User, RefreshCw, Loader2,
  UserCircle, BellRing,
} from 'lucide-react'

// ── Appointment types ─────────────────────────────────────────
type ApptStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no-show'

interface Appointment {
  id:            string
  patient_id:    string
  patient_name:  string
  mrn:           string
  mobile:        string
  date:          string   // YYYY-MM-DD
  time:          string   // HH:MM
  type:          string
  notes:         string
  status:        ApptStatus
  created_at:    string
  reminder_sent: boolean
}

const APPT_TYPES = [
  'ANC Follow-up',
  'OPD Consultation',
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
  scheduled: { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700',    dot: 'bg-blue-500'   },
  confirmed: { label: 'Confirmed', cls: 'bg-green-50 text-green-700',  dot: 'bg-green-500'  },
  completed: { label: 'Completed', cls: 'bg-gray-50 text-gray-600',    dot: 'bg-gray-400'   },
  cancelled: { label: 'Cancelled', cls: 'bg-red-50 text-red-700',      dot: 'bg-red-400'    },
  'no-show': { label: 'No Show',   cls: 'bg-orange-50 text-orange-700',dot: 'bg-orange-400' },
}

const TIME_SLOTS = Array.from({ length: 24 }, (_, h) =>
  [':00', ':15', ':30', ':45'].map(m => `${String(h).padStart(2, '0')}${m}`)
).flat().filter(t => t >= '08:00' && t <= '19:45')

export default function AppointmentsPage() {
  const [appts,        setAppts]        = useState<Appointment[]>([])
  const [loading,      setLoading]      = useState(true)
  const [view,         setView]         = useState<'list' | 'new' | 'reminder'>('list')
  const [dateFilter,   setDateFilter]   = useState(new Date().toISOString().split('T')[0])
  const [statusFilter, setStatusFilter] = useState<ApptStatus | 'all'>('all')

  // New appointment form
  const [patientQuery,   setPatientQuery]   = useState('')
  const [patientResults, setPatientResults] = useState<any[]>([])
  const [selPatient,     setSelPatient]     = useState<any>(null)
  const [apptDate,       setApptDate]       = useState(new Date().toISOString().split('T')[0])
  const [apptTime,       setApptTime]       = useState('09:00')
  const [apptType,       setApptType]       = useState(APPT_TYPES[0])
  const [apptNotes,      setApptNotes]      = useState('')
  const [saving,         setSaving]         = useState(false)
  const [saveError,      setSaveError]      = useState('')

  // Reminder state — now holds TWO messages (patient + doctor)
  const [reminderAppt,      setReminderAppt]      = useState<Appointment | null>(null)
  const [patientMsg,        setPatientMsg]        = useState('')
  const [doctorMsg,         setDoctorMsg]         = useState('')
  const [reminderLoading,   setReminderLoading]   = useState(false)
  const [copiedPatient,     setCopiedPatient]     = useState(false)
  const [copiedDoctor,      setCopiedDoctor]      = useState(false)
  const [activeTab,         setActiveTab]         = useState<'patient' | 'doctor'>('patient')

  const searchTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchParams = useSearchParams()
  const hs           = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  // ── Load appointments ──────────────────────────────────────
  const fetchAppts = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('appointments')
      .select('*')
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    if (dateFilter)               query = query.eq('date', dateFilter)
    if (statusFilter !== 'all')   query = query.eq('status', statusFilter)

    const { data, error } = await query
    if (error) { console.error('[Appointments] fetch error:', error.message); setAppts([]) }
    else        setAppts((data || []) as Appointment[])
    setLoading(false)
  }, [dateFilter, statusFilter])

  useEffect(() => { fetchAppts() }, [fetchAppts])

  // Summary counts
  const [todayCount,    setTodayCount]    = useState(0)
  const [upcomingCount, setUpcomingCount] = useState(0)

  useEffect(() => {
    const tod = new Date().toISOString().split('T')[0]
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('date', tod).neq('status', 'cancelled')
      .then(({ count }) => setTodayCount(count || 0))
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .gt('date', tod).eq('status', 'scheduled')
      .then(({ count }) => setUpcomingCount(count || 0))
  }, [appts])

  // Pre-fill patient from URL params
  useEffect(() => {
    const pid   = searchParams.get('patientId')
    const pname = searchParams.get('patientName')
    if (pid && pname && !selPatient) {
      setSelPatient({ id: pid, full_name: decodeURIComponent(pname), mrn: '', mobile: '', age: '' })
      setView('new')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // ── Patient search ─────────────────────────────────────────
  function searchPatients(q: string) {
    setPatientQuery(q); setSelPatient(null)
    if (q.trim().length < 2) { setPatientResults([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('patients')
        .select('id, full_name, mrn, mobile, age')
        .or(`full_name.ilike.%${q}%,mrn.ilike.%${q}%,mobile.ilike.%${q}%`).limit(6)
      setPatientResults(data || [])
    }, 300)
  }

  // ── Book appointment ───────────────────────────────────────
  async function bookAppointment() {
    if (!selPatient || !apptDate || !apptTime) return
    setSaving(true); setSaveError('')

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        patient_id:    selPatient.id,
        patient_name:  selPatient.full_name,
        mrn:           selPatient.mrn || '',
        mobile:        selPatient.mobile || '',
        date:          apptDate,
        time:          apptTime,
        type:          apptType,
        notes:         apptNotes.trim() || null,
        status:        'scheduled',
        reminder_sent: false,
      })
      .select()
      .single()

    setSaving(false)
    if (error) { setSaveError(`Failed to book: ${error.message}`); return }

    resetForm()
    setView('list')
    fetchAppts()
    if (data) openReminder(data as Appointment)
  }

  // ── Update status ──────────────────────────────────────────
  async function updateStatus(id: string, status: ApptStatus) {
    const { error } = await supabase
      .from('appointments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) setAppts(prev => prev.map(a => a.id === id ? { ...a, status } : a))
  }

  // ── Delete ─────────────────────────────────────────────────
  async function deleteAppt(id: string) {
    if (!confirm('Delete this appointment?')) return
    const { error } = await supabase.from('appointments').delete().eq('id', id)
    if (!error) setAppts(prev => prev.filter(a => a.id !== id))
  }

  // ── Open reminder — fetches full patient profile first ─────
  async function openReminder(appt: Appointment) {
    setReminderAppt(appt)
    setView('reminder')
    setReminderLoading(true)
    setActiveTab('patient')
    setCopiedPatient(false)
    setCopiedDoctor(false)

    const dateStr = new Date(appt.date).toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })

    // Calculate arrival time (30 min before appointment)
    const [hh, mm]    = appt.time.split(':').map(Number)
    const arrivalDate = new Date()
    arrivalDate.setHours(hh, mm - 30, 0, 0)
    if (arrivalDate.getMinutes() < 0) { arrivalDate.setHours(hh - 1, 60 + arrivalDate.getMinutes()) }
    const arrivalTime = arrivalDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

    // ── Fetch patient profile + last encounter + last prescription ──
    const [{ data: patient }, { data: lastEnc }, { data: lastRx }] = await Promise.all([
      supabase.from('patients').select('full_name, age, date_of_birth, gender, blood_group, aadhaar_no, abha_id, address, mediclaim, cashless, policy_tpa_name').eq('id', appt.patient_id).single(),
      supabase.from('encounters').select('encounter_date, encounter_type, diagnosis, chief_complaint, bp_systolic, bp_diastolic, pulse, weight, ob_data').eq('patient_id', appt.patient_id).order('encounter_date', { ascending: false }).limit(1).single(),
      supabase.from('prescriptions').select('medications, follow_up_date, advice, reports_needed').eq('patient_id', appt.patient_id).order('created_at', { ascending: false }).limit(1).single(),
    ])

    const p   = patient || {} as any
    const enc = lastEnc as any
    const rx  = lastRx  as any
    const ob  = enc?.ob_data as any

    // ── Build age string ───────────────────────────────────────
    let ageStr = ''
    if (p.date_of_birth) {
      const a = Math.floor((Date.now() - new Date(p.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      ageStr = `${a} years`
    } else if (p.age) {
      ageStr = `${p.age} years`
    }

    // ── Build last medications text ────────────────────────────
    const medsText = Array.isArray(rx?.medications)
      ? rx.medications.slice(0, 4).map((m: any) => `• ${m.drug} ${m.dose || ''} ${m.frequency || ''} ${m.duration || ''}`.trim()).join('\n')
      : ''

    // ── Build OB context (if ANC patient) ─────────────────────
    let obText = ''
    if (ob?.lmp) {
      const weeksGA = ob.gestational_age ||
        (() => {
          const diffMs = Date.now() - new Date(ob.lmp).getTime()
          const weeks  = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000))
          const days   = Math.floor((diffMs % (7 * 24 * 60 * 60 * 1000)) / (24 * 60 * 60 * 1000))
          return `${weeks} weeks ${days} days`
        })()
      obText = `\n🤰 *Obstetric:* G${ob.gravida || '?'}P${ob.para || '?'}A${ob.abortion || '0'}L${ob.living || '?'} · GA: ${weeksGA}${ob.edd ? '\n📅 *EDD:* ' + ob.edd : ''}`
    }

    // ═══════════════════════════════════════════════════════════
    // MESSAGE 1 — FOR PATIENT
    // ═══════════════════════════════════════════════════════════
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
${appt.patient_name} ji, ${apptType === 'ANC Follow-up' ? 'ANC' : ''} appointment ${dateStr} na ${appt.time} vage che. Krupa kari ${arrivalTime} sudhi aavo.

_${hs.hospitalName || 'NexMedicon Hospital'} — Caring for you_ 🙏`

    // ═══════════════════════════════════════════════════════════
    // MESSAGE 2 — FOR DOCTOR (patient profile summary)
    // ═══════════════════════════════════════════════════════════
    const dMsg =
`*${hs.hospitalName || 'NexMedicon Hospital'}*
*Patient Brief — Appointment Alert* 🩺

📅 *Date:* ${dateStr} at *${appt.time}*
🏥 *Visit Type:* ${appt.type}

━━━━━━━━━━━━━━━━
👤 *PATIENT PROFILE*
━━━━━━━━━━━━━━━━
*Name:* ${appt.patient_name}
*MRN:* ${appt.mrn}
${ageStr ? `*Age:* ${ageStr}` : ''}${p.gender ? `  |  *Gender:* ${p.gender}` : ''}
${p.blood_group ? `*Blood Group:* ${p.blood_group}` : ''}
*Mobile:* ${appt.mobile}
${p.abha_id ? `*ABHA ID:* ${p.abha_id}` : ''}${p.mediclaim ? `\n*Insurance:* ${p.cashless ? 'Cashless' : 'Mediclaim'}${p.policy_tpa_name ? ' — ' + p.policy_tpa_name : ''}` : ''}
${obText}
${enc ? `
━━━━━━━━━━━━━━━━
📋 *LAST VISIT* (${formatDate(enc.encounter_date)})
━━━━━━━━━━━━━━━━
*Type:* ${enc.encounter_type}
${enc.chief_complaint ? `*Complaint:* ${enc.chief_complaint}` : ''}
${enc.diagnosis ? `*Diagnosis:* ${enc.diagnosis}` : ''}
${enc.bp_systolic ? `*BP:* ${enc.bp_systolic}/${enc.bp_diastolic} mmHg` : ''}${enc.pulse ? `  |  *Pulse:* ${enc.pulse} bpm` : ''}
${enc.weight ? `*Weight:* ${enc.weight} kg` : ''}` : ''}
${medsText ? `
━━━━━━━━━━━━━━━━
💊 *CURRENT MEDICATIONS*
━━━━━━━━━━━━━━━━
${medsText}` : ''}
${rx?.advice ? `\n📝 *Last Advice:* ${rx.advice}` : ''}
${appt.notes ? `\n🔔 *Appointment Note:* ${appt.notes}` : ''}

━━━━━━━━━━━━━━━━
_NexMedicon HMS — Patient brief for ${appt.patient_name}_`

    setPatientMsg(pMsg)
    setDoctorMsg(dMsg)
    setReminderLoading(false)
  }

  function waLink(mobile: string, msg: string) {
    const num  = mobile?.replace(/\D/g, '')
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
    setApptDate(new Date().toISOString().split('T')[0])
    setApptTime('09:00'); setApptType(APPT_TYPES[0]); setApptNotes('')
    setSaveError('')
  }

  const today = new Date().toISOString().split('T')[0]

  // ═══════════════════════════════════════════════════════════════
  // REMINDER VIEW
  // ═══════════════════════════════════════════════════════════════
  if (view === 'reminder' && reminderAppt) {
    const doctorMobile = hs.phone?.replace(/\D/g, '') || ''
    const isDoctorWA   = doctorMobile.length >= 10

    return (
      <AppShell>
        <div className="p-6 max-w-2xl mx-auto">

          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => setView('list')} className="text-gray-400 hover:text-gray-700">
              <X className="w-5 h-5"/>
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <BellRing className="w-5 h-5 text-blue-600"/>
                WhatsApp Reminders
              </h1>
              <p className="text-xs text-gray-500">
                {reminderAppt.patient_name} · {reminderAppt.date} at {reminderAppt.time}
              </p>
            </div>
          </div>

          {reminderLoading ? (
            <div className="card p-16 text-center">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3"/>
              <p className="text-sm text-gray-500">Loading patient profile...</p>
            </div>
          ) : (
            <>
              {/* Tab switcher */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setActiveTab('patient')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all
                    ${activeTab === 'patient'
                      ? 'bg-green-600 text-white border-green-600 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'}`}>
                  <MessageCircle className="w-4 h-4"/>
                  Patient Message
                </button>
                <button
                  onClick={() => setActiveTab('doctor')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all
                    ${activeTab === 'doctor'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                  <Stethoscope className="w-4 h-4"/>
                  Doctor Brief
                </button>
              </div>

              {/* ── PATIENT MESSAGE ── */}
              {activeTab === 'patient' && (
                <div className="card p-5 mb-4">

                  {/* Patient chip */}
                  <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-100">
                    <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="font-bold text-green-700 text-sm">{reminderAppt.patient_name.charAt(0)}</span>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-sm">{reminderAppt.patient_name}</div>
                      <div className="text-xs text-gray-400">{reminderAppt.mrn} · {reminderAppt.mobile}</div>
                    </div>
                    <div className="ml-auto text-xs bg-green-50 text-green-700 font-semibold px-2 py-1 rounded-full border border-green-200">
                      To Patient
                    </div>
                  </div>

                  <label className="label">Message (editable)</label>
                  <textarea
                    className="input resize-none font-mono text-xs leading-relaxed"
                    rows={16}
                    value={patientMsg}
                    onChange={e => setPatientMsg(e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Includes appointment time, <strong>30-minute early arrival reminder</strong>, and documents to bring.
                  </p>

                  <div className="flex flex-col gap-2 mt-4">
                    <a
                      href={waLink(reminderAppt.mobile, patientMsg)}
                      target="_blank" rel="noopener noreferrer"
                      onClick={() => { markReminderSent(reminderAppt); setCopiedPatient(true) }}
                      className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition-colors text-sm">
                      <MessageCircle className="w-4 h-4"/>
                      Send to Patient via WhatsApp
                    </a>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(patientMsg)
                        setCopiedPatient(true)
                        markReminderSent(reminderAppt)
                        setTimeout(() => setCopiedPatient(false), 2500)
                      }}
                      className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-sm transition-colors">
                      {copiedPatient ? <CheckCircle className="w-4 h-4 text-green-500"/> : <MessageCircle className="w-4 h-4"/>}
                      {copiedPatient ? 'Copied!' : 'Copy Message'}
                    </button>
                    {reminderAppt.mobile && (
                      <a href={`tel:${reminderAppt.mobile}`}
                        className="flex items-center justify-center gap-2 text-blue-600 hover:underline text-sm font-medium py-1">
                        <Phone className="w-4 h-4"/> Call {reminderAppt.patient_name} ({reminderAppt.mobile})
                      </a>
                    )}
                  </div>

                  {reminderAppt.reminder_sent && (
                    <p className="text-center text-xs text-green-600 mt-3 flex items-center justify-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5"/> Reminder marked as sent
                    </p>
                  )}
                </div>
              )}

              {/* ── DOCTOR BRIEF ── */}
              {activeTab === 'doctor' && (
                <div className="card p-5 mb-4">

                  {/* Doctor chip */}
                  <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-100">
                    <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Stethoscope className="w-4 h-4 text-blue-600"/>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-sm">{hs.doctorName || 'Doctor'}</div>
                      <div className="text-xs text-gray-400">
                        {isDoctorWA
                          ? `Send to: ${hs.phone}`
                          : 'Add doctor\'s phone in Settings to enable WhatsApp send'}
                      </div>
                    </div>
                    <div className="ml-auto text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-1 rounded-full border border-blue-200">
                      To Doctor
                    </div>
                  </div>

                  <div className="mb-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700 flex items-center gap-2">
                    <UserCircle className="w-4 h-4 flex-shrink-0"/>
                    This message gives the doctor a full patient brief before the appointment — profile, last visit, current medications, and OB data.
                  </div>

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
                        className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors text-sm">
                        <MessageCircle className="w-4 h-4"/>
                        Send Patient Brief to Doctor via WhatsApp
                      </a>
                    ) : (
                      <div className="text-center text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-xl py-3">
                        ⚙️ Add doctor&apos;s phone number in{' '}
                        <Link href="/settings" className="text-blue-600 underline">Settings</Link>{' '}
                        to enable direct WhatsApp send to doctor.
                      </div>
                    )}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(doctorMsg)
                        setCopiedDoctor(true)
                        setTimeout(() => setCopiedDoctor(false), 2500)
                      }}
                      className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-sm transition-colors">
                      {copiedDoctor ? <CheckCircle className="w-4 h-4 text-green-500"/> : <MessageCircle className="w-4 h-4"/>}
                      {copiedDoctor ? 'Copied!' : 'Copy Doctor Brief'}
                    </button>
                  </div>
                </div>
              )}

              {/* Quick switch hint */}
              <p className="text-center text-xs text-gray-400">
                Switch between tabs to send both messages —
                <button onClick={() => setActiveTab(activeTab === 'patient' ? 'doctor' : 'patient')}
                  className="text-blue-500 underline ml-1">
                  {activeTab === 'patient' ? 'Switch to Doctor Brief →' : '← Switch to Patient Message'}
                </button>
              </p>
            </>
          )}
        </div>
      </AppShell>
    )
  }

  // ═══════════════════════════════════════════════════════════════
  // NEW APPOINTMENT VIEW
  // ═══════════════════════════════════════════════════════════════
  if (view === 'new') {
    return (
      <AppShell>
        <div className="p-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => { resetForm(); setView('list') }} className="text-gray-400 hover:text-gray-700">
              <X className="w-5 h-5"/>
            </button>
            <h1 className="text-xl font-bold text-gray-900">Book Appointment</h1>
          </div>

          {saveError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5"/>
              <span>{saveError}</span>
            </div>
          )}

          {/* Patient */}
          <div className="card p-5 mb-4">
            <h2 className="section-title">Patient</h2>
            {selPatient ? (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <div>
                  <div className="font-semibold text-gray-900">{selPatient.full_name}</div>
                  <div className="text-xs text-gray-500">{selPatient.mrn} · {selPatient.mobile}</div>
                </div>
                <button onClick={() => { setSelPatient(null); setPatientQuery('') }}>
                  <X className="w-4 h-4 text-gray-400 hover:text-red-500"/>
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
                <input className="input pl-9" placeholder="Search patient by name, MRN, or mobile…" autoFocus
                  value={patientQuery} onChange={e => searchPatients(e.target.value)}/>
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

          {/* Date, time, type */}
          <div className="card p-5 mb-4">
            <h2 className="section-title">Appointment Details</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="label">Date</label>
                <input className="input" type="date" min={today}
                  value={apptDate} onChange={e => setApptDate(e.target.value)}/>
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
                  value={apptNotes} onChange={e => setApptNotes(e.target.value)}/>
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => { resetForm(); setView('list') }} className="btn-secondary">Cancel</button>
            <button onClick={bookAppointment}
              disabled={saving || !selPatient || !apptDate || !apptTime}
              className="btn-primary flex items-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Calendar className="w-4 h-4"/>}
              {saving ? 'Booking…' : 'Book & Generate Reminder'}
            </button>
          </div>
        </div>
      </AppShell>
    )
  }

  // ═══════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════
  return (
    <AppShell>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-blue-600"/> Appointments
            </h1>
            <p className="text-sm text-gray-500">
              {todayCount} today · {upcomingCount} upcoming
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={fetchAppts} className="btn-secondary flex items-center gap-1.5 text-xs">
              <RefreshCw className="w-3.5 h-3.5"/> Refresh
            </button>
            <button onClick={() => { resetForm(); setView('new') }}
              className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4"/> Book Appointment
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="card p-4 mb-5 flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Date</label>
            <div className="flex gap-2">
              <input className="input w-40" type="date"
                value={dateFilter} onChange={e => setDateFilter(e.target.value)}/>
              <button onClick={() => setDateFilter(today)}
                className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-2 rounded-lg font-medium">
                Today
              </button>
              <button onClick={() => setDateFilter('')}
                className="text-xs bg-gray-50 text-gray-600 hover:bg-gray-100 px-3 py-2 rounded-lg font-medium">
                All dates
              </button>
            </div>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input w-36" value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}>
              <option value="all">All statuses</option>
              {(Object.keys(STATUS_CONFIG) as ApptStatus[]).map(s => (
                <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="card p-12 text-center text-gray-400">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-40"/>
            <p className="text-sm">Loading appointments...</p>
          </div>
        ) : appts.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <Calendar className="w-12 h-12 mx-auto mb-4 opacity-20"/>
            <p className="font-medium mb-1">
              {dateFilter || statusFilter !== 'all' ? 'No appointments match this filter' : 'No appointments yet'}
            </p>
            <button onClick={() => { resetForm(); setView('new') }}
              className="btn-primary inline-flex items-center gap-2 text-xs mt-3">
              <Plus className="w-3.5 h-3.5"/> Book First Appointment
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {appts.map(appt => {
              const cfg     = STATUS_CONFIG[appt.status]
              const isToday = appt.date === today
              const isPast  = appt.date < today
              return (
                <div key={appt.id}
                  className={`card p-4 flex items-center gap-4 ${isPast && appt.status === 'scheduled' ? 'border-orange-200 bg-orange-50/30' : ''}`}>

                  {/* Time block */}
                  <div className="text-center min-w-[52px]">
                    <div className="text-lg font-bold text-gray-800 leading-none">{appt.time}</div>
                    {isToday
                      ? <div className="text-xs text-blue-600 font-semibold">Today</div>
                      : <div className="text-xs text-gray-400">{formatDate(appt.date)}</div>}
                  </div>

                  {/* Patient info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{appt.patient_name}</span>
                      <span className="text-xs text-gray-400">{appt.mrn}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>
                      {appt.reminder_sent && (
                        <span className="text-xs text-green-600 flex items-center gap-0.5">
                          <CheckCircle className="w-3 h-3"/> Reminded
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">{appt.type}</div>
                    {appt.notes && <div className="text-xs text-gray-400 mt-0.5 truncate">{appt.notes}</div>}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {appt.status === 'scheduled' && (
                      <>
                        <button onClick={() => updateStatus(appt.id, 'confirmed')}
                          className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded font-medium">
                          Confirm
                        </button>
                        <button onClick={() => updateStatus(appt.id, 'completed')}
                          className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-1 rounded font-medium">
                          Done
                        </button>
                        <button onClick={() => updateStatus(appt.id, 'no-show')}
                          className="text-xs bg-orange-50 text-orange-700 hover:bg-orange-100 px-2 py-1 rounded font-medium">
                          No-show
                        </button>
                      </>
                    )}
                    {appt.status === 'confirmed' && (
                      <button onClick={() => updateStatus(appt.id, 'completed')}
                        className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-1 rounded font-medium">
                        Mark Done
                      </button>
                    )}
                    {/* Send Reminder button — prominent green */}
                    <button
                      onClick={() => openReminder(appt)}
                      className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                        appt.reminder_sent
                          ? 'bg-green-50 text-green-600 hover:bg-green-100'
                          : 'bg-green-500 text-white hover:bg-green-600 shadow-sm'
                      }`}
                      title="Send WhatsApp reminder to patient & doctor brief">
                      <MessageCircle className="w-3.5 h-3.5"/>
                      {appt.reminder_sent ? 'Re-send' : 'Remind'}
                    </button>
                    {/* Start consultation */}
                    <Link href={`/opd/new?patient=${appt.patient_id}`}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="Start consultation">
                      <Stethoscope className="w-4 h-4"/>
                    </Link>
                    {/* View patient */}
                    <Link href={`/patients/${appt.patient_id}`}
                      className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"
                      title="View patient">
                      <User className="w-4 h-4"/>
                    </Link>
                    {/* Delete */}
                    <button onClick={() => deleteAppt(appt.id)}
                      className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg"
                      title="Delete appointment">
                      <Trash2 className="w-4 h-4"/>
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