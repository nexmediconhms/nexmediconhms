'use client'
/**
 * src/app/video/page.tsx
 *
 * Video Consultation Management (Staff / Doctor view)
 *
 * Features:
 *  - Create open video slots that patients can self-book via portal
 *  - View today's and upcoming video consultations
 *  - Generate and share Jitsi / Google Meet video links
 *  - Send portal magic-link via WhatsApp to patients
 *  - Multiple doctors can have separate slots
 *
 * Requirement #5: patient-direct booking without staff interference.
 * Staff creates slots here. Patients book via /portal?mrn=...&token=...
 */

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import {
  Video, Plus, Calendar, Clock, Users, CheckCircle,
  ExternalLink, MessageCircle, Trash2, RefreshCw, Copy, Send
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
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  await supabase.from('portal_tokens').insert({
    mrn,
    token,
    expires_at: expiresAt,
    is_used:    false,
  })

  return token
}

// ── Component ──────────────────────────────────────────────────

export default function VideoConsultPage() {
  const { user, can } = useAuth()
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  const [appointments, setAppointments] = useState<any[]>([])
  const [doctors, setDoctors] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [copied, setCopied]   = useState<string | null>(null)

  const [form, setForm] = useState({
    date:        new Date().toISOString().split('T')[0],
    time:        '10:00',
    doctor_name: '',
    duration_min: '15',
    slots_count:  '1',
    notes:       '',
  })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    loadData()
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
        .order('date')
        .order('time'),
      supabase
        .from('clinic_users')
        .select('id, full_name')
        .eq('is_active', true)
        .in('role', ['admin', 'doctor']),
    ])

    setAppointments(apptRes.data || [])
    setDoctors(docRes.data || [])
    setLoading(false)

    // Pre-select current user's name as doctor
    if (user?.full_name && !form.doctor_name) {
      setForm(prev => ({ ...prev, doctor_name: user.full_name }))
    }
  }

  async function createSlots() {
    setCreating(true)
    const count = parseInt(form.slots_count) || 1

    const rows = Array.from({ length: count }, (_, i) => {
      const baseMinutes = parseInt(form.time.split(':')[0]) * 60 + parseInt(form.time.split(':')[1])
      const slotMinutes = baseMinutes + i * (parseInt(form.duration_min) || 15)
      const hh = String(Math.floor(slotMinutes / 60) % 24).padStart(2, '0')
      const mm = String(slotMinutes % 60).padStart(2, '0')
      return {
        type:        'video',
        status:      'open',
        date:        form.date,
        time:        `${hh}:${mm}`,
        doctor_name: form.doctor_name,
        notes:       form.notes || null,
        video_link:  generateJitsiLink(generateRoomName()),
      }
    })

    await supabase.from('appointments').insert(rows)
    setShowCreateForm(false)
    await loadData()
    setCreating(false)
  }

  async function deleteSlot(id: string) {
    if (!confirm('Delete this slot?')) return
    await supabase.from('appointments').delete().eq('id', id)
    await loadData()
  }

  async function sendPortalLink(appt: any) {
    if (!appt.mobile) {
      alert('No mobile number on this appointment. Update the appointment first.')
      return
    }
    const token   = await generatePortalToken(appt.mrn)
    const link    = `${SITE_URL}/portal?mrn=${encodeURIComponent(appt.mrn)}&token=${encodeURIComponent(token)}`
    const message = `Namaste ${appt.patient_name} ji,\n\nYour video consultation is scheduled for ${formatDate(appt.date)} at ${appt.time} with Dr. ${appt.doctor_name}.\n\n▶ View your appointment & health records:\n${link}\n\nVideo call link will be shared before appointment.\n\n— ${hs.hospitalName || 'Hospital'}`
    const waUrl = `https://wa.me/91${appt.mobile.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(message)}`
    window.open(waUrl, '_blank')
  }

  async function copyPortalLink(mrn: string, mobile: string, name: string) {
    const token = await generatePortalToken(mrn)
    const link  = `${SITE_URL}/portal?mrn=${encodeURIComponent(mrn)}&token=${encodeURIComponent(token)}`
    navigator.clipboard.writeText(link).catch(() => {})
    setCopied(mrn)
    setTimeout(() => setCopied(null), 3000)
  }

  const openSlots    = appointments.filter(a => a.status === 'open')
  const bookedSlots  = appointments.filter(a => a.status === 'video' && a.patient_name)
  const todayStr     = new Date().toISOString().split('T')[0]
  const todayBooked  = bookedSlots.filter(a => a.date === todayStr)

  return (
    <AppShell>
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Video className="w-6 h-6 text-blue-500"/> Video Consultations
            </h1>
            <p className="text-sm text-gray-500">
              Create slots for patients to self-book · Send portal links via WhatsApp
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={loadData} disabled={loading}
              className="btn-secondary flex items-center gap-2 text-xs">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/> Refresh
            </button>
            {can('encounters.create') && (
              <button onClick={() => setShowCreateForm(!showCreateForm)}
                className="btn-primary flex items-center gap-2 text-xs">
                <Plus className="w-3.5 h-3.5"/> Create Slots
              </button>
            )}
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Today's Video", value: todayBooked.length, sub: 'booked today', icon: Video, cls: 'bg-blue-50 text-blue-700' },
            { label: 'Open Slots', value: openSlots.length, sub: 'available to book', icon: Calendar, cls: 'bg-green-50 text-green-700' },
            { label: 'Total Booked', value: bookedSlots.length, sub: 'upcoming', icon: Users, cls: 'bg-purple-50 text-purple-700' },
          ].map(({ label, value, sub, icon: Icon, cls }) => (
            <div key={label} className={`card p-4 ${cls.split(' ')[1]}`}>
              <div className={`text-3xl font-bold ${cls.split(' ')[0]} mb-1`}>{value}</div>
              <div className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                <Icon className="w-3.5 h-3.5"/>{label}
              </div>
              <div className="text-xs text-gray-400">{sub}</div>
            </div>
          ))}
        </div>

        {/* Create slots form */}
        {showCreateForm && (
          <div className="card p-5 mb-6 border-l-4 border-blue-400">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 text-blue-500"/> Create Video Slots
            </h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className="label">Date</label>
                <input className="input" type="date" value={form.date}
                  onChange={e => setForm(p => ({ ...p, date: e.target.value }))}/>
              </div>
              <div>
                <label className="label">Start Time</label>
                <input className="input" type="time" value={form.time}
                  onChange={e => setForm(p => ({ ...p, time: e.target.value }))}/>
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
                <label className="label">Slot Duration (min)</label>
                <select className="input" value={form.duration_min}
                  onChange={e => setForm(p => ({ ...p, duration_min: e.target.value }))}>
                  {['10', '15', '20', '30', '45', '60'].map(d => <option key={d} value={d}>{d} min</option>)}
                </select>
              </div>
              <div>
                <label className="label">Number of Slots</label>
                <select className="input" value={form.slots_count}
                  onChange={e => setForm(p => ({ ...p, slots_count: e.target.value }))}>
                  {['1', '2', '3', '4', '5', '6', '8', '10'].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <input className="input" placeholder="e.g. Follow-up only"
                  value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}/>
              </div>
            </div>
            <div className="text-xs text-gray-500 mb-3">
              ℹ️ Slots will be created starting at {form.time}, {form.slots_count} slot(s) of {form.duration_min} min each.
              Each slot gets a unique Jitsi video link auto-generated.
            </div>
            <div className="flex gap-3">
              <button onClick={createSlots} disabled={creating || !form.doctor_name}
                className="btn-primary flex items-center gap-2 text-xs disabled:opacity-60">
                {creating ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                  : <Plus className="w-3.5 h-3.5"/>}
                {creating ? 'Creating…' : 'Create Slots'}
              </button>
              <button onClick={() => setShowCreateForm(false)} className="btn-secondary text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* Booked Video Appointments */}
        {bookedSlots.length > 0 && (
          <div className="card overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-gray-100 bg-blue-50">
              <h2 className="font-semibold text-blue-900 flex items-center gap-2">
                <Users className="w-4 h-4"/> Booked Video Appointments ({bookedSlots.length})
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  {['Date/Time', 'Patient', 'Doctor', 'Video Link', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookedSlots.map(appt => (
                  <tr key={appt.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{formatDate(appt.date)}</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3"/>{appt.time}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{appt.patient_name}</div>
                      <div className="text-xs text-gray-400">{appt.mrn} · {appt.mobile}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">Dr. {appt.doctor_name}</td>
                    <td className="px-4 py-3">
                      {appt.video_link ? (
                        <a href={appt.video_link} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-600 flex items-center gap-1 hover:underline">
                          <ExternalLink className="w-3 h-3"/> Join Call
                        </a>
                      ) : <span className="text-gray-300 text-xs">No link</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {appt.mobile && (
                          <button onClick={() => sendPortalLink(appt)}
                            className="btn-secondary text-xs py-1 px-2 flex items-center gap-1">
                            <MessageCircle className="w-3 h-3 text-green-500"/> Portal Link
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Open Slots */}
        {openSlots.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-green-50">
              <h2 className="font-semibold text-green-900 flex items-center gap-2">
                <Calendar className="w-4 h-4"/> Open Slots — Available for Patients ({openSlots.length})
              </h2>
              <p className="text-xs text-green-700 mt-0.5">
                Patients can self-book these via their portal link · Share portal links from the patient's profile page
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
                        <a href={slot.video_link} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                          <ExternalLink className="w-3 h-3"/> Preview link
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => deleteSlot(slot.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5"/>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && appointments.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <Video className="w-12 h-12 mx-auto mb-3 opacity-20"/>
            <p className="font-medium">No video appointments yet</p>
            <p className="text-sm mt-1">Create slots above and share portal links with patients via WhatsApp</p>
          </div>
        )}
      </div>
    </AppShell>
  )
}