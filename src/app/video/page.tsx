'use client'
/**
 * src/app/video/page.tsx  — UPDATED
 *
 * Changes vs original:
 *  1. Embedded Jitsi iframe — doctor can join the call directly in-app
 *     instead of being redirected to a new tab. A "floating" call panel
 *     shows the Jitsi frame side-by-side with patient info.
 *  2. Live slot status — realtime subscription updates the table without
 *     a manual Refresh click (Supabase Realtime on 'appointments').
 *  3. WhatsApp message includes the direct Jitsi link (not just the portal).
 *  4. "Join Now" button triggers the in-app iframe; "Copy Link" copies
 *     the shareable Jitsi URL.
 *  5. Patient search added to the Create Slots form so staff can
 *     immediately attach a patient to an open slot.
 *  6. Status badges (open / booked / completed / missed) added to table rows.
 *  7. Mark-as-completed button for doctor to close out a call.
 *  8. All existing slot creation & deletion logic preserved unchanged.
 */

import { useEffect, useState, useRef } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import {
  Video, Plus, Calendar, Clock, Users, CheckCircle,
  ExternalLink, MessageCircle, Trash2, RefreshCw, Copy,
  Phone, PhoneOff, X, Search, Maximize2, Minimize2,
} from 'lucide-react'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.vercel.app'

// ── Helpers ────────────────────────────────────────────────────

function generateJitsiLink(roomName: string) {
  return `https://meet.jit.si/nexmedicon-${roomName}`
}

function generateRoomName() {
  return Math.random().toString(36).slice(2, 10).toUpperCase()
}

async function generatePortalToken(mrn: string): Promise<string> {
  const token     = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await supabase.from('portal_tokens').insert({ mrn, token, expires_at: expiresAt, is_used: false })
  return token
}

type Slot = {
  id:          string
  type:        string
  status:      string
  date:        string
  time:        string
  doctor_name: string
  patient_name?: string
  mrn?:         string
  mobile?:      string
  video_link?:  string
  notes?:       string
}

type StatusBadge = { label: string; cls: string }
function statusBadge(status: string): StatusBadge {
  const map: Record<string, StatusBadge> = {
    open:      { label: 'Open',      cls: 'bg-green-100 text-green-700' },
    video:     { label: 'Booked',    cls: 'bg-blue-100 text-blue-700' },
    completed: { label: 'Completed', cls: 'bg-gray-100 text-gray-500' },
    missed:    { label: 'Missed',    cls: 'bg-red-100 text-red-600' },
  }
  return map[status] ?? { label: status, cls: 'bg-yellow-100 text-yellow-700' }
}

// ── Component ──────────────────────────────────────────────────

export default function VideoConsultPage() {
  const { user, can }  = useAuth()
  const hs             = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  const [appointments, setAppointments] = useState<Slot[]>([])
  const [doctors,      setDoctors]      = useState<any[]>([])
  const [loading,      setLoading]      = useState(true)
  const [showCreate,   setShowCreate]   = useState(false)
  const [copied,       setCopied]       = useState<string | null>(null)

  // In-app call panel
  const [activeCall,    setActiveCall]    = useState<Slot | null>(null)
  const [callMinimized, setCallMinimized] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Patient search in create form
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<any[]>([])
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null)

  const [form, setForm] = useState({
    date:         new Date().toISOString().split('T')[0],
    time:         '10:00',
    doctor_name:  '',
    duration_min: '15',
    slots_count:  '1',
    notes:        '',
  })
  const [creating, setCreating] = useState(false)

  // ── Load data ───────────────────────────────────────────────
  useEffect(() => {
    loadData()
  }, [])

  // ── Realtime subscription ───────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('video-appointments')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments', filter: 'type=eq.video' },
        () => { loadData() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function loadData() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const [apptRes, docRes] = await Promise.all([
      supabase
        .from('appointments')
        .select('*')
        .eq('type', 'video')
        .gte('date', today)
        .order('date').order('time'),
      supabase
        .from('clinic_users')
        .select('id, full_name')
        .eq('is_active', true)
        .in('role', ['admin', 'doctor']),
    ])
    setAppointments(apptRes.data ?? [])
    setDoctors(docRes.data ?? [])
    setLoading(false)
    if (user?.full_name && !form.doctor_name) {
      setForm(p => ({ ...p, doctor_name: user.full_name }))
    }
  }

  // ── Patient search ──────────────────────────────────────────
  useEffect(() => {
    if (patientSearch.length < 2) { setPatientResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, mrn, phone')
        .or(`full_name.ilike.%${patientSearch}%,mrn.ilike.%${patientSearch}%,phone.ilike.%${patientSearch}%`)
        .limit(5)
      setPatientResults(data ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [patientSearch])

  // ── Create slots ────────────────────────────────────────────
  async function createSlots() {
    setCreating(true)
    const count = parseInt(form.slots_count) || 1

    const rows = Array.from({ length: count }, (_, i) => {
      const baseMin  = parseInt(form.time.split(':')[0]) * 60 + parseInt(form.time.split(':')[1])
      const slotMin  = baseMin + i * (parseInt(form.duration_min) || 15)
      const hh = String(Math.floor(slotMin / 60) % 24).padStart(2, '0')
      const mm = String(slotMin % 60).padStart(2, '0')
      return {
        type:         'video',
        status:       selectedPatient ? 'video' : 'open',
        date:         form.date,
        time:         `${hh}:${mm}`,
        doctor_name:  form.doctor_name,
        notes:        form.notes || null,
        video_link:   generateJitsiLink(generateRoomName()),
        // Attach patient if pre-selected
        ...(selectedPatient && i === 0 ? {
          patient_name: selectedPatient.full_name,
          mrn:          selectedPatient.mrn,
          mobile:       selectedPatient.phone,
        } : {}),
      }
    })

    await supabase.from('appointments').insert(rows)
    setShowCreate(false)
    setSelectedPatient(null)
    setPatientSearch('')
    await loadData()
    setCreating(false)
  }

  async function deleteSlot(id: string) {
    if (!confirm('Delete this slot?')) return
    await supabase.from('appointments').delete().eq('id', id)
    await loadData()
  }

  async function markCompleted(id: string) {
    await supabase.from('appointments').update({ status: 'completed' }).eq('id', id)
    await loadData()
    if (activeCall?.id === id) setActiveCall(null)
  }

  // ── Join call (in-app iframe) ───────────────────────────────
  function joinCall(slot: Slot) {
    setActiveCall(slot)
    setCallMinimized(false)
  }

  function endCall() {
    setActiveCall(null)
  }

  // ── Copy video link ─────────────────────────────────────────
  function copyLink(link: string, id: string) {
    navigator.clipboard.writeText(link).catch(() => {})
    setCopied(id)
    setTimeout(() => setCopied(null), 2500)
  }

  // ── Send WhatsApp ───────────────────────────────────────────
  async function sendWhatsApp(appt: Slot) {
    if (!appt.mobile) { alert('No mobile number on this appointment.'); return }
    const link    = appt.video_link ?? ''
    const message =
      `Namaste ${appt.patient_name} ji,\n\n` +
      `Your video consultation is scheduled for ${formatDate(appt.date)} at ${appt.time} ` +
      `with Dr. ${appt.doctor_name}.\n\n` +
      `▶ Join the video call:\n${link}\n\n` +
      `Please join 5 minutes early. No app download required.\n\n` +
      `— ${hs.hospitalName || 'Hospital'}`
    const waUrl = `https://wa.me/91${appt.mobile.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(message)}`
    window.open(waUrl, '_blank')
  }

  // ── Derived lists ───────────────────────────────────────────
  const openSlots   = appointments.filter(a => a.status === 'open')
  const bookedSlots = appointments.filter(a => ['video', 'booked'].includes(a.status) && a.patient_name)
  const todayStr    = new Date().toISOString().split('T')[0]
  const todayBooked = bookedSlots.filter(a => a.date === todayStr)

  // ── Render ──────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Video className="w-6 h-6 text-blue-500" /> Video Consultations
            </h1>
            <p className="text-sm text-gray-500">
              Create slots · Join calls in-app · Send links via WhatsApp · Live updates
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={loadData} disabled={loading}
              className="btn-secondary flex items-center gap-2 text-xs">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            {can('encounters.create') && (
              <button onClick={() => setShowCreate(!showCreate)}
                className="btn-primary flex items-center gap-2 text-xs">
                <Plus className="w-3.5 h-3.5" /> Create Slots
              </button>
            )}
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Today's Video", value: todayBooked.length, sub: 'booked today',    icon: Video,    cls: 'bg-blue-50 text-blue-700' },
            { label: 'Open Slots',    value: openSlots.length,   sub: 'available',       icon: Calendar, cls: 'bg-green-50 text-green-700' },
            { label: 'Total Booked',  value: bookedSlots.length, sub: 'upcoming + today', icon: Users,   cls: 'bg-purple-50 text-purple-700' },
          ].map(({ label, value, sub, icon: Icon, cls }) => (
            <div key={label} className={`card p-4 ${cls.split(' ')[1]}`}>
              <div className={`text-3xl font-bold ${cls.split(' ')[0]} mb-1`}>{value}</div>
              <div className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                <Icon className="w-3.5 h-3.5" />{label}
              </div>
              <div className="text-xs text-gray-400">{sub}</div>
            </div>
          ))}
        </div>

        {/* ── In-app call panel ──────────────────────────────── */}
        {activeCall && (
          <div className={`mb-6 rounded-2xl overflow-hidden border-2 border-blue-400 shadow-xl transition-all ${callMinimized ? 'h-14' : 'h-[520px]'}`}>
            {/* Call toolbar */}
            <div className="flex items-center justify-between bg-blue-700 text-white px-4 py-2.5 h-14">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Video className="w-4 h-4 text-blue-200" />
                <span>Call with {activeCall.patient_name || 'Patient'}</span>
                <span className="text-blue-300 font-normal text-xs">· Dr. {activeCall.doctor_name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setCallMinimized(!callMinimized)}
                  className="p-1.5 hover:bg-blue-600 rounded text-blue-200 hover:text-white transition-colors"
                  title={callMinimized ? 'Expand' : 'Minimize'}>
                  {callMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
                </button>
                {activeCall.video_link && (
                  <a href={activeCall.video_link} target="_blank" rel="noopener noreferrer"
                    className="p-1.5 hover:bg-blue-600 rounded text-blue-200 hover:text-white transition-colors"
                    title="Open in new tab">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                <button onClick={() => markCompleted(activeCall.id)}
                  className="px-2.5 py-1 bg-green-600 hover:bg-green-700 rounded text-xs font-semibold flex items-center gap-1 transition-colors">
                  <CheckCircle className="w-3.5 h-3.5" /> Done
                </button>
                <button onClick={endCall}
                  className="p-1.5 bg-red-600 hover:bg-red-700 rounded transition-colors"
                  title="Close call panel">
                  <PhoneOff className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Jitsi iframe — only rendered when expanded */}
            {!callMinimized && activeCall.video_link && (
              <iframe
                ref={iframeRef}
                src={activeCall.video_link}
                allow="camera; microphone; fullscreen; display-capture"
                className="w-full"
                style={{ height: 'calc(520px - 56px)', border: 'none' }}
                title="Video Consultation"
              />
            )}
          </div>
        )}

        {/* ── Create slots form ──────────────────────────────── */}
        {showCreate && (
          <div className="card p-5 mb-6 border-l-4 border-blue-400">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 text-blue-500" /> Create Video Slots
            </h3>

            {/* Patient search (optional) */}
            <div className="mb-4">
              <label className="label">Attach Patient (optional)</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input className="input pl-9" placeholder="Search by name, MRN, or phone…"
                  value={patientSearch}
                  onChange={e => { setPatientSearch(e.target.value); setSelectedPatient(null) }} />
              </div>
              {patientResults.length > 0 && !selectedPatient && (
                <div className="border border-gray-200 rounded-lg shadow-sm mt-1 bg-white z-10 overflow-hidden">
                  {patientResults.map(p => (
                    <button key={p.id} onClick={() => { setSelectedPatient(p); setPatientSearch(p.full_name); setPatientResults([]) }}
                      className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm flex items-center gap-2 border-b last:border-0">
                      <span className="font-medium text-gray-900">{p.full_name}</span>
                      <span className="text-gray-400 text-xs">MRN: {p.mrn}</span>
                      <span className="text-gray-400 text-xs ml-auto">{p.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedPatient && (
                <div className="mt-1.5 flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-1.5">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Attached: <strong>{selectedPatient.full_name}</strong> (MRN: {selectedPatient.mrn})</span>
                  <button onClick={() => { setSelectedPatient(null); setPatientSearch('') }}
                    className="ml-auto text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className="label">Date</label>
                <input className="input" type="date" value={form.date}
                  onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
              </div>
              <div>
                <label className="label">Start Time</label>
                <input className="input" type="time" value={form.time}
                  onChange={e => setForm(p => ({ ...p, time: e.target.value }))} />
              </div>
              <div>
                <label className="label">Doctor</label>
                <select className="input" value={form.doctor_name}
                  onChange={e => setForm(p => ({ ...p, doctor_name: e.target.value }))}>
                  <option value="">— Select —</option>
                  {doctors.map(d => <option key={d.id} value={d.full_name}>{d.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Duration (min)</label>
                <select className="input" value={form.duration_min}
                  onChange={e => setForm(p => ({ ...p, duration_min: e.target.value }))}>
                  {['10', '15', '20', '30', '45', '60'].map(d => <option key={d} value={d}>{d} min</option>)}
                </select>
              </div>
              <div>
                <label className="label">No. of Slots</label>
                <select className="input" value={form.slots_count}
                  onChange={e => setForm(p => ({ ...p, slots_count: e.target.value }))}>
                  {['1', '2', '3', '4', '5', '6', '8', '10'].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <input className="input" placeholder="e.g. Follow-up only"
                  value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <div className="text-xs text-gray-500 mb-3">
              ℹ️ {form.slots_count} slot(s) of {form.duration_min} min each starting at {form.time}.
              Each slot gets a unique Jitsi video link.
              {selectedPatient && ' First slot will be pre-booked for the selected patient.'}
            </div>
            <div className="flex gap-3">
              <button onClick={createSlots} disabled={creating || !form.doctor_name}
                className="btn-primary flex items-center gap-2 text-xs disabled:opacity-60">
                {creating
                  ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Plus className="w-3.5 h-3.5" />}
                {creating ? 'Creating…' : 'Create Slots'}
              </button>
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* ── Booked Video Appointments ──────────────────────── */}
        {bookedSlots.length > 0 && (
          <div className="card overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-gray-100 bg-blue-50 flex items-center justify-between">
              <h2 className="font-semibold text-blue-900 flex items-center gap-2">
                <Users className="w-4 h-4" /> Booked Video Appointments ({bookedSlots.length})
              </h2>
              <span className="text-xs text-blue-600 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" /> Live
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  {['Date / Time', 'Patient', 'Doctor', 'Status', 'Video', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookedSlots.map(appt => {
                  const badge  = statusBadge(appt.status)
                  const isActive = activeCall?.id === appt.id
                  return (
                    <tr key={appt.id} className={`border-b border-gray-50 hover:bg-gray-50 ${isActive ? 'bg-blue-50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{formatDate(appt.date)}</div>
                        <div className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />{appt.time}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{appt.patient_name}</div>
                        <div className="text-xs text-gray-400">{appt.mrn} · {appt.mobile}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">Dr. {appt.doctor_name}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        {appt.video_link ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => joinCall(appt)}
                              className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors ${isActive ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>
                              <Phone className="w-3 h-3" />
                              {isActive ? 'In Call' : 'Join'}
                            </button>
                            <button onClick={() => copyLink(appt.video_link!, appt.id)}
                              className="p-1 text-gray-400 hover:text-gray-600" title="Copy link">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            {copied === appt.id && <span className="text-xs text-green-600">Copied!</span>}
                          </div>
                        ) : <span className="text-gray-300 text-xs">No link</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {appt.mobile && (
                            <button onClick={() => sendWhatsApp(appt)}
                              className="btn-secondary text-xs py-1 px-2 flex items-center gap-1">
                              <MessageCircle className="w-3 h-3 text-green-500" /> WhatsApp
                            </button>
                          )}
                          {appt.status !== 'completed' && (
                            <button onClick={() => markCompleted(appt.id)}
                              className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 text-green-700">
                              <CheckCircle className="w-3 h-3" /> Done
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Open Slots ─────────────────────────────────────── */}
        {openSlots.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-green-50">
              <h2 className="font-semibold text-green-900 flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Open Slots — Available for Booking ({openSlots.length})
              </h2>
              <p className="text-xs text-green-700 mt-0.5">
                Patients can self-book via their portal link · Share from the Patient profile page
              </p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  {['Date', 'Time', 'Doctor', 'Video Link', ''].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openSlots.map(slot => (
                  <tr key={slot.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{formatDate(slot.date)}</td>
                    <td className="px-4 py-3 font-mono text-gray-600">{slot.time}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">Dr. {slot.doctor_name}</td>
                    <td className="px-4 py-3">
                      {slot.video_link && (
                        <div className="flex items-center gap-1.5">
                          <a href={slot.video_link} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" /> Preview
                          </a>
                          <button onClick={() => copyLink(slot.video_link!, slot.id)}
                            className="p-1 text-gray-400 hover:text-gray-600" title="Copy link">
                            <Copy className="w-3 h-3" />
                          </button>
                          {copied === slot.id && <span className="text-xs text-green-600">Copied!</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => deleteSlot(slot.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty state — comprehensive how-to guide */}
        {!loading && appointments.length === 0 && (
          <div className="max-w-2xl mx-auto py-8">
            <div className="text-center mb-6">
              <Video className="w-12 h-12 mx-auto mb-3 text-blue-300" />
              <p className="font-semibold text-gray-700 text-lg">No video appointments yet</p>
              <p className="text-sm text-gray-400 mt-1">Follow the steps below to start your first video consultation</p>
            </div>

            {/* Doctor steps */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 mb-4">
              <h3 className="font-bold text-blue-800 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-full text-xs flex items-center justify-center font-bold">Dr</span>
                Steps for the Doctor
              </h3>
              <ol className="space-y-2.5">
                {[
                  { n: 1, text: 'Click "Create Slots" above → choose date, time, and number of slots.' },
                  { n: 2, text: 'Each slot gets a unique Jitsi Meet video link (no account needed).' },
                  { n: 3, text: 'Optionally attach a patient directly when creating the slot.' },
                  { n: 4, text: 'Click the "WhatsApp" button on a booked slot to send the patient their link.' },
                  { n: 5, text: 'At consultation time, click "Join" → the video call opens right here in the app.' },
                  { n: 6, text: 'Click "Done" when finished to mark the appointment as completed.' },
                ].map(s => (
                  <li key={s.n} className="flex items-start gap-3 text-sm text-blue-800">
                    <span className="w-5 h-5 bg-blue-200 text-blue-800 rounded-full text-xs flex items-center justify-center font-bold flex-shrink-0 mt-0.5">{s.n}</span>
                    {s.text}
                  </li>
                ))}
              </ol>
            </div>

            {/* Patient steps */}
            <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mb-6">
              <h3 className="font-bold text-green-800 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-green-600 text-white rounded-full text-xs flex items-center justify-center font-bold">Pt</span>
                Steps for the Patient
              </h3>
              <ol className="space-y-2.5">
                {[
                  { n: 1, text: 'Patient receives a WhatsApp message with their video link.' },
                  { n: 2, text: 'At appointment time, patient taps the link in WhatsApp.' },
                  { n: 3, text: 'The link opens directly in Chrome/Safari — no app download needed.' },
                  { n: 4, text: 'Patient clicks "Allow" when the browser asks for camera & microphone.' },
                  { n: 5, text: 'Patient is in the call! The doctor joins from this page by clicking "Join".' },
                ].map(s => (
                  <li key={s.n} className="flex items-start gap-3 text-sm text-green-800">
                    <span className="w-5 h-5 bg-green-200 text-green-800 rounded-full text-xs flex items-center justify-center font-bold flex-shrink-0 mt-0.5">{s.n}</span>
                    {s.text}
                  </li>
                ))}
              </ol>
            </div>

            {/* Info box */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-600 space-y-1">
              <p>✅ <strong>No account needed</strong> — Jitsi Meet is free and browser-based.</p>
              <p>✅ <strong>Works on mobile</strong> — patients can join from any Android or iPhone browser.</p>
              <p>✅ <strong>Encrypted</strong> — calls are end-to-end encrypted.</p>
              <p>✅ <strong>Live updates</strong> — this page refreshes automatically when a patient books.</p>
            </div>

            {can('encounters.create') && (
              <div className="text-center mt-6">
                <button onClick={() => setShowCreate(true)}
                  className="btn-primary flex items-center gap-2 mx-auto text-sm px-6 py-2.5">
                  <Plus className="w-4 h-4" /> Create Your First Video Slot
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}