'use client'

/**
 * src/app/not-found.tsx
 *
 * Global 404 page with intelligent recovery for malformed portal URLs.
 *
 * If a patient lands here from a malformed magic-link URL (e.g. one
 * with a leading double-slash that bypassed the middleware), this
 * page detects portal-related URLs in the browser and auto-redirects
 * to the correct path.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Home, ArrowLeft, Heart } from 'lucide-react'

export default function NotFound() {
  const [isRecovering, setIsRecovering] = useState(false)

  useEffect(() => {
    // ╔══════════════════════════════════════════════════════════════╗
    // ║  PORTAL URL RECOVERY                                        ║
    // ║  If the user landed here from a malformed portal URL with   ║
    // ║  double slashes, normalize the path and redirect.           ║
    // ╚══════════════════════════════════════════════════════════════╝

    const currentPath = window.location.pathname
    const search      = window.location.search
    const hash        = window.location.hash

    // Detect any double-slash in the current URL path
    if (currentPath.includes('//')) {
      const normalizedPath = currentPath.replace(/\/+/g, '/')

      // If the normalized path looks like a valid portal route, redirect there
      if (normalizedPath.startsWith('/portal')) {
        setIsRecovering(true)
        // Use replace() so the malformed URL is not in history
        window.location.replace(normalizedPath + search + hash)
        return
      }

      // For any other normalized path, also redirect (best-effort recovery)
      setIsRecovering(true)
      window.location.replace(normalizedPath + search + hash)
      return
    }

    // Detect if URL has portal token but path is wrong
    // E.g. someone copy-pasted the WhatsApp link into a browser that
    // collapsed the slashes weirdly
    if (search.includes('token=') && !currentPath.startsWith('/portal')) {
      setIsRecovering(true)
      window.location.replace('/portal/verify' + search)
      return
    }
  }, [])

  if (isRecovering) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"/>
          <h1 className="text-lg font-semibold text-gray-700 mb-1">Redirecting…</h1>
          <p className="text-sm text-gray-500">Please wait while we take you to the right page.</p>
        </div>
      </div>
    )
  }

  // ── Detect if this might be a patient (URL contains token or /portal) ──
  const isPortalUser = typeof window !== 'undefined' && (
    window.location.search.includes('token=') ||
    window.location.pathname.includes('portal')
  )

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="text-8xl font-black text-blue-100 mb-4 select-none">404</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Page not found</h1>
        <p className="text-gray-500 mb-8">
          The page you're looking for doesn't exist or may have been moved.
        </p>

        {/* Show patient-friendly buttons if this looks like a portal user */}
        {isPortalUser ? (
          <div className="flex flex-col gap-3 items-center">
            <Link href="/portal/login"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 py-3 rounded-xl transition-colors">
              <Heart className="w-4 h-4" /> Open Patient Portal
            </Link>
            <p className="text-xs text-gray-400">
              Already have an OTP? Login with your mobile number.
            </p>
          </div>
        ) : (
          <div className="flex gap-3 justify-center">
            <Link href="/dashboard"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
              <Home className="w-4 h-4" /> Go to Dashboard
            </Link>
            <Link href="/patients"
              className="inline-flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold px-5 py-2.5 rounded-lg border border-gray-200 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Patients List
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
