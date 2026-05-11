'use client'
/**
 * src/app/portal/dashboard/page.tsx
 *
 * Patient Portal Dashboard (Full Feature)
 *
 * Features:
 *  - Session-based auth (stored in localStorage)
 *  - View prescriptions with medication details
 *  - View lab reports
 *  - View bills & pay invoices online
 *  - Book follow-up appointments
 *  - Responsive mobile-first PWA design
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Heart, Pill, Calendar, IndianRupee, FileText, Video,
  Clock, CheckCircle, AlertCircle, RefreshCw, LogOut,
  Stethoscope, ChevronRight, Phone, CreditCard,
  TestTube, Download, ExternalLink, Plus, X,
  CalendarPlus, MapPin
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────

interface PatientInfo {
  id: string
  full_name: string
  mrn: string
  age: number
  gender: string
  mobile: string
  blood_group: string
}

interface PortalData {
  patient: PatientInfo
  prescriptions: any[]
  labReports: any[]
  bills: any[]
  appointments: any[]
}

// ── Helpers ────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatCurrency(amount: number): string {
  return `₹${Number(amount).toLocaleString('en-IN')}`
}

// ── Main Dashboard ─────────────────────────────────────────────

export default function PortalDashboard() {
  const router = useRouter()
  const [data, setData]         = useState<PortalData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [activeTab, setTab]     = useState('overview')
  const [showBooking, setShowBooking] = useState(false)
  const [showPayment, setShowPayment] = useState<any>(null)

  const sessionToken = typeof window !== 'undefined' ? localStorage.getItem('portal_session') : null

  const loadData = useCallback(async () => {
    if (!sessionToken) {
      router.replace('/portal/login')
      return
    }

    try {
      const res = await fetch('/api/portal/session', {
        headers: { 'X-Portal-Session': sessionToken },
      })

      if (res.status === 401) {
        localStorage.removeItem('portal_session')
        localStorage.removeItem('portal_patient')
        router.replace('/portal/login')
        return
      }

      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to load data')
        setLoading(false)
        return
      }

      setData(json)
    } catch {
      setError('Network error. Please check your connection.')
    }
    setLoading(false)
  }, [sessionToken, router])

  useEffect(() => {
    loadData()
  }, [loadData])

  async function logout() {
    if (sessionToken) {
      await fetch('/api/portal/session', {
        method: 'DELETE',
        headers: { 'X-Portal-Session': sessionToken },
      }).catch(() => {})
    }
    localStorage.removeItem('portal_session')
    localStorage.removeItem('portal_patient')
    router.replace('/portal/login')
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"/>
          <p className="text-gray-600 font-medium">Loading your health records…</p>
        </div>
      </div>
    )
  }

  // ── Error ──
  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4"/>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Something went wrong</h2>
          <p className="text-gray-500 text-sm mb-4">{error || 'Unable to load data'}</p>
          <button onClick={loadData} className="bg-blue-600 text-white rounded-xl px-6 py-2.5 font-medium">
            <RefreshCw className="w-4 h-4 inline mr-1"/> Retry
          </button>
        </div>
      </div>
    )
  }

  const { patient, prescriptions, labReports, bills, appointments } = data
  const pendingBills = bills.filter(b => b.status === 'pending')

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 pt-safe-top pb-6">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-4 pt-4">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-white"/>
              <span className="text-white font-bold text-sm">My Health Portal</span>
            </div>
            <button onClick={logout} className="text-blue-200 hover:text-white text-xs flex items-center gap-1">
              <LogOut className="w-3.5 h-3.5"/> Logout
            </button>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{patient.full_name}</h1>
            <p className="text-blue-200 text-sm mt-0.5">
              {patient.age}y · {patient.gender} · {patient.blood_group || '—'} · MRN: {patient.mrn}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 -mt-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-4 gap-2 mb-5">
          {[
            { label: 'Upcoming', value: appointments.length, icon: Calendar, color: 'text-blue-600 bg-blue-50' },
            { label: 'Pending', value: pendingBills.length, icon: IndianRupee, color: 'text-orange-600 bg-orange-50' },
            { label: 'Rx', value: prescriptions.length, icon: Pill, color: 'text-green-600 bg-green-50' },
            { label: 'Reports', value: labReports.length, icon: TestTube, color: 'text-purple-600 bg-purple-50' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className={`rounded-2xl p-2.5 ${color.split(' ')[1]} text-center`}>
              <Icon className={`w-4 h-4 mx-auto mb-0.5 ${color.split(' ')[0]}`}/>
              <div className={`text-lg font-bold ${color.split(' ')[0]}`}>{value}</div>
              <div className="text-[10px] text-gray-600">{label}</div>
            </div>
          ))}
        </div>

        {/* Book Follow-up CTA */}
        <button
          onClick={() => setShowBooking(true)}
          className="w-full mb-5 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-2xl p-4 flex items-center gap-3 shadow-lg active:scale-[0.98] transition-transform">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <CalendarPlus className="w-5 h-5"/>
          </div>
          <div className="text-left">
            <div className="font-bold">Book Follow-up</div>
            <div className="text-green-100 text-xs">In-person or video consultation</div>
          </div>
          <ChevronRight className="w-5 h-5 ml-auto opacity-70"/>
        </button>

        {/* Tabs */}
        <div className="flex gap-0.5 bg-gray-100 rounded-xl p-1 mb-5 overflow-x-auto">
          {[
            { key: 'overview', label: '🏠' },
            { key: 'prescriptions', label: '💊 Rx' },
            { key: 'labs', label: '🧪 Labs' },
            { key: 'bills', label: '💳 Bills' },
            { key: 'appointments', label: '📅 Appts' },
          ].map(({ key, label }) => (
            <button key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === key ? 'bg-white shadow text-blue-700' : 'text-gray-500'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Overview Tab ── */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Pending bills alert */}
            {pendingBills.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-orange-500"/>
                  <span className="font-semibold text-orange-800 text-sm">
                    {pendingBills.length} Pending Bill{pendingBills.length > 1 ? 's' : ''}
                  </span>
                </div>
                <p className="text-xs text-orange-600 mb-3">
                  Total: {formatCurrency(pendingBills.reduce((s, b) => s + Number(b.net_amount), 0))}
                </p>
                <button
                  onClick={() => setTab('bills')}
                  className="text-xs bg-orange-500 text-white px-4 py-1.5 rounded-lg font-medium">
                  View & Pay
                </button>
              </div>
            )}

            {/* Next appointment */}
            {appointments.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-blue-500"/>
                  <span className="font-semibold text-blue-800 text-sm">Next Appointment</span>
                </div>
                <div className="text-sm text-blue-900 font-medium">
                  {formatDate(appointments[0].date)} at {appointments[0].time}
                </div>
                {appointments[0].doctor_name && (
                  <div className="text-xs text-blue-600 mt-1">
                    Dr. {appointments[0].doctor_name} · {appointments[0].type || 'Consultation'}
                  </div>
                )}
                {appointments[0].video_link && (
                  <a href={appointments[0].video_link} target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 bg-blue-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium">
                    <Video className="w-3 h-3"/> Join Video Call
                  </a>
                )}
              </div>
            )}

            {/* Latest prescription */}
            {prescriptions.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-800 text-sm flex items-center gap-1">
                    <Pill className="w-4 h-4 text-green-500"/> Latest Prescription
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatDate(prescriptions[0].encounters?.encounter_date || prescriptions[0].created_at)}
                  </span>
                </div>
                {prescriptions[0].encounters?.diagnosis && (
                  <p className="text-xs text-gray-600 mb-2">{prescriptions[0].encounters.diagnosis}</p>
                )}
                <div className="space-y-1">
                  {(prescriptions[0].medications || []).slice(0, 3).map((m: any, i: number) => (
                    <div key={i} className="text-xs text-gray-700">
                      • <span className="font-medium">{m.drug}</span> {m.dose} — {m.frequency}
                    </div>
                  ))}
                  {(prescriptions[0].medications || []).length > 3 && (
                    <p className="text-xs text-blue-500 cursor-pointer" onClick={() => setTab('prescriptions')}>
                      +{prescriptions[0].medications.length - 3} more medications →
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Prescriptions Tab ── */}
        {activeTab === 'prescriptions' && (
          <div className="space-y-3">
            {prescriptions.length === 0 ? (
              <EmptyState icon={Pill} text="No prescriptions yet"/>
            ) : prescriptions.map(rx => (
              <div key={rx.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {formatDate(rx.encounters?.encounter_date || rx.created_at)}
                  </div>
                  {rx.encounters?.doctor_name && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Stethoscope className="w-3 h-3"/> Dr. {rx.encounters.doctor_name}
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
                      <div className="text-gray-400 text-xs">{m.frequency} · {m.duration}</div>
                      {m.instructions && <div className="text-gray-400 text-xs italic">{m.instructions}</div>}
                    </div>
                  </div>
                ))}
                {rx.advice && (
                  <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
                    📋 {rx.advice}
                  </div>
                )}
                {rx.follow_up_date && (
                  <div className="mt-2 text-xs bg-orange-50 text-orange-600 px-2 py-1 rounded-lg inline-block">
                    Follow-up: {formatDate(rx.follow_up_date)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Lab Reports Tab ── */}
        {activeTab === 'labs' && (
          <div className="space-y-3">
            {labReports.length === 0 ? (
              <EmptyState icon={TestTube} text="No lab reports yet" sub="Reports will appear here once uploaded by the lab"/>
            ) : labReports.map(report => (
              <div key={report.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-gray-900 text-sm">{report.test_name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {report.test_category} · {formatDate(report.report_date)}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    report.status === 'completed' ? 'bg-green-100 text-green-700'
                    : report.status === 'reviewed' ? 'bg-blue-100 text-blue-700'
                    : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {report.status === 'completed' ? '✓ Done' : report.status === 'reviewed' ? '✓ Reviewed' : '⏳ Pending'}
                  </span>
                </div>

                {report.result_text && (
                  <div className="mt-2 text-sm text-gray-700 bg-gray-50 rounded-lg p-2">
                    {report.result_text}
                  </div>
                )}

                {report.result_data && Object.keys(report.result_data).length > 0 && (
                  <div className="mt-2 space-y-1">
                    {Object.entries(report.result_data).map(([key, val]: [string, any]) => (
                      <div key={key} className="flex justify-between text-xs">
                        <span className="text-gray-600">{key}</span>
                        <span className="font-medium text-gray-900">{String(val)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {report.normal_range && (
                  <div className="mt-1 text-xs text-gray-400">
                    Normal range: {report.normal_range}
                  </div>
                )}

                {report.file_url && (
                  <a href={report.file_url} target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
                    <Download className="w-3 h-3"/> Download Report
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Bills Tab ── */}
        {activeTab === 'bills' && (
          <div className="space-y-3">
            {bills.length === 0 ? (
              <EmptyState icon={IndianRupee} text="No bills found"/>
            ) : bills.map(bill => (
              <div key={bill.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-gray-900">
                      {formatCurrency(bill.net_amount)}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{formatDate(bill.created_at)}</div>
                    {bill.items && Array.isArray(bill.items) && bill.items.length > 0 && (
                      <div className="text-xs text-gray-400 mt-1">
                        {bill.items.map((item: any) => item.label || item.name).filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    bill.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {bill.status === 'paid' ? '✓ Paid' : 'Pending'}
                  </span>
                </div>

                {bill.status === 'pending' && (
                  <button
                    onClick={() => setShowPayment(bill)}
                    className="mt-3 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl py-2.5 text-sm font-semibold active:scale-[0.98] transition-transform">
                    <CreditCard className="w-4 h-4"/> Pay Now
                  </button>
                )}

                {bill.status === 'paid' && bill.paid_at && (
                  <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3"/> Paid on {formatDate(bill.paid_at)}
                    {bill.payment_mode && ` via ${bill.payment_mode.toUpperCase()}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Appointments Tab ── */}
        {activeTab === 'appointments' && (
          <div className="space-y-3">
            {appointments.length === 0 ? (
              <EmptyState icon={Calendar} text="No upcoming appointments" sub="Book a follow-up using the button above"/>
            ) : appointments.map(appt => (
              <div key={appt.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-gray-900">{appt.type || 'Appointment'}</div>
                    <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3"/>
                      {formatDate(appt.date)} at {appt.time}
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
      </div>

      {/* ── Payment Modal ── */}
      {showPayment && (
        <PaymentModal
          bill={showPayment}
          sessionToken={sessionToken!}
          onClose={() => setShowPayment(null)}
          onPaid={() => { setShowPayment(null); loadData() }}
        />
      )}

      {/* ── Booking Modal ── */}
      {showBooking && (
        <BookingModal
          sessionToken={sessionToken!}
          onClose={() => setShowBooking(false)}
          onBooked={() => { setShowBooking(false); loadData() }}
        />
      )}
    </div>
  )
}

// ── Empty State ────────────────────────────────────────────────

function EmptyState({ icon: Icon, text, sub }: { icon: any; text: string; sub?: string }) {
  return (
    <div className="text-center py-12 text-gray-400">
      <Icon className="w-10 h-10 mx-auto mb-3 opacity-30"/>
      <p className="font-medium text-gray-500">{text}</p>
      {sub && <p className="text-xs mt-1">{sub}</p>}
    </div>
  )
}

// ── Payment Modal ──────────────────────────────────────────────

function PaymentModal({ bill, sessionToken, onClose, onPaid }: {
  bill: any
  sessionToken: string
  onClose: () => void
  onPaid: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [paymentResult, setPaymentResult] = useState<any>(null)
  const [error, setError] = useState('')

  async function initiatePayment() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/portal/pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Portal-Session': sessionToken,
        },
        body: JSON.stringify({ bill_id: bill.id, payment_mode: 'upi' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Payment failed')
      } else {
        setPaymentResult(data)
      }
    } catch {
      setError('Network error')
    }
    setLoading(false)
  }

  async function confirmPayment() {
    setLoading(true)
    try {
      await fetch('/api/portal/pay', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Portal-Session': sessionToken,
        },
        body: JSON.stringify({ bill_id: bill.id, payment_mode: 'upi' }),
      })
      onPaid()
    } catch {
      setError('Failed to confirm payment')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-gray-100 rounded-t-3xl">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-green-500"/> Pay Bill
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
          </div>
        </div>

        <div className="p-5">
          {/* Bill summary */}
          <div className="bg-gray-50 rounded-xl p-4 mb-5">
            <div className="flex justify-between items-center">
              <span className="text-gray-600 text-sm">Amount</span>
              <span className="text-2xl font-bold text-gray-900">{formatCurrency(bill.net_amount)}</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">{formatDate(bill.created_at)}</div>
            {bill.items && Array.isArray(bill.items) && (
              <div className="mt-2 space-y-0.5">
                {bill.items.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between text-xs text-gray-500">
                    <span>{item.label || item.name}</span>
                    <span>{formatCurrency(item.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!paymentResult ? (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}
              <button
                onClick={initiatePayment}
                disabled={loading}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl py-3.5 font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                ) : (
                  <>
                    <IndianRupee className="w-4 h-4"/> Pay {formatCurrency(bill.net_amount)}
                  </>
                )}
              </button>
            </>
          ) : (
            <div className="space-y-4">
              {paymentResult.type === 'razorpay' && (
                <div className="text-center">
                  <p className="text-sm text-gray-600 mb-3">Click below to complete payment:</p>
                  <a href={paymentResult.payment_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-semibold">
                    <ExternalLink className="w-4 h-4"/> Open Payment Page
                  </a>
                </div>
              )}

              {paymentResult.type === 'upi' && (
                <div className="text-center">
                  <p className="text-sm text-gray-600 mb-3">Pay using any UPI app:</p>
                  <a href={paymentResult.payment_url}
                    className="inline-flex items-center gap-2 bg-purple-600 text-white px-6 py-3 rounded-xl font-semibold">
                    <ExternalLink className="w-4 h-4"/> Open UPI App
                  </a>
                  {paymentResult.upi_id && (
                    <p className="text-xs text-gray-500 mt-3">
                      Or pay to UPI ID: <span className="font-mono font-bold">{paymentResult.upi_id}</span>
                    </p>
                  )}
                </div>
              )}

              {paymentResult.type === 'manual' && (
                <div className="text-center">
                  <p className="text-sm text-gray-600">{paymentResult.message}</p>
                </div>
              )}

              {(paymentResult.type === 'razorpay' || paymentResult.type === 'upi') && (
                <button
                  onClick={confirmPayment}
                  disabled={loading}
                  className="w-full mt-4 bg-green-100 text-green-700 rounded-xl py-3 font-semibold text-sm border border-green-200">
                  {loading ? 'Confirming…' : '✓ I have completed the payment'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Booking Modal ──────────────────────────────────────────────

function BookingModal({ sessionToken, onClose, onBooked }: {
  sessionToken: string
  onClose: () => void
  onBooked: () => void
}) {
  const [mode, setMode]       = useState<'choose' | 'video' | 'inperson'>('choose')
  const [slots, setSlots]     = useState<any[]>([])
  const [doctors, setDoctors] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [date, setDate]       = useState('')
  const [time, setTime]       = useState('')
  const [doctor, setDoctor]   = useState('')
  const [notes, setNotes]     = useState('')
  const [booking, setBooking] = useState(false)
  const [booked, setBooked]   = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    loadSlots()
  }, [])

  async function loadSlots() {
    setLoading(true)
    try {
      const res = await fetch('/api/portal/book-followup', {
        headers: { 'X-Portal-Session': sessionToken },
      })
      const data = await res.json()
      if (res.ok) {
        setSlots(data.video_slots || [])
        setDoctors(data.doctors || [])
      }
    } catch {}
    setLoading(false)
  }

  async function confirmBooking() {
    setBooking(true)
    setError('')

    const body: any = { notes }

    if (mode === 'video' && selected) {
      body.slot_id = selected.id
      body.type = 'video'
    } else if (mode === 'inperson') {
      if (!date || !time) {
        setError('Please select date and time')
        setBooking(false)
        return
      }
      body.date = date
      body.time = time
      body.type = 'Follow-up'
      body.doctor_name = doctor || null
    }

    try {
      const res = await fetch('/api/portal/book-followup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Portal-Session': sessionToken,
        },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Booking failed')
      } else {
        setBooked(true)
        setTimeout(onBooked, 2000)
      }
    } catch {
      setError('Network error')
    }
    setBooking(false)
  }

  // Generate time slots
  const timeSlots = []
  for (let h = 9; h <= 18; h++) {
    timeSlots.push(`${h.toString().padStart(2, '0')}:00`)
    if (h < 18) timeSlots.push(`${h.toString().padStart(2, '0')}:30`)
  }

  // Min date = tomorrow
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-gray-100 rounded-t-3xl">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2">
              <CalendarPlus className="w-5 h-5 text-green-500"/> Book Follow-up
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
          </div>
        </div>

        <div className="p-5">
          {booked ? (
            <div className="text-center py-8">
              <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4"/>
              <h3 className="text-lg font-bold text-gray-900">Appointment Booked!</h3>
              <p className="text-gray-500 text-sm mt-2">
                You'll receive a confirmation on your mobile.
              </p>
            </div>
          ) : mode === 'choose' ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 mb-4">How would you like your follow-up?</p>

              <button
                onClick={() => setMode('video')}
                className="w-full text-left p-4 rounded-xl border-2 border-gray-100 hover:border-blue-300 transition-colors flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <Video className="w-5 h-5 text-blue-500"/>
                </div>
                <div>
                  <div className="font-semibold text-gray-900">Video Consultation</div>
                  <div className="text-xs text-gray-500">See a doctor from home</div>
                </div>
              </button>

              <button
                onClick={() => setMode('inperson')}
                className="w-full text-left p-4 rounded-xl border-2 border-gray-100 hover:border-green-300 transition-colors flex items-center gap-3">
                <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-green-500"/>
                </div>
                <div>
                  <div className="font-semibold text-gray-900">In-Person Visit</div>
                  <div className="text-xs text-gray-500">Visit the clinic</div>
                </div>
              </button>
            </div>
          ) : mode === 'video' ? (
            <>
              <button onClick={() => setMode('choose')} className="text-sm text-gray-500 mb-4 hover:text-gray-700">
                ← Back
              </button>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"/>
                </div>
              ) : slots.length === 0 ? (
                <EmptyState icon={Video} text="No video slots available" sub="Please try in-person booking or call the clinic"/>
              ) : (
                <>
                  <p className="text-sm text-gray-600 mb-3">Available video slots:</p>
                  <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                    {slots.map(slot => (
                      <button key={slot.id}
                        onClick={() => setSelected(selected?.id === slot.id ? null : slot)}
                        className={`w-full text-left p-3 rounded-xl border-2 transition-colors ${
                          selected?.id === slot.id
                            ? 'border-blue-400 bg-blue-50'
                            : 'border-gray-100 bg-gray-50 hover:border-gray-200'
                        }`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-gray-900 text-sm">
                              {new Date(slot.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                              {' '}{slot.time}
                            </div>
                            {slot.doctor_name && (
                              <div className="text-xs text-gray-500">Dr. {slot.doctor_name}</div>
                            )}
                          </div>
                          {selected?.id === slot.id && <CheckCircle className="w-5 h-5 text-blue-500"/>}
                        </div>
                      </button>
                    ))}
                  </div>

                  <textarea
                    className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 mb-4"
                    rows={2}
                    placeholder="Reason for visit (optional)"
                    value={notes} onChange={e => setNotes(e.target.value)}
                  />

                  {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

                  <button
                    onClick={confirmBooking}
                    disabled={!selected || booking}
                    className="w-full bg-blue-600 text-white rounded-xl py-3 font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                    {booking ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                      : <Video className="w-4 h-4"/>}
                    {booking ? 'Booking…' : 'Confirm Video Appointment'}
                  </button>
                </>
              )}
            </>
          ) : (
            /* In-person booking */
            <>
              <button onClick={() => setMode('choose')} className="text-sm text-gray-500 mb-4 hover:text-gray-700">
                ← Back
              </button>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    min={tomorrow}
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                  <select
                    value={time}
                    onChange={e => setTime(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
                    <option value="">Select time</option>
                    {timeSlots.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                {doctors.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Doctor (optional)</label>
                    <select
                      value={doctor}
                      onChange={e => setDoctor(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
                      <option value="">Any available doctor</option>
                      {doctors.map((d: any) => (
                        <option key={d.full_name} value={d.full_name}>
                          Dr. {d.full_name}{d.specialization ? ` (${d.specialization})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
                  <textarea
                    className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400"
                    rows={2}
                    placeholder="e.g. Follow-up for fever, prescription refill…"
                    value={notes} onChange={e => setNotes(e.target.value)}
                  />
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}

                <button
                  onClick={confirmBooking}
                  disabled={!date || !time || booking}
                  className="w-full bg-green-600 text-white rounded-xl py-3 font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                  {booking ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                    : <CalendarPlus className="w-4 h-4"/>}
                  {booking ? 'Booking…' : 'Book Appointment'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
