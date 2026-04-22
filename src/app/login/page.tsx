'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/lib/constants'
import { isFirstTimeSetup, bootstrapAdmin } from '@/lib/auth'
import { Eye, EyeOff, Activity, ArrowLeft, UserPlus, Shield } from 'lucide-react'

type View = 'login' | 'forgot' | 'setup'

export default function LoginPage() {
  const router = useRouter()
  const [view,     setView]     = useState<View>('login')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPwd,  setShowPwd]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')

  // First-time setup state
  const [isSetup,    setIsSetup]    = useState(false)
  const [setupName,  setSetupName]  = useState('')
  const [setupDone,  setSetupDone]  = useState(false)

  // Check if this is a fresh install (no users yet)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // Already logged in — check if first-time setup needed
        isFirstTimeSetup().then(firstTime => {
          if (firstTime) {
            setIsSetup(true)
            setView('setup')
          } else {
            router.push('/dashboard')
          }
        })
      }
    })
  }, [router])

  // ── Login handler ──────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError('Invalid email or password. Please try again.')
      setLoading(false)
      return
    }

    // Check if first-time setup is needed
    const firstTime = await isFirstTimeSetup()
    if (firstTime) {
      setIsSetup(true)
      setView('setup')
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  // ── Forgot password handler ────────────────────────────────
  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Please enter your email address'); return }
    setLoading(true)
    setError('')

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    })

    setLoading(false)
    if (resetError) {
      setError(resetError.message)
    } else {
      setSuccess('Password reset email sent! Check your inbox and follow the link to reset your password.')
    }
  }

  // ── First-time admin setup handler ─────────────────────────
  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    if (!setupName.trim()) { setError('Please enter your name'); return }
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

  // ── Demo credentials fill ──────────────────────────────────
  function fillDemo() {
    setEmail('demo@hospital.com')
    setPassword('demo1234')
  }

  // ── First-time setup screen ────────────────────────────────
  if (view === 'setup') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />

        <div className="relative w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
              <Shield className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Welcome to {BRAND.name}</h1>
            <p className="text-blue-200 text-sm mt-1">First-time setup — create your admin account</p>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            {setupDone ? (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Admin Account Created!</h2>
                <p className="text-gray-500">Redirecting to dashboard...</p>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Set Up Admin Account</h2>
                <p className="text-sm text-gray-500 mb-6">
                  You're the first user. You'll be set up as the <strong>Admin</strong> with full access.
                  You can invite doctors and staff later from Settings.
                </p>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSetup} className="space-y-4">
                  <div>
                    <label className="label">Your Full Name</label>
                    <input type="text" className="input" placeholder="Dr. Patel"
                      value={setupName} onChange={e => setSetupName(e.target.value)} required />
                  </div>
                  <button type="submit" disabled={loading}
                    className="w-full btn-primary py-3 text-base disabled:opacity-60">
                    {loading ? 'Setting up...' : 'Create Admin Account'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Forgot password screen ─────────────────────────────────
  if (view === 'forgot') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />

        <div className="relative w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
              <Activity className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">{BRAND.name}</h1>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <button onClick={() => { setView('login'); setError(''); setSuccess('') }}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
              <ArrowLeft className="w-4 h-4" /> Back to login
            </button>

            <h2 className="text-xl font-semibold text-gray-900 mb-2">Reset Password</h2>
            <p className="text-sm text-gray-500 mb-6">
              Enter your email address and we'll send you a link to reset your password.
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
                <input type="email" className="input" placeholder="doctor@hospital.com"
                  value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <button type="submit" disabled={loading}
                className="w-full btn-primary py-3 text-base disabled:opacity-60">
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // ── Main login screen ──────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 opacity-10"
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />

      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
            <Activity className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">{BRAND.name}</h1>
          <p className="text-blue-200 text-sm mt-1">{BRAND.tagline}</p>
        </div>

        {/* Card */}
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
              <input type="email" className="input" placeholder="doctor@hospital.com"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input type={showPwd ? 'text' : 'password'} className="input pr-10"
                  placeholder="••••••••" value={password}
                  onChange={e => setPassword(e.target.value)} required />
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
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Demo mode — only shown in development */}
          {process.env.NODE_ENV === 'development' && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs text-gray-500 text-center mb-3">Demo Mode (dev only)</p>
              <button onClick={fillDemo} className="w-full btn-secondary text-xs py-2">
                Fill Demo Credentials (demo@hospital.com)
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-blue-300 text-xs mt-6">{BRAND.copyright}</p>
      </div>
    </div>
  )
}
