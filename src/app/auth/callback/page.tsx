'use client'

/**
 * src/app/auth/callback/page.tsx
 *
 * Client-side auth callback handler.
 * Processes auth redirects from Supabase:
 *   - Password recovery (code exchange → /reset-password)
 *   - Magic link / OTP verification (code exchange → /dashboard)
 *   - Email confirmation (code exchange → /dashboard)
 *
 * Uses window.location.search instead of useSearchParams() to avoid
 * Next.js 14 Suspense boundary requirement.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState('')

  useEffect(() => {
    let redirected = false

    // Listen for auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (redirected) return
        if (event === 'PASSWORD_RECOVERY') {
          redirected = true
          router.push('/reset-password')
        } else if (event === 'SIGNED_IN' && session) {
          // Magic link / OTP sign-in via link click
          redirected = true
          router.push('/dashboard')
        }
      }
    )

    async function handleCallback() {
      if (typeof window === 'undefined') return

      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const type = params.get('type')
      const hash = window.location.hash

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

        if (exchangeError) {
          setError('Failed to verify the link. It may have expired. Please request a new one.')
          setTimeout(() => {
            if (!redirected) {
              redirected = true
              router.push('/login')
            }
          }, 3000)
          return
        }

        // Determine redirect based on type
        if (!redirected) {
          redirected = true
          if (type === 'recovery') {
            router.push('/reset-password')
          } else {
            // Magic link login or email confirmation → dashboard
            router.push('/dashboard')
          }
        }
      } else if (hash && hash.includes('type=recovery')) {
        // Implicit flow — wait for PASSWORD_RECOVERY event from onAuthStateChange
        setTimeout(() => {
          if (!redirected) {
            redirected = true
            router.push('/reset-password')
          }
        }, 3000)
      } else if (hash && (hash.includes('access_token') || hash.includes('type=magiclink'))) {
        // Magic link via hash fragment — Supabase will process and fire SIGNED_IN
        setTimeout(() => {
          if (!redirected) {
            redirected = true
            router.push('/dashboard')
          }
        }, 3000)
      } else {
        // No code, no hash — redirect to login
        if (!redirected) {
          redirected = true
          router.push('/login')
        }
      }
    }

    handleCallback()

    return () => { subscription.unsubscribe() }
  }, [router])

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
          <p className="text-red-600 font-medium mb-2">Link Verification Failed</p>
          <p className="text-sm text-gray-500">{error}</p>
          <p className="text-xs text-gray-400 mt-4">Redirecting to login…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-white text-sm">Verifying your link…</p>
      </div>
    </div>
  )
}