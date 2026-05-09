'use client'

/**
 * src/app/reset-password/page.tsx
 *
 * Password reset page — shown after user clicks the reset link from email.
 * The user arrives here with an active session (set by the auth callback or login page).
 * 
 * If MFA is enabled, the user must verify their TOTP code first (to elevate to AAL2)
 * before they can update their password.
 */

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/lib/constants'
import { getAAL, verifyMFACode } from '@/lib/mfa'
import { Activity, Eye, EyeOff, CheckCircle2, AlertCircle, KeyRound } from 'lucide-react'

type Step = 'loading' | 'no-session' | 'mfa-verify' | 'reset-form' | 'success'

export default function ResetPasswordPage() {
  const router = useRouter()
  const otpRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('loading')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirmPwd, setShowConfirmPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // MFA
  const [mfaCode, setMfaCode] = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)

  // Check if user has a valid session and determine if MFA is needed
  useEffect(() => {
    let mounted = true
    let timeoutId: NodeJS.Timeout

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return
        if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session) {
            checkMFARequirement()
          }
        }
      }
    )

    async function checkMFARequirement() {
      if (!mounted) return
      try {
        const aal = await getAAL()
        if (!mounted) return
        if (aal.needsMFA) {
          // User has MFA enabled but session is only AAL1 — need TOTP verification
          setStep('mfa-verify')
          setTimeout(() => otpRef.current?.focus(), 120)
        } else {
          // No MFA needed or already AAL2 — show password form
          setStep('reset-form')
        }
      } catch {
        // If AAL check fails, try showing the form anyway
        if (mounted) setStep('reset-form')
      }
    }

    // Check existing session with retries
    async function checkSession(attempt = 0) {
      if (!mounted) return

      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        await checkMFARequirement()
        return
      }

      // Retry up to 5 times with increasing delays
      if (attempt < 5) {
        timeoutId = setTimeout(() => checkSession(attempt + 1), 500 * (attempt + 1))
      } else {
        if (mounted) setStep('no-session')
      }
    }

    checkSession()

    return () => {
      mounted = false
      subscription.unsubscribe()
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  // Handle MFA verification to elevate session to AAL2
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
      setStep('reset-form')
    } else {
      setError(result.error || 'Invalid code. Please try again.')
      setMfaCode('')
      otpRef.current?.focus()
    }
  }

  // Handle password reset
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    const { error: updateError } = await supabase.auth.updateUser({
      password: password,
    })

    setLoading(false)

    if (updateError) {
      // If still getting AAL2 error, show MFA step again
      if (updateError.message.includes('AAL2') || updateError.message.includes('MFA')) {
        setError('MFA verification required. Please verify your authenticator code first.')
        setStep('mfa-verify')
        setTimeout(() => otpRef.current?.focus(), 120)
      } else {
        setError(updateError.message)
      }
    } else {
      setStep('success')
      // Sign out and redirect to login after 3 seconds
      setTimeout(async () => {
        await supabase.auth.signOut()
        router.push('/login')
      }, 3000)
    }
  }

  // ── Loading state ──────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white text-sm">Verifying your reset link…</p>
        </div>
      </div>
    )
  }

  // ── No session — invalid/expired link ──────────────────────────
  if (step === 'no-session') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-3xl font-bold text-white">{BRAND.name}</h1>
          </div>
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid or Expired Link</h2>
            <p className="text-sm text-gray-500 mb-6">
              This password reset link is invalid or has expired. Please request a new one from the login page.
            </p>
            <button
              onClick={() => router.push('/login')}
              className="w-full btn-primary py-3 text-base"
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── MFA Verification step ──────────────────────────────────────
  if (step === 'mfa-verify') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
              <KeyRound className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-white">{BRAND.name}</h1>
            <p className="text-blue-200 text-sm mt-1">MFA verification required to reset password</p>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Verify Your Identity</h2>
            <p className="text-sm text-gray-500 mb-6">
              Your account has two-factor authentication enabled. Enter the 6-digit code from your authenticator app to continue.
            </p>

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
                {mfaLoading ? 'Verifying…' : 'Verify & Continue'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // ── Success state ──────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
              <Activity className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-white">{BRAND.name}</h1>
          </div>
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Password Updated!</h2>
            <p className="text-gray-500 text-sm">
              Your password has been successfully reset. Redirecting to login…
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Password reset form ────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <Activity className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">{BRAND.name}</h1>
          <p className="text-blue-200 text-sm mt-1">Set your new password</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Create New Password</h2>
          <p className="text-sm text-gray-500 mb-6">
            Enter your new password below. Make sure it&apos;s at least 6 characters.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="label">New Password</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoFocus
                  required
                  minLength={6}
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

            <div>
              <label className="label">Confirm New Password</label>
              <div className="relative">
                <input
                  type={showConfirmPwd ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPwd(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showConfirmPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-3 text-base disabled:opacity-60"
            >
              {loading ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
