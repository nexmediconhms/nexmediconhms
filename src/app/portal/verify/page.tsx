'use client'
/**
 * src/app/portal/verify/page.tsx
 *
 * Magic Link Verification Page
 * Handles the ?token=xxx parameter from magic links sent via WhatsApp.
 * Verifies the token and redirects to dashboard.
 *
 * BULLETPROOF VERSION (2026-06-03):
 *   - Detects token in URL even if path normalization issues occurred
 *   - Falls back to extracting token from window.location if useSearchParams fails
 *   - Shows clear error messages with retry options
 *   - Auto-recovers from common URL issues
 */

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle, AlertCircle, Heart, RefreshCw } from 'lucide-react'

function VerifyContent() {
  const router = useRouter()
  const params = useSearchParams()

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying')
  const [error, setError]   = useState('')
  const [name, setName]     = useState('')
  const [token, setToken]   = useState<string | null>(null)

  // Extract token from URL — multiple fallbacks for robustness
  useEffect(() => {
    let extractedToken: string | null = null

    // Method 1: Next.js useSearchParams (preferred)
    extractedToken = params.get('token')

    // Method 2: Fall back to window.location.search if Next.js parser failed
    if (!extractedToken && typeof window !== 'undefined') {
      try {
        const urlParams = new URLSearchParams(window.location.search)
        extractedToken = urlParams.get('token')
      } catch {
        // Ignore parsing errors
      }
    }

    // Method 3: Last resort — manual regex extraction
    if (!extractedToken && typeof window !== 'undefined') {
      const match = window.location.href.match(/[?&]token=([a-zA-Z0-9-]+)/)
      if (match) extractedToken = match[1]
    }

    if (!extractedToken) {
      setError('No verification token found in the link. Please request a new portal link from the hospital.')
      setStatus('error')
      return
    }

    setToken(extractedToken)
    verify(extractedToken)
  }, [params])

  async function verify(t: string) {
    try {
      const res = await fetch('/api/portal/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Verification failed. The link may have expired.')
        setStatus('error')
        return
      }

      // Save session
      try {
        localStorage.setItem('portal_session', data.session_token)
        localStorage.setItem('portal_patient', JSON.stringify(data.patient))
      } catch {
        // localStorage might be disabled — proceed anyway
      }

      setName(data.patient?.full_name || '')
      setStatus('success')

      // Redirect to dashboard after brief success message
      setTimeout(() => router.replace('/portal/dashboard'), 1500)
    } catch (err) {
      console.error('[portal/verify] Network error:', err)
      setError('Network error. Please check your connection and try again.')
      setStatus('error')
    }
  }

  function retry() {
    if (token) {
      setStatus('verifying')
      setError('')
      verify(token)
    } else {
      router.push('/portal/login')
    }
  }

  if (status === 'verifying') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-5"/>
          <h2 className="text-lg font-bold text-gray-800 mb-2">Verifying your link…</h2>
          <p className="text-gray-500 text-sm">Please wait a moment</p>
        </div>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4"/>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Welcome back!</h2>
          <p className="text-gray-500">{name || 'Redirecting to your portal…'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
        <AlertCircle className="w-14 h-14 text-red-400 mx-auto mb-4"/>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Link Invalid or Expired</h2>
        <p className="text-gray-500 text-sm mb-6">{error}</p>
        <div className="space-y-2">
          <button
            onClick={retry}
            className="w-full bg-blue-600 text-white rounded-xl py-3 font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
          <button
            onClick={() => router.push('/portal/login')}
            className="w-full bg-gray-100 text-gray-700 rounded-xl py-3 font-semibold hover:bg-gray-200 transition-colors">
            Login with Mobile Number
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-4">
          Magic links expire after 10 minutes for security.
        </p>
      </div>
    </div>
  )
}

export default function PortalVerifyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"/>
      </div>
    }>
      <VerifyContent/>
    </Suspense>
  )
}
