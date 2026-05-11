'use client'
/**
 * src/app/portal/login/page.tsx
 *
 * Patient Portal Login Page
 * - Enter mobile number → receive OTP via WhatsApp/SMS
 * - Enter OTP → get session → redirect to dashboard
 * - Also handles magic link token verification via URL param
 */

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Heart, Phone, Shield, ArrowRight, RefreshCw,
  CheckCircle, AlertCircle, Smartphone
} from 'lucide-react'

function PortalLoginContent() {
  const router = useRouter()
  const params = useSearchParams()
  const tokenFromUrl = params.get('token')

  const [step, setStep] = useState<'mobile' | 'otp' | 'verifying' | 'success' | 'error'>('mobile')
  const [mobile, setMobile] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [patientName, setPatientName] = useState('')
  const [resendTimer, setResendTimer] = useState(0)

  // Check if already logged in
  useEffect(() => {
    const session = localStorage.getItem('portal_session')
    if (session) {
      router.replace('/portal/dashboard')
    }
  }, [])

  // Handle magic link token from URL
  useEffect(() => {
    if (tokenFromUrl) {
      verifyMagicLink(tokenFromUrl)
    }
  }, [tokenFromUrl])

  // Resend timer countdown
  useEffect(() => {
    if (resendTimer > 0) {
      const t = setTimeout(() => setResendTimer(resendTimer - 1), 1000)
      return () => clearTimeout(t)
    }
  }, [resendTimer])

  async function verifyMagicLink(token: string) {
    setStep('verifying')
    try {
      const res = await fetch('/api/portal/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Invalid link')
        setStep('error')
        return
      }
      // Save session
      localStorage.setItem('portal_session', data.session_token)
      localStorage.setItem('portal_patient', JSON.stringify(data.patient))
      setPatientName(data.patient?.full_name || '')
      setStep('success')
      setTimeout(() => router.replace('/portal/dashboard'), 1500)
    } catch {
      setError('Network error. Please try again.')
      setStep('error')
    }
  }

  async function sendOtp() {
    if (mobile.length < 10) {
      setError('Please enter a valid 10-digit mobile number')
      return
    }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/portal/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to send OTP')
        setLoading(false)
        return
      }
      setPatientName(data.patient_name || '')
      setStep('otp')
      setResendTimer(60)

      // In dev mode, auto-fill OTP
      if (data.otp_code) {
        setOtp(data.otp_code)
      }
    } catch {
      setError('Network error. Please check your connection.')
    }
    setLoading(false)
  }

  async function verifyOtp() {
    if (otp.length < 6) {
      setError('Please enter the 6-digit OTP')
      return
    }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/portal/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile, otp }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Verification failed')
        setLoading(false)
        return
      }
      // Save session
      localStorage.setItem('portal_session', data.session_token)
      localStorage.setItem('portal_patient', JSON.stringify(data.patient))
      setPatientName(data.patient?.full_name || '')
      setStep('success')
      setTimeout(() => router.replace('/portal/dashboard'), 1500)
    } catch {
      setError('Network error. Please try again.')
    }
    setLoading(false)
  }

  // ── Verifying magic link ──
  if (step === 'verifying') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
          <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"/>
          <p className="text-gray-600 font-medium">Verifying your link…</p>
        </div>
      </div>
    )
  }

  // ── Error state ──
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
          <AlertCircle className="w-14 h-14 text-red-400 mx-auto mb-4"/>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Link Invalid or Expired</h2>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <button
            onClick={() => { setStep('mobile'); setError('') }}
            className="w-full bg-blue-600 text-white rounded-xl py-3 font-semibold hover:bg-blue-700 transition-colors">
            Login with Mobile Number
          </button>
        </div>
      </div>
    )
  }

  // ── Success state ──
  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4"/>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Welcome!</h2>
          <p className="text-gray-500">{patientName || 'Redirecting to your portal…'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Heart className="w-8 h-8 text-white"/>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Patient Portal</h1>
          <p className="text-gray-500 text-sm mt-1">
            View prescriptions, reports & pay bills
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-3xl shadow-xl p-6">
          {step === 'mobile' ? (
            <>
              <div className="mb-5">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <Phone className="w-4 h-4 inline mr-1"/> Mobile Number
                </label>
                <div className="flex items-center border-2 border-gray-200 rounded-xl overflow-hidden focus-within:border-blue-400 transition-colors">
                  <span className="px-3 py-3 bg-gray-50 text-gray-500 font-medium text-sm border-r">+91</span>
                  <input
                    type="tel"
                    maxLength={10}
                    placeholder="Enter 10-digit mobile"
                    value={mobile}
                    onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    onKeyDown={e => e.key === 'Enter' && sendOtp()}
                    className="flex-1 px-3 py-3 text-lg font-mono focus:outline-none"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                  <Shield className="w-3 h-3"/> Enter the number registered with the hospital
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                onClick={sendOtp}
                disabled={loading || mobile.length < 10}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl py-3.5 font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:shadow-lg transition-shadow">
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                ) : (
                  <>Send OTP <ArrowRight className="w-4 h-4"/></>
                )}
              </button>
            </>
          ) : (
            <>
              {/* OTP Entry */}
              <div className="text-center mb-5">
                <Smartphone className="w-10 h-10 text-blue-500 mx-auto mb-2"/>
                <p className="text-sm text-gray-600">
                  OTP sent to <span className="font-bold">+91 {mobile.slice(0, 3)}****{mobile.slice(7)}</span>
                </p>
                {patientName && (
                  <p className="text-xs text-green-600 mt-1 font-medium">
                    Hi {patientName.split(' ')[0]}! 👋
                  </p>
                )}
              </div>

              <div className="mb-5">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Enter 6-digit OTP
                </label>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="● ● ● ● ● ●"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => e.key === 'Enter' && verifyOtp()}
                  className="w-full text-center text-2xl font-mono tracking-[0.5em] border-2 border-gray-200 rounded-xl py-3 focus:outline-none focus:border-blue-400 transition-colors"
                  autoFocus
                />
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                onClick={verifyOtp}
                disabled={loading || otp.length < 6}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl py-3.5 font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:shadow-lg transition-shadow">
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                ) : (
                  <>Verify & Login <CheckCircle className="w-4 h-4"/></>
                )}
              </button>

              <div className="flex items-center justify-between mt-4">
                <button
                  onClick={() => { setStep('mobile'); setOtp(''); setError('') }}
                  className="text-sm text-gray-500 hover:text-gray-700">
                  ← Change number
                </button>
                <button
                  onClick={sendOtp}
                  disabled={resendTimer > 0}
                  className="text-sm text-blue-600 hover:text-blue-700 disabled:text-gray-400 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3"/>
                  {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          🔒 Your data is encrypted and secure
        </p>
      </div>
    </div>
  )
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"/>
      </div>
    }>
      <PortalLoginContent/>
    </Suspense>
  )
}
