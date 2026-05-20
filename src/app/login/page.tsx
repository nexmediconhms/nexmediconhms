'use client'
/**
 * src/app/login/page.tsx — PASSWORD-PRIMARY LOGIN
 *
 * Simple, fast, reliable login for clinic environments.
 * Password login is PRIMARY. OTP/magic link is available as a secondary option.
 *
 * Design principles:
 *  - Password first (clinics have unreliable internet, doctors hate checking email)
 *  - No runtime bootstrap (admin is pre-created via SQL during deployment)
 *  - MFA optional (can be enabled from Settings)
 *  - Rate limiting to prevent brute force
 *  - Clean, professional UI
 */

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/lib/constants'
import { getAAL, verifyMFACode } from '@/lib/mfa'
import { auditLogin } from '@/lib/audit'
import {
  Eye, EyeOff, Activity, ArrowLeft, Mail,
  Shield, KeyRound, Loader2,
} from 'lucide-react'

type View =
  | 'login'          // Email + password (primary screen)
  | 'otp-send'       // Send OTP (secondary option)
  | 'otp-verify'     // Enter 6-digit OTP code
  | 'forgot'         // Password reset
  | 'mfa-verify'     // MFA verification (if user has TOTP enabled)

// ── Background component
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

// ── Rate limiter hook
function useRateLimiter(max: number, windowMs: number, blockMs: number) {
  const attempts = useRef<number[]>([])
  const blocked = useRef(0)

  function check() {
    const now = Date.now()
    if (blocked.current > now) {
      const mins = Math.ceil((blocked.current - now) / 60000)
      return { ok: false, msg: `Too many attempts. Try again in ${mins} min.` }
    }
    attempts.current = attempts.current.filter(t => t > now - windowMs)
    if (attempts.current.length >= max) {
      blocked.current = now + blockMs
      return { ok: false, msg: `Too many attempts. Locked for ${Math.ceil(blockMs / 60000)} min.` }
    }
    return { ok: true, msg: '' }
  }
  function record() { attempts.current.push(Date.now()) }
  function reset() { attempts.current = []; blocked.current = 0 }
  return { check, record, reset }
}

export default function LoginPage() {
  const router = useRouter()
  const limiter = useRateLimiter(5, 15 * 60000, 30 * 60000)
  const mfaInputRef = useRef<HTMLInputElement>(null)

  const [view, setView] = useState<View>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // OTP state
  const [otpCode, setOtpCode] = useState('')
  const otpInputRef = useRef<HTMLInputElement>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // MFA state
  const [mfaCode, setMfaCode] = useState('')

  // ── On mount: check if already logged in or handle auth callbacks
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('nexmedicon_role_override')
    }

    let redirected = false

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (redirected) return
      if (event === 'PASSWORD_RECOVERY') {
        redirected = true
        router.push('/reset-password')
      }
      if (event === 'SIGNED_IN' && session && view === 'otp-verify') {
        redirected = true
        auditLogin().then(() => router.push('/dashboard'))
      }
    })

    async function init() {
      // Handle auth code in URL (PKCE flow from magic link)
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const hash = window.location.hash

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error && !redirected) {
          redirected = true
          await auditLogin()
          router.push('/dashboard')
        } else if (error) {
          setError('Login link expired or already used. Please sign in again.')
          window.history.replaceState({}, '', '/login')
        }
        return
      }

      if (hash && hash.includes('access_token')) return
      if (hash && hash.includes('type=recovery')) return

      // Check if user is already logged in
      const { data: { session } } = await supabase.auth.getSession()
      if (session && !redirected) {
        redirected = true
        router.push('/dashboard')
      }
    }

    init()
    return () => { subscription.unsubscribe() }
  }, [router])

  // Auto-focus MFA/OTP input
  useEffect(() => {
    if (view === 'mfa-verify') setTimeout(() => mfaInputRef.current?.focus(), 150)
    if (view === 'otp-verify') setTimeout(() => otpInputRef.current?.focus(), 150)
  }, [view])

  // ── Password login (PRIMARY)
  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    setLoading(true)
    setError('')

    const rate = limiter.check()
    if (!rate.ok) { setError(rate.msg); setLoading(false); return }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (authError) {
      limiter.record()
      if (authError.message.includes('Invalid login')) {
        setError('Invalid email or password. Please try again.')
      } else if (authError.message.includes('Email not confirmed')) {
        setError('Email not confirmed. Check your inbox for a confirmation link, or contact your admin.')
      } else {
        setError(authError.message || 'Login failed. Please try again.')
      }
      setLoading(false)
      return
    }

    limiter.reset()

    // Check MFA
    try {
      const aal = await getAAL()
      if (aal.needsMFA) {
        setLoading(false)
        setView('mfa-verify')
        return
      }
    } catch { /* MFA not configured — continue */ }

    await auditLogin()
    router.push('/dashboard')
  }

  // ── MFA verify
  async function handleMFAVerify(e: React.FormEvent) {
    e.preventDefault()
    if (mfaCode.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return }
    setLoading(true)
    setError('')

    const result = await verifyMFACode(mfaCode)
    setLoading(false)

    if (result.success) {
      sessionStorage.setItem('nexmedicon_mfa_verified', 'true')
      await auditLogin()
      router.push('/dashboard')
    } else {
      setError(result.error || 'Invalid code. Try again.')
      setMfaCode('')
      mfaInputRef.current?.focus()
    }
  }

  // ── Forgot password
  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Enter your email first.'); return }
    setLoading(true)
    setError('')

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/auth/callback?type=recovery` }
    )

    setLoading(false)
    if (resetError) setError(resetError.message)
    else setSuccess('Password reset link sent! Check your email (including spam folder).')
  }

  // ── Send OTP (secondary option)
  function startCooldown() {
    setResendCooldown(60)
    if (cooldownRef.current) clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current!); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  async function handleSendOTP(e?: React.FormEvent) {
    e?.preventDefault()
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }
    setLoading(true)
    setError('')

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setLoading(false)

    if (otpError) {
      if (otpError.message.includes('Signups not allowed') || otpError.message.includes('not allowed')) {
        setError('No account found with this email. Contact your admin.')
      } else {
        setError(otpError.message || 'Failed to send code. Try again.')
      }
      return
    }

    setView('otp-verify')
    startCooldown()
    setSuccess(`Code sent to ${email}. Check your inbox.`)
  }

  // ── Verify OTP
  async function handleVerifyOTP(e: React.FormEvent) {
    e.preventDefault()
    if (otpCode.length !== 6) { setError('Enter the 6-digit code.'); return }
    setLoading(true)
    setError('')

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: otpCode,
      type: 'email',
    })

    setLoading(false)

    if (verifyError) {
      setError('Invalid or expired code. Try again or request a new one.')
      setOtpCode('')
      otpInputRef.current?.focus()
      return
    }

    // Check MFA
    try {
      const aal = await getAAL()
      if (aal.needsMFA) { setView('mfa-verify'); return }
    } catch {}

    await auditLogin()
    router.push('/dashboard')
  }

  // ══════════════════════════════════════════════════════════════
  // MFA VERIFY SCREEN
  // ══════════════════════════════════════════════════════════════
  if (view === 'mfa-verify') {
    return (
      <LoginBackground>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <KeyRound className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">Two-Factor Auth</h1>
          <p className="text-blue-200 text-sm mt-1">Enter the code from your authenticator app</p>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>}
          <form onSubmit={handleMFAVerify} className="space-y-5">
            <input
              ref={mfaInputRef}
              type="text" inputMode="numeric" maxLength={6} autoComplete="one-time-code"
              className="input text-center text-2xl tracking-[0.5em] font-mono"
              placeholder="000000"
              value={mfaCode}
              onChange={e => { setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
            />
            <button type="submit" disabled={loading || mfaCode.length !== 6}
              className="w-full btn-primary py-3 text-base disabled:opacity-60">
              {loading ? 'Verifying...' : 'Verify & Sign In'}
            </button>
          </form>
          <button onClick={() => { setView('login'); setError(''); supabase.auth.signOut() }}
            className="w-full mt-4 text-sm text-gray-500 hover:text-gray-700 text-center flex items-center justify-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to login
          </button>
        </div>
      </LoginBackground>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // FORGOT PASSWORD
  // ══════════════════════════════════════════════════════════════
  if (view === 'forgot') {
    return (
      <LoginBackground>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <Mail className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">{BRAND.name}</h1>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <button onClick={() => { setView('login'); setError(''); setSuccess('') }}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
            <ArrowLeft className="w-4 h-4" /> Back to login
          </button>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Reset Password</h2>
          <p className="text-sm text-gray-500 mb-6">We&apos;ll send a reset link to your email.</p>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>}
          {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm mb-4">{success}</div>}
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="label">Email Address</label>
              <input type="email" className="input" placeholder="you@clinic.com"
                value={email} onChange={e => setEmail(e.target.value)} autoFocus required />
            </div>
            <button type="submit" disabled={loading} className="w-full btn-primary py-3 disabled:opacity-60">
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        </div>
      </LoginBackground>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // OTP SEND SCREEN (secondary)
  // ══════════════════════════════════════════════════════════════
  if (view === 'otp-send') {
    return (
      <LoginBackground>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <Mail className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">Email Login Code</h1>
          <p className="text-blue-200 text-sm mt-1">We&apos;ll send a 6-digit code to your email</p>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <button onClick={() => { setView('login'); setError('') }}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
            <ArrowLeft className="w-4 h-4" /> Back to password login
          </button>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>}
          <form onSubmit={handleSendOTP} className="space-y-4">
            <div>
              <label className="label">Email Address</label>
              <input type="email" className="input" placeholder="you@clinic.com"
                value={email} onChange={e => { setEmail(e.target.value); setError('') }} autoFocus required />
            </div>
            <button type="submit" disabled={loading || !email.includes('@')}
              className="w-full btn-primary py-3 disabled:opacity-60 flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {loading ? 'Sending...' : 'Send Login Code'}
            </button>
          </form>
        </div>
      </LoginBackground>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // OTP VERIFY SCREEN
  // ══════════════════════════════════════════════════════════════
  if (view === 'otp-verify') {
    return (
      <LoginBackground>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <Mail className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">Enter Code</h1>
          <p className="text-blue-200 text-sm mt-1">Sent to <strong>{email}</strong></p>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>}
          {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm mb-4">{success}</div>}
          <form onSubmit={handleVerifyOTP} className="space-y-5">
            <input
              ref={otpInputRef}
              type="text" inputMode="numeric" maxLength={6} autoComplete="one-time-code"
              className="input text-center text-2xl tracking-[0.5em] font-mono py-3"
              placeholder="000000"
              value={otpCode}
              onChange={e => { setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
            />
            <button type="submit" disabled={loading || otpCode.length !== 6}
              className="w-full btn-primary py-3 disabled:opacity-60">
              {loading ? 'Verifying...' : 'Verify & Sign In'}
            </button>
          </form>
          <div className="mt-4 text-center">
            {resendCooldown > 0 ? (
              <p className="text-xs text-gray-400">Resend in {resendCooldown}s</p>
            ) : (
              <button onClick={() => { setError(''); setSuccess(''); handleSendOTP() }}
                className="text-sm text-blue-600 hover:underline">Resend code</button>
            )}
          </div>
          <button onClick={() => { setView('login'); setError(''); setSuccess(''); setOtpCode('') }}
            className="w-full mt-3 text-xs text-gray-500 hover:text-gray-700 text-center flex items-center justify-center gap-1">
            <ArrowLeft className="w-3 h-3" /> Back to login
          </button>
        </div>
      </LoginBackground>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // PRIMARY SCREEN — PASSWORD LOGIN
  // ══════════════════════════════════════════════════════════════
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
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Sign in to your account</h2>
        <p className="text-sm text-gray-500 mb-6">
          Enter your email and password to access the system.
        </p>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>}

        <form onSubmit={handlePasswordLogin} className="space-y-4">
          <div>
            <label className="label">Email Address</label>
            <input
              type="email"
              className="input"
              placeholder="doctor@clinic.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
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
                placeholder="Enter your password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowPwd(p => !p)} tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={() => { setView('forgot'); setError(''); setSuccess('') }}
              className="text-xs text-blue-500 hover:text-blue-700 hover:underline">
              Forgot password?
            </button>
          </div>

          <button type="submit" disabled={loading || !email.includes('@') || !password}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl
                       text-base disabled:opacity-60 flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-200">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Secondary: OTP login */}
        <div className="mt-6 pt-5 border-t border-gray-100 text-center">
          <button onClick={() => { setView('otp-send'); setError('') }}
            className="text-sm text-gray-500 hover:text-gray-700 hover:underline">
            Sign in with email code instead (passwordless)
          </button>
        </div>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-gray-400">
          <Shield className="w-3.5 h-3.5 text-green-500" />
          <span>Secured with end-to-end encryption</span>
        </div>
      </div>

      <p className="text-center text-blue-300 text-xs mt-6">{BRAND.copyright}</p>
    </LoginBackground>
  )
}
