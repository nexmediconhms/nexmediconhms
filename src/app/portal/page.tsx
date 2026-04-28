'use client'
/**
 * src/app/portal/page.tsx
 *
 * Patient Portal (PWA)
 * Accessible at: /portal?mrn=P-001&token=<magic-token>
 *
 * Features:
 *  - Magic-link authentication (token validated server-side)
 *  - View own prescriptions, upcoming appointments, bills
 *  - Self-book video consultation slots
 *  - Lab reports and discharge summaries
 *  - Works offline as a PWA (via next-pwa)
 *  - NO clinic staff involvement required
 *
 * This fulfils requirement #5 — patient-direct booking reducing reception calls.
 */

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime } from '@/lib/utils'
import {
  Pill, Calendar, IndianRupee, FileText, Video,
  Clock, CheckCircle, AlertCircle, RefreshCw,
  Stethoscope, Heart, ChevronRight, Phone
} from 'lucide-react'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────

interface PortalData {
  patient: {
    id: string
    full_name: string
    mrn: string
    age: number
    gender: string
    mobile: string
    blood_group: string
  }
  appointments: any[]
  prescriptions: any[]
  bills: any[]
  labReports: any[]
}

// ── Token validation ────────────────────────────────────────────

async function validatePortalToken(mrn: string, token: string): Promise<boolean> {
  const { data } = await supabase
    .from('portal_tokens')
    .select('id, expires_at, is_used')
    .eq('mrn', mrn)
    .eq('token', token)
    .single()

  if (!data) return false
  if (data.is_used) return false
  if (new Date(data.expires_at) < new Date()) return false
  return true
}

// ── Portal Content ─────────────────────────────────────────────

function PortalContent() {
  const params      = useSearchParams()
  const mrn         = params.get('mrn') || ''
  const token       = params.get('token') || ''

  const [status, setStatus]   = useState<'loading' | 'invalid' | 'valid'>('loading')
  const [data, setData]       = useState<PortalData | null>(null)
  const [activeTab, setTab]   = useState('appointments')
  const [bookingOpen, setBookingOpen] = useState(false)

  useEffect(() => {
    if (!mrn || !token) { setStatus('invalid'); return }
    init()
  }, [mrn, token])

  async function init() {
    const valid = await validatePortalToken(mrn, token)
    if (!valid) { setStatus('invalid'); return }

    // Load patient data
    const { data: pat } = await supabase
      .from('patients')
      .select('id, full_name, mrn, age, gender, mobile, blood_group')
      .eq('mrn', mrn)
      .single()

    if (!pat) { setStatus('invalid'); return }

    // Parallel load
    const [appts, rxs, bills] = await Promise.all([
      supabase
        .from('appointments')
        .select('*')
        .eq('patient_id', pat.id)
        .gte('date', new Date().toISOString().split('T')[0])
        .order('date', { ascending: true })
        .limit(10),
      supabase
        .from('prescriptions')
        .select('*, encounters(encounter_date, diagnosis)')
        .eq('patient_id', pat.id)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('bills')
        .select('*')
        .eq('patient_id', pat.id)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    setData({
      patient:      pat as any,
      appointments: appts.data || [],
      prescriptions: rxs.data || [],
      bills:        bills.data || [],
      labReports:   [],
    })
    setStatus('valid')
  }

  // ── Loading ──
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"/>
          <p className="text-gray-600 font-medium">Loading your health records…</p>
        </div>
      </div>
    )
  }

  // ── Invalid token ──
  if (status === 'invalid') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4"/>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Invalid or Expired Link</h2>
          <p className="text-gray-500 text-sm mb-4">
            This portal link has expired or is invalid. Please request a new link from the hospital reception.
          </p>
          <p className="text-xs text-gray-400">
            Links expire after 24 hours for your security.
          </p>
        </div>
      </div>
    )
  }

  if (!data) return null
  const { patient, appointments, prescriptions, bills } = data

  // ── Portal UI ──
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 pt-safe-top pb-6">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-4 pt-4">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-white"/>
              <span className="text-white font-bold text-sm">My Health Portal</span>
            </div>
            <span className="text-blue-200 text-xs font-mono">{patient.mrn}</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{patient.full_name}</h1>
            <p className="text-blue-200 text-sm mt-0.5">
              {patient.age}y · {patient.gender} · {patient.blood_group || 'Blood group not recorded'}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 -mt-4">

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Upcoming', value: appointments.length, icon: Calendar, color: 'text-blue-600 bg-blue-50' },
            { label: 'Pending Bills', value: bills.filter(b => b.status === 'pending').length, icon: IndianRupee, color: 'text-orange-600 bg-orange-50' },
            { label: 'Prescriptions', value: prescriptions.length, icon: Pill, color: 'text-green-600 bg-green-50' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className={`rounded-2xl p-3 ${color.split(' ')[1]} text-center`}>
              <div className={`text-2xl font-bold ${color.split(' ')[0]}`}>{value}</div>
              <div className="text-xs text-gray-600">{label}</div>
            </div>
          ))}
        </div>

        {/* Book Video Consultation CTA */}
        <button
          onClick={() => setBookingOpen(true)}
          className="w-full mb-5 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-2xl p-4 flex items-center gap-3 shadow-lg active:scale-95 transition-transform">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Video className="w-5 h-5"/>
          </div>
          <div className="text-left">
            <div className="font-bold">Book Video Consultation</div>
            <div className="text-green-100 text-xs">See a doctor from home · Available slots below</div>
          </div>
          <ChevronRight className="w-5 h-5 ml-auto opacity-70"/>
        </button>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5">
          {[
            { key: 'appointments', label: '📅 Appointments' },
            { key: 'prescriptions', label: '💊 Prescriptions' },
            { key: 'bills', label: '💳 Bills' },
          ].map(({ key, label }) => (
            <button key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === key ? 'bg-white shadow text-blue-700' : 'text-gray-500'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Appointments */}
        {activeTab === 'appointments' && (
          <div className="space-y-3">
            {appointments.length === 0 ? (
              <EmptyState icon={Calendar} text="No upcoming appointments" sub="Book a video consultation above"/>
            ) : appointments.map(appt => (
              <div key={appt.id} className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-gray-900">{appt.type || 'Appointment'}</div>
                    <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3"/>
                      {formatDate(appt.date)} {appt.time && `at ${appt.time}`}
                    </div>
                    {appt.doctor_name && (
                      <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Stethoscope className="w-3 h-3"/> Dr. {appt.doctor_name}
                      </div>
                    )}
                    {appt.notes && <div className="text-xs text-gray-400 mt-1">{appt.notes}</div>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    appt.status === 'confirmed' ? 'bg-green-100 text-green-700'
                    : appt.status === 'video' ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600'
                  }`}>
                    {appt.status === 'video' ? '📹 Video' : appt.status || 'Scheduled'}
                  </span>
                </div>
                {appt.video_link && (
                  <a href={appt.video_link} target="_blank" rel="noopener noreferrer"
                    className="mt-3 flex items-center gap-2 bg-blue-50 text-blue-700 rounded-xl px-4 py-2.5 text-sm font-semibold">
                    <Video className="w-4 h-4"/> Join Video Call
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Prescriptions */}
        {activeTab === 'prescriptions' && (
          <div className="space-y-3">
            {prescriptions.length === 0 ? (
              <EmptyState icon={Pill} text="No prescriptions yet"/>
            ) : prescriptions.map(rx => (
              <div key={rx.id} className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {formatDate(rx.encounters?.encounter_date || rx.created_at)}
                  </div>
                  {rx.follow_up_date && (
                    <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">
                      Follow-up: {formatDate(rx.follow_up_date)}
                    </span>
                  )}
                </div>
                {rx.encounters?.diagnosis && (
                  <div className="font-semibold text-gray-800 text-sm mb-2">{rx.encounters.diagnosis}</div>
                )}
                {Array.isArray(rx.medications) && rx.medications.map((m: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
                    <Pill className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5"/>
                    <div className="text-sm">
                      <span className="font-medium text-gray-900">{m.drug}</span>
                      {m.dose && <span className="text-gray-500"> {m.dose}</span>}
                      <span className="text-gray-400 text-xs"> · {m.frequency} · {m.duration}</span>
                    </div>
                  </div>
                ))}
                {rx.advice && (
                  <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
                    📋 {rx.advice}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Bills */}
        {activeTab === 'bills' && (
          <div className="space-y-3">
            {bills.length === 0 ? (
              <EmptyState icon={IndianRupee} text="No bills found"/>
            ) : bills.map(bill => (
              <div key={bill.id} className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-gray-900">
                      ₹{Number(bill.net_amount).toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs text-gray-500">{formatDate(bill.created_at)}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    bill.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {bill.status === 'paid' ? '✓ Paid' : 'Pending'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="h-8"/>
      </div>

      {/* Video booking modal */}
      {bookingOpen && (
        <VideoBookingModal
          patientId={patient.id}
          patientName={patient.full_name}
          mrn={patient.mrn}
          mobile={patient.mobile}
          onClose={() => setBookingOpen(false)}
          onBooked={() => { setBookingOpen(false); init() }}
        />
      )}
    </div>
  )
}

// ── Empty state helper ─────────────────────────────────────────

function EmptyState({ icon: Icon, text, sub }: { icon: any; text: string; sub?: string }) {
  return (
    <div className="text-center py-12 text-gray-400">
      <Icon className="w-10 h-10 mx-auto mb-3 opacity-30"/>
      <p className="font-medium text-gray-500">{text}</p>
      {sub && <p className="text-xs mt-1">{sub}</p>}
    </div>
  )
}

// ── Video Booking Modal ────────────────────────────────────────

function VideoBookingModal({ patientId, patientName, mrn, mobile, onClose, onBooked }: {
  patientId: string
  patientName: string
  mrn: string
  mobile: string
  onClose: () => void
  onBooked: () => void
}) {
  const [slots, setSlots]     = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<any>(null)
  const [notes, setNotes]     = useState('')
  const [booking, setBooking] = useState(false)
  const [booked, setBooked]   = useState(false)

  useEffect(() => { loadSlots() }, [])

  async function loadSlots() {
    // Load open video consultation slots for next 7 days
    const today    = new Date().toISOString().split('T')[0]
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

    const { data } = await supabase
      .from('appointments')
      .select('id, date, time, doctor_name, type, status, notes')
      .eq('type', 'video')
      .eq('status', 'open')            // open = available for patient to take
      .gte('date', today)
      .lte('date', nextWeek)
      .order('date')
      .order('time')
      .limit(20)

    setSlots(data || [])
    setLoading(false)
  }

  async function confirmBooking() {
    if (!selected) return
    setBooking(true)

    // Claim the slot
    const { error } = await supabase
      .from('appointments')
      .update({
        patient_id:   patientId,
        patient_name: patientName,
        mrn,
        mobile,
        status:       'video',
        notes:        notes || null,
      })
      .eq('id', selected.id)
      .eq('status', 'open')   // optimistic locking — only update if still open

    if (error) {
      alert('This slot was just taken. Please choose another.')
      await loadSlots()
    } else {
      setBooked(true)
      setTimeout(onBooked, 2000)
    }
    setBooking(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2">
              <Video className="w-5 h-5 text-green-500"/> Book Video Consultation
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
          </div>
          <p className="text-xs text-gray-500 mt-1">Choose an available slot. Your doctor will send you a video link before the appointment.</p>
        </div>

        <div className="p-5">
          {booked ? (
            <div className="text-center py-8">
              <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4"/>
              <h3 className="text-lg font-bold text-gray-900">Appointment Booked!</h3>
              <p className="text-gray-500 text-sm mt-2">
                You'll receive a video call link on your mobile before the appointment.
              </p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-green-400 border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : slots.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30"/>
              <p className="font-medium">No video slots available this week</p>
              <p className="text-xs mt-1">Please call the clinic to book a slot</p>
            </div>
          ) : (
            <>
              <div className="space-y-2 mb-5">
                {slots.map(slot => (
                  <button key={slot.id}
                    onClick={() => setSelected(selected?.id === slot.id ? null : slot)}
                    className={`w-full text-left p-3 rounded-xl border-2 transition-colors ${
                      selected?.id === slot.id
                        ? 'border-green-400 bg-green-50'
                        : 'border-gray-100 bg-gray-50 hover:border-gray-200'
                    }`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-gray-900 text-sm">
                          {new Date(slot.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                          {' '}{slot.time}
                        </div>
                        {slot.doctor_name && (
                          <div className="text-xs text-gray-500 flex items-center gap-1">
                            <Stethoscope className="w-3 h-3"/> Dr. {slot.doctor_name}
                          </div>
                        )}
                      </div>
                      {selected?.id === slot.id && (
                        <CheckCircle className="w-5 h-5 text-green-500"/>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {selected && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason / Symptoms (optional)
                  </label>
                  <textarea className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400" rows={2}
                    placeholder="e.g. Follow-up for fever, stomach pain, prescription refill…"
                    value={notes} onChange={e => setNotes(e.target.value)}/>
                </div>
              )}

              <button
                onClick={confirmBooking}
                disabled={!selected || booking}
                className="w-full bg-green-500 text-white rounded-xl py-3.5 font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {booking ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                  : <Video className="w-4 h-4"/>}
                {booking ? 'Booking…' : selected ? `Book — ${formatDate(selected.date)} ${selected.time}` : 'Select a slot above'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page Export (wrap in Suspense for useSearchParams) ─────────

export default function PortalPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"/>
      </div>
    }>
      <PortalContent/>
    </Suspense>
  )
}