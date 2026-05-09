'use client'

/**
 * src/app/page.tsx
 *
 * Root page — redirects to /login by default.
 * Also handles Supabase auth callbacks that arrive at the root URL
 * (e.g., when password reset is sent from Supabase dashboard using Site URL).
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    let redirected = false

    // Listen for PASSWORD_RECOVERY event
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (redirected) return
        if (event === 'PASSWORD_RECOVERY') {
          redirected = true
          router.push('/reset-password')
        }
      }
    )

    async function handleRoot() {
      if (typeof window === 'undefined') return

      const params = new URLSearchParams(window.location.search)
      const hash = window.location.hash
      const code = params.get('code')

      // If there's a code parameter, exchange it (PKCE flow)
      // Codes arriving at root URL are from password reset (sent via Supabase dashboard)
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          // Code exchange failed — go to login
          redirected = true
          router.push('/login')
          return
        }
        // Code exchanged successfully — redirect to reset password immediately
        if (!redirected) {
          redirected = true
          router.push('/reset-password')
        }
        return
      }

      // If there's a hash with recovery type (implicit flow)
      if (hash && hash.includes('type=recovery')) {
        // Supabase client will auto-process and fire PASSWORD_RECOVERY
        // Wait for the event
        setTimeout(() => {
          if (!redirected) {
            redirected = true
            router.push('/reset-password')
          }
        }, 3000)
        return
      }

      // No auth params — just redirect to login
      if (!redirected) {
        redirected = true
        router.push('/login')
      }
    }

    handleRoot()

    return () => { subscription.unsubscribe() }
  }, [router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
      <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
