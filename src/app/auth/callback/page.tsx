'use client'

/**
 * src/app/auth/callback/page.tsx
 *
 * Client-side auth callback handler.
 * Processes the `code` query parameter from Supabase auth redirects (PKCE flow).
 * Exchanges the code for a session, then redirects based on the auth event type.
 */

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthCallbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState('')

  useEffect(() => {
    const code = searchParams.get('code')
    let redirected = false

    // Listen for auth events to determine the type of callback
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (redirected) return
        if (event === 'PASSWORD_RECOVERY') {
          redirected = true
          router.push('/reset-password')
        } else if (event === 'SIGNED_IN' && session) {
          // Wait a moment to see if PASSWORD_RECOVERY fires after SIGNED_IN
          setTimeout(() => {
            if (!redirected) {
              redirected = true
              router.push('/dashboard')
            }
          }, 1000)
        }
      }
    )

    async function handleCallback() {
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

        if (exchangeError) {
          setError('Failed to verify the link. It may have expired. Please request a new one.')
          setTimeout(() => router.push('/login'), 3000)
          return
        }

        // After successful exchange, wait for onAuthStateChange to determine type
        // If no event fires within 3 seconds, default to reset-password
        setTimeout(() => {
          if (!redirected) {
            redirected = true
            router.push('/reset-password')
          }
        }, 3000)
      } else {
        // No code — check if there's a hash fragment (implicit flow)
        if (typeof window !== 'undefined' && window.location.hash) {
          // Supabase client will auto-process the hash
          // Wait for onAuthStateChange to fire
          setTimeout(() => {
            if (!redirected) {
              redirected = true
              router.push('/reset-password')
            }
          }, 3000)
        } else {
          // No code, no hash — redirect to login
          router.push('/login')
        }
      }
    }

    handleCallback()

    return () => { subscription.unsubscribe() }
  }, [searchParams, router])

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
