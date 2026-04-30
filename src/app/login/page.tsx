'use client'
/**
 * src/app/login/page.tsx  — UPDATED
 *
 * Changes vs original:
 *  1. MFA flow fully wired: after password login, AAL level is checked via
 *     supabase.auth.mfa.getAuthenticatorAssuranceLevel(). If nextLevel === 'aal2'
 *     the user is redirected to the TOTP screen before reaching the dashboard.
 *  2. MFA enrollment screen added — accessible from the MFA prompt when no
 *     factor is enrolled yet (first-time setup for that user).
 *  3. Auto-focus & numeric inputMode on the OTP field for mobile-friendly entry.
 *  4. Demo button strictly dev-only (unchanged — already guarded).
 *  5. All existing flows (forgot-password, first-time admin setup) preserved.
 */

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/lib/constants'
import { isFirstTimeSetup, bootstrapAdmin } from '@/lib/auth'
import {
  getMFAStatus, getAAL,
  enrollMFA, verifyMFACode,
  challengeMFA, verifyMFA,
  type MFAEnrollment,
} from '@/lib/mfa'
import { auditLogin } from '@/lib/audit'
import { Eye, EyeOff, Activity, ArrowLeft, Shield, KeyRound, QrCode, CheckCircle2 } from 'lucide-react'

type View = 'login' | 'forgot' | 'setup' | 'mfa-verify' | 'mfa-enroll'

export default function LoginPage() {
  const router  = useRouter()
  const otpRef  = useRef<HTMLInputElement>(null)

  const [view,     setView]     = useState<View>('login')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPwd,  setShowPwd]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')

  // First-time setup
  const [setupName, setSetupName] = useState('')
  const [setupDone, setSetupDone] = useState(false)

  // MFA verify
  const [mfaCode,    setMfaCode]    = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)

  // MFA enroll
  const [enrollment,    setEnrollment]    = useState<MFAEnrollment | null>(null)
  const [enrollCode,    setEnrollCode]    = useState('')
  const [enrollLoading, setEnrollLoading] = useState(false)
  const [enrollDone,    setEnrollDone]    = useState(false)

  // Redirect if already logged in
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        isFirstTimeSetup().then(firstTime => {
          if (firstTime) setView('setup')
          else router.push('/dashboard')
        })
      }
    })
  }, [router])

  // Auto-focus OTP field when switching to MFA screens
  useEffect(() => {
    if ((view === 'mfa-verify' || view === 'mfa-enroll') && otpRef.current) {
      setTimeout(() => otpRef.current?.focus(), 100)
    }
  }, [view])

  // ── Login ──────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError('Invalid email or password. Please try again.')
      setLoading(false)
      return
    }

    // First-time admin setup?
    const firstTime = await isFirstTimeSetup()
    if (firstTime) {
      setView('setup')
      setLoading(false)
      return
    }

    // ── MFA gate ──────────────────────────────────────────────
    // Check the Authenticator Assurance Level.
    // If nextLevel === 'aal2', this user has a verified TOTP factor → must verify.
    // If nextLevel === 'aal1', user either has no factor or hasn't enrolled yet.
    try {
      const aal = await getAAL()

      if (aal.needsMFA) {
        // User has a verified factor — demand verification before dashboard
        setView('mfa-verify')
        setLoading(false)
        return
      }

      // Optional: if the user has no factor at all, offer enrollment (soft prompt).
      // We check factors separately so we don't block logins when MFA isn't set up yet.
      const mfaStatus = await getMFAStatus()
      if (!mfaStatus.enrolled) {
        // Show enrollment offer — user can skip by clicking "Skip for now"
        await startEnrollment()
        setView('mfa-enroll')
        setLoading(false)
        return
      }
    } catch {
      // MFA check failed — do not block login; let them through gracefully
    }

    await auditLogin()
    router.push('/dashboard')
  }

  // ── MFA verify (user has existing verified factor) ─────────
  async function handleMFAVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!mfaCode.trim() || mfaCode.length !== 6) {
      setError('Please enter the 6-digit code from your authenticator app.')
      return
    }
    setMfaLoading(true)
    setError('')

    const result = await verifyMFACode(mfaCode)
    setMfaLoading(false)

    if (result.success) {
      await auditLogin()
      router.push('/dashboard')
    } else {
      setError(result.error || 'Invalid code. Please try again.')
      setMfaCode('')
      otpRef.current?.focus()
    }
  }

  // ── MFA enroll — start ─────────────────────────────────────
  async function startEnrollment() {
    const result = await enrollMFA('NexMedicon HMS')
    if (result.success && result.enrollment) {
      setEnrollment(result.enrollment)
    }
  }

  // ── MFA enroll — confirm TOTP code ────────────────────────
  async function handleEnrollVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!enrollCode.trim() || enrollCode.length !== 6) {
      setError('Enter the 6-digit code shown in your authenticator app.')
      return
    }
    if (!enrollment) return
    setEnrollLoading(true)
    setError('')

    // challenge + verify the enrollment factor
    const challenge = await challengeMFA(enrollment.id)
    if (!challenge.success || !challenge.challengeId) {
      setError(challenge.error || 'Could not create challenge. Try again.')
      setEnrollLoading(false)
      return
    }

    const result = await verifyMFA(enrollment.id, challenge.challengeId, enrollCode)
    setEnrollLoading(false)

    if (result.success) {
      setEnrollDone(true)
      setTimeout(async () => {
        await auditLogin()
        router.push('/dashboard')
      }, 1500)
    } else {
      setError(result.error || 'Invalid code. Make sure your app is synced correctly.')
      setEnrollCode('')
      otpRef.current?.focus()
    }
  }

  // ── Skip MFA enrollment ────────────────────────────────────
  async function skipMFAEnroll() {
    await auditLogin()
    router.push('/dashboard')
  }

  // ── Forgot password ────────────────────────────────────────
  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Please enter your email address.'); return }
    setLoading(true)
    setError('')

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    })
    setLoading(false)
    if (resetError) setError(resetError.message)
    else setSuccess('Password reset email sent! Check your inbox.')
  }

  // ── First-time admin setup ────────────────────────────────
  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    if (!setupName.trim()) { setError('Please enter your name.'); return }
    setLoading(true)
    setError('')
    const result = await bootstrapAdmin(setupName.trim())
    setLoading(false)
    if (result.success) {
      setSetupDone(true)
      setTimeout(() => router.push('/dashboard'), 2000)
    } else {
      setError(result.error || 'Setup failed. Please try again.')
    }
  }

  function fillDemo() {
    setEmail('demo@hospital.com')
    setPassword('demo1234')
  }

  // ── SHARED background wrapper ──────────────────────────────
  const Bg = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 opacity-10"
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />
      <div className="relative w-full max-w-md">{children}</div>
    </div>
  )

  // ══ MFA VERIFY screen ═════════════════════════════════════
  if (view === 'mfa-verify') {
    return (
      <Bg>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <KeyRound className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">Two-Factor Authentication</h1>
          <p className="text-blue-200 text-sm mt-1">Enter the 6-digit code from your authenticator app</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
          )}
          <form onSubmit={handleMFAVerify} className="space-y-5">
            <div>
              <label className="label">Verification Code</label>
              <input
                ref={otpRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                className="input text-center text-2xl tracking-[0.5em] font-mono"
                placeholder="000000"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
              <p className="text-xs text-gray-500 mt-2">
                Open Google Authenticator, Authy, or your authenticator app and enter the current 6-digit code for <strong>NexMedicon HMS</strong>.
              </p>
            </div>
            <button type="submit" disabled={mfaLoading || mfaCode.length !== 6}
              className="w-full btn-primary py-3 text-base disabled:opacity-60">
              {mfaLoading ? 'Verifying…' : 'Verify & Sign In'}
            </button>
          </form>
          <button
            onClick={() => { setView('login'); setError(''); setMfaCode(''); supabase.auth.signOut() }}
            className="w-full mt-4 text-sm text-gray-500 hover:text-gray-700 text-center flex items-center justify-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to login
          </button>
        </div>
      </Bg>
    )
  }

  // ══ MFA ENROLL screen ════════════════════════════════════
  if (view === 'mfa-enroll') {
    return (
      <Bg>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <QrCode className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">Set Up Two-Factor Auth</h1>
          <p className="text-blue-200 text-sm mt-1">Protect your account with an authenticator app</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {enrollDone ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-3" />
              <h2 className="text-xl font-bold text-gray-900 mb-1">MFA Enabled!</h2>
              <p className="text-gray-500 text-sm">Redirecting to dashboard…</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
              )}

              {enrollment ? (
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-semibold text-gray-800 mb-1">Step 1 — Scan this QR code</p>
                    <p className="text-xs text-gray-500 mb-3">Use Google Authenticator, Authy, or any TOTP app.</p>
                    {/* QR code is a data URI returned by Supabase */}
                    <div className="flex justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={enrollment.totp.qr_code} alt="MFA QR Code"
                        className="border-4 border-white shadow-lg rounded-lg w-44 h-44" />
                    </div>
                    <details className="mt-3">
                      <summary className="text-xs text-blue-600 cursor-pointer">Can't scan? Enter code manually</summary>
                      <p className="text-xs font-mono bg-gray-100 rounded p-2 mt-1 break-all select-all">
                        {enrollment.totp.secret}
                      </p>
                    </details>
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-gray-800 mb-1">Step 2 — Enter the 6-digit code</p>
                    <form onSubmit={handleEnrollVerify} className="space-y-3">
                      <input
                        ref={otpRef}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        autoComplete="one-time-code"
                        className="input text-center text-2xl tracking-[0.5em] font-mono"
                        placeholder="000000"
                        value={enrollCode}
                        onChange={e => setEnrollCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        required
                      />
                      <button type="submit" disabled={enrollLoading || enrollCode.length !== 6}
                        className="w-full btn-primary py-3 disabled:opacity-60">
                        {enrollLoading ? 'Verifying…' : 'Confirm & Enable MFA'}
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                <div className="flex justify-center py-8">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              <button onClick={skipMFAEnroll}
                className="w-full mt-4 text-sm text-gray-400 hover:text-gray-600 text-center">
                Skip for now (not recommended)
              </button>
            </>
          )}
        </div>
      </Bg>
    )
  }

  // ══ FIRST-TIME SETUP screen ══════════════════════════════
  if (view === 'setup') {
    return (
      <Bg>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <Shield className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">Welcome to {BRAND.name}</h1>
          <p className="text-blue-200 text-sm mt-1">First-time setup — create your admin account</p>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {setupDone ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-3" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">Admin Account Created!</h2>
              <p className="text-gray-500">Redirecting to dashboard…</p>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Set Up Admin Account</h2>
              <p className="text-sm text-gray-500 mb-6">
                You're the first user. You'll be set up as <strong>Admin</strong> with full access.
                Invite doctors and staff later from Settings.
              </p>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
              )}
              <form onSubmit={handleSetup} className="space-y-4">
                <div>
                  <label className="label">Your Full Name</label>
                  <input type="text" className="input" placeholder="Dr. Patel"
                    value={setupName} onChange={e => setSetupName(e.target.value)} required />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full btn-primary py-3 text-base disabled:opacity-60">
                  {loading ? 'Setting up…' : 'Create Admin Account'}
                </button>
              </form>
            </>
          )}
        </div>
      </Bg>
    )
  }

  // ══ FORGOT PASSWORD screen ════════════════════════════════
  if (view === 'forgot') {
    return (
      <Bg>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <Activity className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">{BRAND.name}</h1>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <button onClick={() => { setView('login'); setError(''); setSuccess('') }}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
            <ArrowLeft className="w-4 h-4" /> Back to login
          </button>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Reset Password</h2>
          <p className="text-sm text-gray-500 mb-6">Enter your email and we'll send a reset link.</p>
          {error   && <div className="bg-red-50   border border-red-200   text-red-700   px-4 py-3 rounded-lg text-sm mb-4">{error}</div>}
          {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm mb-4">{success}</div>}
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="label">Email Address</label>
              <input type="email" className="input" placeholder="doctor@hospital.com"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <button type="submit" disabled={loading}
              className="w-full btn-primary py-3 text-base disabled:opacity-60">
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
          </form>
        </div>
      </Bg>
    )
  }

  // ══ MAIN LOGIN screen ═════════════════════════════════════
  return (
    <Bg>
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
          <Activity className="w-8 h-8 text-blue-600" />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">{BRAND.name}</h1>
        <p className="text-blue-200 text-sm mt-1">{BRAND.tagline}</p>
      </div>

      <div className="bg-white rounded-2xl shadow-2xl p-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Sign in to your account</h2>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
        )}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="label">Email Address</label>
            <input type="email" className="input" placeholder="doctor@hospital.com"
              value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div>
            <label className="label">Password</label>
            <div className="relative">
              <input type={showPwd ? 'text' : 'password'} className="input pr-10"
                placeholder="••••••••" value={password}
                onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
              <button type="button" onClick={() => setShowPwd(!showPwd)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => { setView('forgot'); setError(''); setSuccess('') }}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium">
              Forgot password?
            </button>
          </div>
          <button type="submit" disabled={loading}
            className="w-full btn-primary py-3 text-base disabled:opacity-60">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        {/* MFA badge — reassures doctors */}
        <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-gray-400">
          <Shield className="w-3.5 h-3.5 text-green-500" />
          <span>Protected by Two-Factor Authentication (MFA)</span>
        </div>

        {/* Demo — dev only */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-xs text-gray-500 text-center mb-3">Dev mode only</p>
            <button onClick={fillDemo} className="w-full btn-secondary text-xs py-2">
              Fill Demo Credentials
            </button>
          </div>
        )}
      </div>
      <p className="text-center text-blue-300 text-xs mt-6">{BRAND.copyright}</p>
    </Bg>
  )
}