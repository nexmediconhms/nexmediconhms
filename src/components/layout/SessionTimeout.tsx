'use client'
/**
 * src/components/layout/SessionTimeout.tsx  — NEW
 *
 * Shows a warning modal 2 minutes before the Supabase session expires.
 * Doctor can click "Stay Signed In" to refresh the session.
 * If ignored, the user is signed out gracefully so they don't lose
 * unsaved work silently.
 *
 * Usage: Add <SessionTimeout /> inside AppShell, just before </AuthContext.Provider>
 *
 * Supabase default session lifetime is 1 hour (3600 seconds).
 * This component checks every 30 seconds and warns at T-2 min.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { auditLogout } from '@/lib/audit'
import { AlertTriangle, RefreshCw, LogOut } from 'lucide-react'

const WARN_BEFORE_EXPIRY_MS = 2 * 60 * 1000   // 2 minutes
const CHECK_INTERVAL_MS     = 30 * 1000        // check every 30s

export default function SessionTimeout() {
  const router = useRouter()
  const [showWarning, setShowWarning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(120)
  const [extending,   setExtending]   = useState(false)

  const checkSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return // No active session — AppShell handles redirect

    const expiresAt   = session.expires_at ?? 0          // Unix timestamp (seconds)
    const nowSec      = Math.floor(Date.now() / 1000)
    const remainingSec = expiresAt - nowSec

    if (remainingSec <= 0) {
      // Already expired — sign out
      await supabase.auth.signOut()
      router.push('/login')
      return
    }

    if (remainingSec <= WARN_BEFORE_EXPIRY_MS / 1000) {
      setSecondsLeft(remainingSec)
      setShowWarning(true)
    } else {
      setShowWarning(false)
    }
  }, [router])

  // Countdown when warning is shown
  useEffect(() => {
    if (!showWarning) return
    const timer = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          // Time's up — sign out
          supabase.auth.signOut().then(() => router.push('/login'))
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [showWarning, router])

  // Periodic session check
  useEffect(() => {
    checkSession()
    const interval = setInterval(checkSession, CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [checkSession])

  async function extendSession() {
    setExtending(true)
    try {
      // refreshSession() gets a new access token using the refresh token
      const { error } = await supabase.auth.refreshSession()
      if (!error) {
        setShowWarning(false)
        setSecondsLeft(120)
      }
    } catch {
      // If refresh fails, session is truly expired
      router.push('/login')
    }
    setExtending(false)
  }

  async function signOutNow() {
    await auditLogout()
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (!showWarning) return null

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const timeStr = mins > 0
    ? `${mins}m ${String(secs).padStart(2, '0')}s`
    : `${secs}s`

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 border-2 border-amber-300">
        <div className="flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-amber-600" />
        </div>

        <h2 className="text-xl font-bold text-gray-900 text-center mb-2">
          Session Expiring Soon
        </h2>
        <p className="text-sm text-gray-500 text-center mb-4">
          Your session will expire in{' '}
          <span className="font-bold text-amber-600 text-base">{timeStr}</span>.
          Save any unsaved work now.
        </p>

        {/* Countdown ring */}
        <div className="flex justify-center mb-6">
          <div className="relative w-20 h-20">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f3f4f6" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none"
                stroke={secondsLeft < 30 ? '#ef4444' : '#f59e0b'}
                strokeWidth="3"
                strokeDasharray="100"
                strokeDashoffset={100 - (secondsLeft / 120) * 100}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-sm font-bold ${secondsLeft < 30 ? 'text-red-600' : 'text-amber-600'}`}>
                {timeStr}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <button
            onClick={extendSession}
            disabled={extending}
            className="w-full btn-primary flex items-center justify-center gap-2 py-3 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${extending ? 'animate-spin' : ''}`} />
            {extending ? 'Extending…' : 'Stay Signed In'}
          </button>
          <button
            onClick={signOutNow}
            className="w-full btn-secondary flex items-center justify-center gap-2 py-2.5 text-gray-600"
          >
            <LogOut className="w-4 h-4" />
            Sign Out Now
          </button>
        </div>

        <p className="text-xs text-gray-400 text-center mt-3">
          Unsaved changes may be lost if you let the session expire.
        </p>
      </div>
    </div>
  )
}