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
  AlertCircle, Stethoscope, User, RefreshCw, Loader2
} from 'lucide-react'

// ── Appointment types ────────────────────────────────────────
type ApptStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no-show'

interface Appointment {
  id:           string
  patient_id:   string
  patient_name: string
  mrn:          string
  mobile:       string
  date:         string   // YYYY-MM-DD
  time:         string   // HH:MM
  type:         string
  notes:        string
  status:       ApptStatus
  created_at:   string
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

const STATUS_CONFIG: Record<ApptStatus, { label:string; cls:string; dot:string }> = {
  scheduled:  { label:'Scheduled',  cls:'bg-blue-50 text-blue-700',    dot:'bg-blue-500'   },
  confirmed:  { label:'Confirmed',  cls:'bg-green-50 text-green-700',  dot:'bg-green-500'  },
  completed:  { label:'Completed',  cls:'bg-gray-50 text-gray-600',    dot:'bg-gray-400'   },
  cancelled:  { label:'Cancelled',  cls:'bg-red-50 text-red-700',      dot:'bg-red-400'    },
  'no-show':  { label:'No Show',    cls:'bg-orange-50 text-orange-700',dot:'bg-orange-400' },
}

const TIME_SLOTS = Array.from({length:24}, (_,h) =>
  [':00',':15',':30',':45'].map(m => `${String(h).padStart(2,'0')}${m}`)
).flat().filter(t => t >= '08:00' && t <= '19:45')

export default function AppointmentsPage() {
  const [appts,       setAppts]       = useState<Appointment[]>([])
  const [loading,     setLoading]     = useState(true)
  const [view,        setView]        = useState<'list'|'new'|'reminder'>('list')
  const [dateFilter,  setDateFilter]  = useState(new Date().toISOString().split('T')[0])
  const [statusFilter,setStatusFilter]= useState<ApptStatus|'all'>('all')

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

  // WhatsApp reminder
  const [reminderAppt,   setReminderAppt]   = useState<Appointment|null>(null)
  const [reminderMsg,    setReminderMsg]     = useState('')
  const [copied,         setCopied]          = useState(false)

  const searchParams = useSearchParams()
  const searchTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  // ── Load appointments from Supabase ────────────────────────
  const fetchAppts = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('appointments')
      .select('*')
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    // Apply date filter if set
    if (dateFilter) {
      query = query.eq('date', dateFilter)
    }

    // Apply status filter if set
    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    const { data, error } = await query

    if (error) {
      console.error('[Appointments] fetch error:', error.message)
      setAppts([])
    } else {
      setAppts((data || []) as Appointment[])
    }
    setLoading(false)
  }, [dateFilter, statusFilter])

  useEffect(() => { fetchAppts() }, [fetchAppts])

  // ── Load all appointments for counts (unfiltered) ──────────
  const [todayCount,    setTodayCount]    = useState(0)
  const [upcomingCount, setUpcomingCount] = useState(0)

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    // Today's count
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('date', today)
      .neq('status', 'cancelled')
      .then(({ count }) => setTodayCount(count || 0))

    // Upcoming count
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .gt('date', today)
      .eq('status', 'scheduled')
      .then(({ count }) => setUpcomingCount(count || 0))
  }, [appts]) // re-count when appts change

  // ── Handle URL params (from patient page) ──────────────────
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

  // ── Book appointment (Supabase insert) ─────────────────────
  async function bookAppointment() {
    if (!selPatient || !apptDate || !apptTime) return
    setSaving(true)
    setSaveError('')

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        patient_id:   selPatient.id,
        patient_name: selPatient.full_name,
        mrn:          selPatient.mrn || '',
        mobile:       selPatient.mobile || '',
        date:         apptDate,
        time:         apptTime,
        type:         apptType,
        notes:        apptNotes.trim() || null,
        status:       'scheduled',
        reminder_sent: false,
      })
      .select()
      .single()

    setSaving(false)

    if (error) {
      setSaveError(`Failed to book: ${error.message}`)
      return
    }

    resetForm()
    setView('list')
    fetchAppts()
    // Generate reminder for the new appointment
    if (data) openReminder(data as Appointment)
  }

  // ── Update status (Supabase update) ────────────────────────
  async function updateStatus(id: string, status: ApptStatus) {
    const { error } = await supabase
      .from('appointments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (!error) {
      setAppts(prev => prev.map(a => a.id === id ? { ...a, status } : a))
    }
  }

  // ── Delete appointment (Supabase delete) ───────────────────
  async function deleteAppt(id: string) {
    if (!confirm('Delete this appointment?')) return
    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', id)

    if (!error) {
      setAppts(prev => prev.filter(a => a.id !== id))
    }
  }

  // ── WhatsApp reminder ──────────────────────────────────────
  function openReminder(appt: Appointment) {
    const dateStr = new Date(appt.date).toLocaleDateString('en-IN', {weekday:'long', day:'numeric', month:'long'})
    const msg = `*${hs.hospitalName || 'NexMedicon Hospital'}*\n\nNamaste ${appt.patient_name} ji 🙏\n\nThis is a reminder for your appointment:\n\n📅 *Date:* ${dateStr}\n🕐 *Time:* ${appt.time}\n🏥 *Visit Type:* ${appt.type}\n📍 *Address:* ${hs.address || 'Hospital address'}\n\nPlease bring any previous reports and arrive 10 minutes early.\n\nFor queries call: ${hs.phone || 'our helpdesk'}\n\n_${hs.hospitalName || 'NexMedicon Hospital'} — Caring for you_`
    setReminderMsg(msg)
    setReminderAppt(appt)
    setView('reminder')
  }

  async function copyMsg() {
    navigator.clipboard.writeText(reminderMsg)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
    if (reminderAppt) {
      // Mark reminder as sent in database
      await supabase
        .from('appointments')
        .update({ reminder_sent: true, updated_at: new Date().toISOString() })
        .eq('id', reminderAppt.id)
      setAppts(prev => prev.map(a => a.id === reminderAppt.id ? { ...a, reminder_sent: true } : a))
    }
  }

  function whatsAppLink() {
    const num = reminderAppt?.mobile?.replace(/\D/g,'')
    const full = num?.length === 10 ? '91' + num : num
    return `https://wa.me/${full}?text=${encodeURIComponent(reminderMsg)}`
  }

  function resetForm() {
    setSelPatient(null); setPatientQuery(''); setPatientResults([])
    setApptDate(new Date().toISOString().split('T')[0])
    setApptTime('09:00'); setApptType(APPT_TYPES[0]); setApptNotes('')
    setSaveError('')
  }

  const today = new Date().toISOString().split('T')[0]

  // ── REMINDER VIEW ──────────────────────────────────────────
  if (view === 'reminder' && reminderAppt) {
    return (
      <AppShell>
        <div className="p-6 max-w-xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => setView('list')} className="text-gray-400 hover:text-gray-700">
              <X className="w-5 h-5"/>
            </button>
            <h1 className="text-xl font-bold text-gray-900">WhatsApp Reminder</h1>
          </div>

          <div className="card p-5 mb-4">
            <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-100">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-green-600"/>
              </div>
              <div>
                <div className="font-semibold text-gray-900">{reminderAppt.patient_name}</div>
                <div className="text-xs text-gray-500">{reminderAppt.mrn} · {reminderAppt.mobile}</div>
              </div>
            </div>

            <label className="label">Message Preview</label>
            <textarea
              className="input resize-none font-mono text-xs leading-relaxed"
              rows={14}
              value={reminderMsg}
              onChange={e => setReminderMsg(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">You can edit this message before sending.</p>
          </div>

          <div className="flex flex-col gap-3">
            <a href={whatsAppLink()} target="_blank" rel="noopener noreferrer"
              onClick={copyMsg}
              className="flex items-center justify-center gap-3 bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-xl transition-colors text-sm">
              <MessageCircle className="w-5 h-5"/>
              Open in WhatsApp & Send
            </a>
            <button onClick={copyMsg}
              className="flex items-center justify-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 px-6 rounded-xl transition-colors text-sm">
              {copied ? <CheckCircle className="w-4 h-4 text-green-500"/> : <MessageCircle className="w-4 h-4"/>}
              {copied ? 'Copied! Paste in any app' : 'Copy Message Text'}
            </button>
            {reminderAppt.mobile && (
              <a href={`tel:${reminderAppt.mobile}`}
                className="flex items-center justify-center gap-2 text-blue-600 hover:underline text-sm font-medium py-2">
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
      </AppShell>
    )
  }

  // ── NEW APPOINTMENT VIEW ───────────────────────────────────
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

  // ── LIST VIEW ──────────────────────────────────────────────
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
            <button onClick={fetchAppts}
              className="btn-secondary flex items-center gap-1.5 text-xs">
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

        {/* Loading state */}
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
              const cfg = STATUS_CONFIG[appt.status]
              const isToday = appt.date === today
              const isPast  = appt.date < today
              return (
                <div key={appt.id}
                  className={`card p-4 flex items-center gap-4 ${isPast && appt.status==='scheduled' ? 'border-orange-200 bg-orange-50/30' : ''}`}>
                  {/* Time */}
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
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>
                        {cfg.label}
                      </span>
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
                    {/* Status quick-change */}
                    {appt.status === 'scheduled' && (
                      <>
                        <button onClick={() => updateStatus(appt.id,'confirmed')}
                          className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded font-medium">
                          Confirm
                        </button>
                        <button onClick={() => updateStatus(appt.id,'completed')}
                          className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-1 rounded font-medium">
                          Done
                        </button>
                        <button onClick={() => updateStatus(appt.id,'no-show')}
                          className="text-xs bg-orange-50 text-orange-700 hover:bg-orange-100 px-2 py-1 rounded font-medium">
                          No-show
                        </button>
                      </>
                    )}
                    {appt.status === 'confirmed' && (
                      <button onClick={() => updateStatus(appt.id,'completed')}
                        className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-1 rounded font-medium">
                        Mark Done
                      </button>
                    )}
                    {/* WhatsApp reminder */}
                    <button onClick={() => openReminder(appt)}
                      className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"
                      title="Send WhatsApp reminder">
                      <MessageCircle className="w-4 h-4"/>
                    </button>
                    {/* Go to consultation */}
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
