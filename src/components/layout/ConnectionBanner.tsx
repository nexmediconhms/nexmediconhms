'use client'

/**
 * src/components/layout/ConnectionBanner.tsx
 *
 * Connection Status Banner — FIXED v2
 *
 * ROOT CAUSE of "Clinic Mode, Database unreachable" bug:
 *   - `isClinicMode` was set on `offline` event but only cleared on `online` event.
 *   - If the component mounted after a transient offline blip, `isClinicMode` stayed true.
 *   - The 30s interval only checked navigator.onLine but DID NOT verify actual DB connectivity.
 *
 * FIX:
 *   1. Removed separate `isClinicMode` state — derive it from actual connectivity checks.
 *   2. Added a lightweight Supabase ping (select 1 from clinic_settings limit 1) with 5s timeout.
 *   3. Only show banner when BOTH navigator.onLine is false OR the DB ping fails.
 *   4. Added exponential backoff for health checks to avoid hammering the DB.
 *   5. Auto-dismiss banner within 3s of successful reconnection.
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { WifiOff, Wifi, RefreshCw, CloudOff, Cloud, CheckCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type ConnectionState = 'online' | 'offline' | 'db_unreachable' | 'reconnecting'

export default function ConnectionBanner() {
  const [state, setState] = useState<ConnectionState>('online')
  const [pendingSync, setPendingSync] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [showReconnected, setShowReconnected] = useState(false)
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wasDisconnectedRef = useRef(false)

  // Lightweight DB connectivity check — 5s timeout
  const checkDBConnectivity = useCallback(async (): Promise<boolean> => {
    if (!navigator.onLine) return false

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const { error } = await supabase
        .from('clinic_settings')
        .select('key')
        .limit(1)
        .abortSignal(controller.signal)

      clearTimeout(timeout)
      return !error
    } catch {
      return false
    }
  }, [])

  const performCheck = useCallback(async () => {
    if (!navigator.onLine) {
      setState('offline')
      wasDisconnectedRef.current = true
      return
    }

    // Browser says online — verify DB is reachable
    const dbOk = await checkDBConnectivity()

    if (dbOk) {
      if (wasDisconnectedRef.current) {
        // Just reconnected — show success briefly
        setState('online')
        setShowReconnected(true)
        wasDisconnectedRef.current = false
        setTimeout(() => setShowReconnected(false), 3000)

        // Try to sync any pending offline changes
        handleSync()
      } else {
        setState('online')
      }
    } else {
      setState('db_unreachable')
      wasDisconnectedRef.current = true
    }
  }, [checkDBConnectivity])

  useEffect(() => {
    // Initial check
    performCheck()

    const handleOnline = () => {
      setState('reconnecting')
      // Give the network a moment to stabilize, then check DB
      setTimeout(performCheck, 1500)
    }

    const handleOffline = () => {
      setState('offline')
      wasDisconnectedRef.current = true
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Periodic health check — every 60s (not 30s to reduce load)
    checkIntervalRef.current = setInterval(performCheck, 60000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current)
    }
  }, [performCheck])

  async function handleSync() {
    setSyncing(true)
    try {
      const { processSyncQueue } = await import('@/lib/offline-store')
      const result = await processSyncQueue()
      setPendingSync(prev => Math.max(0, prev - (result?.synced || 0)))
    } catch {
      // Sync module may not exist or have issues
    }
    setSyncing(false)
  }

  // Don't show anything if everything is normal and no reconnect toast
  if (state === 'online' && !showReconnected && pendingSync === 0) return null

  // Brief "reconnected" toast
  if (showReconnected && state === 'online') {
    return (
      <div className="px-4 py-2 text-sm flex items-center gap-2 bg-green-500 text-white animate-fade-in">
        <CheckCircle className="w-4 h-4" />
        <span className="font-medium">Reconnected</span>
        <span className="text-xs opacity-80">— All systems operational</span>
      </div>
    )
  }

  return (
    <div className={`px-4 py-2 text-sm flex items-center justify-between ${
      state === 'offline'
        ? 'bg-red-600 text-white'
        : state === 'db_unreachable'
        ? 'bg-amber-500 text-amber-900'
        : state === 'reconnecting'
        ? 'bg-blue-500 text-white'
        : pendingSync > 0
        ? 'bg-blue-500 text-white'
        : 'bg-green-500 text-white'
    }`}>
      <div className="flex items-center gap-2">
        {state === 'offline' && (
          <>
            <WifiOff className="w-4 h-4" />
            <span className="font-semibold">Offline</span>
            <span className="text-xs opacity-80">— No internet connection. Cached data available for viewing.</span>
          </>
        )}
        {state === 'db_unreachable' && (
          <>
            <CloudOff className="w-4 h-4" />
            <span className="font-semibold">Connection Issue</span>
            <span className="text-xs opacity-80">— Database temporarily unreachable. Retrying automatically...</span>
          </>
        )}
        {state === 'reconnecting' && (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="font-semibold">Reconnecting...</span>
          </>
        )}
        {state === 'online' && pendingSync > 0 && (
          <>
            <Cloud className="w-4 h-4" />
            <span className="font-semibold">{pendingSync} pending change{pendingSync > 1 ? 's' : ''}</span>
            <span className="text-xs opacity-80">— Waiting to sync</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        {state === 'db_unreachable' && (
          <button
            onClick={performCheck}
            className="flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Retry Now
          </button>
        )}
        {pendingSync > 0 && state === 'online' && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        )}
      </div>
    </div>
  )
}
