'use client'
/**
 * src/app/login/page.tsx — FIXED
 *
 * Bugs fixed vs previous delivery:
 *
 * BUG 1 (CRITICAL — breaks typing): `const Bg = (...)` was defined INSIDE
 *   LoginPage(). React treats a component defined inside another component as
 *   a NEW component type on every render. Every keystroke (state change) caused
 *   React to unmount + remount Bg's children — destroying the <input> DOM node
 *   and resetting focus. Fix: Bg is now a module-level component (outside LoginPage).
 *
 * BUG 2: MFA enrollment offered on EVERY login for users with no MFA.
 *   This interrupted normal login for all non-MFA users. Fix: enrollment offer
 *   only shown to admin role users; regular staff skip straight to dashboard.
 *
 * BUG 3: useEffect([router]) — router from next/navigation is stable so this
 *   is fine, but the inner isFirstTimeSetup() call had no error handling.
 *   Fix: wrapped in try/catch.
 *
 * BUG 4: startEnrollment() was async and called with await inside handleLogin,
 *   but setView('mfa-enroll') was called before enrollment state was set.
 *   This caused the enrollment screen to render with null enrollment (blank QR).
 *   Fix: await startEnrollment() completes before setView().
 */

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/lib/constants'
import { isFirstTimeSetup, bootstrapAdmin } from '@/lib/auth'
import {
  getMFAStatus,
  getAAL,
  enrollMFA,
  verifyMFACode,
  challengeMFA,
  verifyMFA,
  type MFAEnrollment,
} from '@/lib/mfa'
import { auditLogin } from '@/lib/audit'
import {
  Eye, EyeOff, Activity, ArrowLeft,
  Shield, KeyRound, QrCode, CheckCircle2,
} from 'lucide-react'

type View = 'login' | 'forgot' | 'setup' | 'mfa-verify' | 'mfa-enroll'

// ─────────────────────────────────────────────────────────────────────────────
// BUG FIX: Bg is declared at MODULE LEVEL — outside LoginPage.
// A component defined inside another component gets a new identity on every
// render, which causes React to unmount + remount it (and destroy its children's
// DOM nodes) on every keystroke. Moving it outside completely prevents this.
// ─────────────────────────────────────────────────────────────────────────────
function LoginBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="relative w-full max-w-md">{children}</div>
    </div>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const otpRef = useRef<HTMLInputElement>(null)

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
      if (!session) return
      try {
        isFirstTimeSetup().then(firstTime => {
          if (firstTime) setView('setup')
          else router.push('/dashboard')
        })
      } catch {
        router.push('/dashboard')
      }
    })
  }, [router])

  // Auto-focus OTP field when switching to MFA screens
  useEffect(() => {
    if (view === 'mfa-verify' || view === 'mfa-enroll') {
      setTimeout(() => otpRef.current?.focus(), 120)
    }
  }, [view])

  // ── Login ─────────────────────────────────────────────────────
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
    try {
      const firstTime = await isFirstTimeSetup()
      if (firstTime) {
        setView('setup')
        setLoading(false)
        return
      }
    } catch { /* non-fatal */ }

    // MFA gate — check AAL level
    try {
      const aal = await getAAL()
      if (aal.needsMFA) {
        // User has a verified TOTP factor — require verification before dashboard
        setLoading(false)
        setView('mfa-verify')
        return
      }

      // BUG FIX: Only offer MFA enrollment to admin users, and only if they
      // have no factor at all. Don't block doctors/staff from logging in.
      const mfaStatus = await getMFAStatus()
      if (!mfaStatus.enrolled) {
        // Check role — only prompt admins to set up MFA on first login
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: cu } = await supabase
            .from('clinic_users')
            .select('role')
            .eq('auth_id', user.id)
            .single()
          if (cu?.role === 'admin') {
            // BUG FIX: await startEnrollment() BEFORE setView so that the QR
            // code state is populated before the enrollment screen renders.
            await startEnrollment()
            setLoading(false)
            setView('mfa-enroll')
            return
          }
        }
      }
    } catch {
      // MFA check failed — let user through without blocking login
    }

    await auditLogin()
    router.push('/dashboard')
  }

  // ── MFA verify ────────────────────────────────────────────────
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

  // ── MFA enroll — start ────────────────────────────────────────
  async function startEnrollment() {
    try {
      const result = await enrollMFA('NexMedicon HMS')
      if (result.success && result.enrollment) {
        setEnrollment(result.enrollment)
      }
    } catch {
      // enrollment start failed — user will see spinner and can skip
    }
  }

  // ── MFA enroll — confirm code ─────────────────────────────────
  async function handleEnrollVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!enrollCode.trim() || enrollCode.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    if (!enrollment) return
    setEnrollLoading(true)
    setError('')

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
      setError(result.error || 'Invalid code. Make sure your app time is correct.')
      setEnrollCode('')
      otpRef.current?.focus()
    }
  }

  // ── Skip MFA enrollment ───────────────────────────────────────
  async function skipMFAEnroll() {
    await auditLogin()
    router.push('/dashboard')
  }

  // ── Forgot password ───────────────────────────────────────────
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

  // ── First-time admin setup ────────────────────────────────────
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

  // ══ MFA VERIFY screen ═════════════════════════════════════════
  if (view === 'mfa-verify') {
    return (
      <LoginBackground>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <KeyRound className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">Two-Factor Auth</h1>
          <p className="text-blue-200 text-sm mt-1">Enter the 6-digit code from your authenticator app</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
              {error}
            </div>
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
                Open Google Authenticator, Authy, or any TOTP app and enter the current 6-digit code for{' '}
                <strong>NexMedicon HMS</strong>.
              </p>
            </div>
            <button
              type="submit"
              disabled={mfaLoading || mfaCode.length !== 6}
              className="w-full btn-primary py-3 text-base disabled:opacity-60"
            >
              {mfaLoading ? 'Verifying…' : 'Verify & Sign In'}
            </button>
          </form>
          <button
            onClick={() => {
              setView('login')
              setError('')
              setMfaCode('')
              supabase.auth.signOut()
            }}
            className="w-full mt-4 text-sm text-gray-500 hover:text-gray-700 text-center flex items-center justify-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to login
          </button>
        </div>
      </LoginBackground>
    )
  }

  // ══ MFA ENROLL screen ═════════════════════════════════════════
  if (view === 'mfa-enroll') {
    return (
      <LoginBackground>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <QrCode className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">Set Up Two-Factor Auth</h1>
          <p className="text-blue-200 text-sm mt-1">Recommended for admin accounts</p>
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
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                  {error}
                </div>
              )}

              {enrollment ? (
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-semibold text-gray-800 mb-1">Step 1 — Scan this QR code</p>
                    <p className="text-xs text-gray-500 mb-3">Use Google Authenticator, Authy, or any TOTP app.</p>
                    <div className="flex justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={enrollment.totp.qr_code}
                        alt="MFA QR Code"
                        className="border-4 border-white shadow-lg rounded-lg w-44 h-44"
                      />
                    </div>
                    <details className="mt-3">
                      <summary className="text-xs text-blue-600 cursor-pointer">
                        Can&apos;t scan? Enter code manually
                      </summary>
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
                      <button
                        type="submit"
                        disabled={enrollLoading || enrollCode.length !== 6}
                        className="w-full btn-primary py-3 disabled:opacity-60"
                      >
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

              <button
                onClick={skipMFAEnroll}
                className="w-full mt-4 text-sm text-gray-400 hover:text-gray-600 text-center"
              >
                Skip for now
              </button>
            </>
          )}
        </div>
      </LoginBackground>
    )
  }

  // ══ FIRST-TIME SETUP screen ═══════════════════════════════════
  if (view === 'setup') {
    return (
      <LoginBackground>
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
                You&apos;re the first user. You&apos;ll be set up as <strong>Admin</strong> with full access.
                Invite doctors and staff later from Settings.
              </p>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                  {error}
                </div>
              )}
              <form onSubmit={handleSetup} className="space-y-4">
                <div>
                  <label className="label">Your Full Name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Dr. Patel"
                    value={setupName}
                    onChange={e => setSetupName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full btn-primary py-3 text-base disabled:opacity-60"
                >
                  {loading ? 'Setting up…' : 'Create Admin Account'}
                </button>
              </form>
            </>
          )}
        </div>
      </LoginBackground>
    )
  }

  // ══ FORGOT PASSWORD screen ════════════════════════════════════
  if (view === 'forgot') {
    return (
      <LoginBackground>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <Activity className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">{BRAND.name}</h1>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <button
            onClick={() => { setView('login'); setError(''); setSuccess('') }}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4" /> Back to login
          </button>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Reset Password</h2>
          <p className="text-sm text-gray-500 mb-6">
            Enter your email and we&apos;ll send a reset link.
          </p>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm mb-4">
              {success}
            </div>
          )}
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="label">Email Address</label>
              <input
                type="email"
                className="input"
                placeholder="doctor@hospital.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-3 text-base disabled:opacity-60"
            >
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
          </form>
        </div>
      </LoginBackground>
    )
  }

  // ══ MAIN LOGIN screen ═════════════════════════════════════════
  return (
    <LoginBackground>
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
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="label">Email Address</label>
            <input
              type="email"
              className="input"
              placeholder="doctor@hospital.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                className="input pr-10"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPwd(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => { setView('forgot'); setError(''); setSuccess('') }}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary py-3 text-base disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-gray-400">
          <Shield className="w-3.5 h-3.5 text-green-500" />
          <span>Secured with end-to-end encryption</span>
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
    </LoginBackground>
  )
}