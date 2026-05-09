'use client'

/**
 * src/app/auth/callback/page.tsx
 *
 * Client-side auth callback handler.
 * Processes the `code` query parameter from Supabase auth redirects (PKCE flow).
 * Exchanges the code for a session, then redirects based on the type.
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
    const type = searchParams.get('type')

    async function handleCallback() {
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

        if (exchangeError) {
          setError('Failed to verify the link. It may have expired. Please request a new one.')
          setTimeout(() => router.push('/login'), 3000)
          return
        }

        // If this is a password recovery, redirect to the reset password page
        if (type === 'recovery') {
          router.push('/reset-password')
          return
        }

        // For other types (email confirmation, magic link), go to dashboard
        router.push('/dashboard')
      } else {
        // No code — redirect to login
        router.push('/login')
      }
    }

    handleCallback()
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
