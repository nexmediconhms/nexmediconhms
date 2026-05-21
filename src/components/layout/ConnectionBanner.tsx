'use client'

/**
 * src/components/layout/ConnectionBanner.tsx
 *
 * Connection Status Banner — Clinic Mode Indicator
 *
 * Shows a banner when:
 *   - Browser is offline (navigator.onLine === false)
 *
 * FIX: Previously showed "Database unreachable" because checkSupabaseConnection()
 * used a HEAD request to /rest/v1/ which returns 401 without auth context.
 * Now only shows offline banner when the browser itself reports no network.
 * Supabase connectivity is implicitly tested by all the other real-time
 * queries happening across the app — if those fail, they show their own errors.
 */

import { useEffect, useState } from 'react'
import { WifiOff, Wifi, RefreshCw, CloudOff, Cloud } from 'lucide-react'

export default function ConnectionBanner() {
  const [isOnline, setIsOnline] = useState(true)
  const [isClinicMode, setIsClinicMode] = useState(false)
  const [pendingSync, setPendingSync] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)

  useEffect(() => {
    // Check initial state
    setIsOnline(navigator.onLine)

    const handleOnline = () => {
      setIsOnline(true)
      setIsClinicMode(false)
      handleSync()
    }
    const handleOffline = () => {
      setIsOnline(false)
      setIsClinicMode(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // FIX: Only check offline status via browser API, not via Supabase ping.
    // The previous HEAD request to /rest/v1/ returned 401 (not 200) because
    // it requires proper authorization headers, causing false "Database unreachable".
    // Real connectivity is verified by the actual queries the app makes.
    const interval = setInterval(() => {
      setIsOnline(navigator.onLine)
      if (!navigator.onLine) {
        setIsClinicMode(true)
      } else {
        setIsClinicMode(false)
      }
    }, 30000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(interval)
    }
  }, [])

  async function handleSync() {
    setSyncing(true)
    try {
      const { processSyncQueue } = await import('@/lib/offline-store')
      const result = await processSyncQueue()
      setPendingSync(prev => Math.max(0, prev - result.synced))
    } catch {
      // Sync failed
    }
    setSyncing(false)
  }

  // Don't show anything if everything is normal
  if (isOnline && !isClinicMode && pendingSync === 0) return null

  return (
    <div className={`px-4 py-2 text-sm flex items-center justify-between ${
      !isOnline
        ? 'bg-red-600 text-white'
        : isClinicMode
        ? 'bg-yellow-500 text-yellow-900'
        : pendingSync > 0
        ? 'bg-blue-500 text-white'
        : 'bg-green-500 text-white'
    }`}>
      <div className="flex items-center gap-2">
        {!isOnline ? (
          <>
            <WifiOff className="w-4 h-4" />
            <span className="font-semibold">Offline Mode</span>
            <span className="text-xs opacity-80">— You can view cached patient data. Changes will sync when online.</span>
          </>
        ) : isClinicMode ? (
          <>
            <CloudOff className="w-4 h-4" />
            <span className="font-semibold">🏥 Clinic Mode</span>
            <span className="text-xs opacity-80">— Database unreachable. Read-only access to cached data.</span>
          </>
        ) : pendingSync > 0 ? (
          <>
            <Cloud className="w-4 h-4" />
            <span className="font-semibold">{pendingSync} pending change{pendingSync > 1 ? 's' : ''}</span>
            <span className="text-xs opacity-80">— Waiting to sync</span>
          </>
        ) : (
          <>
            <Wifi className="w-4 h-4" />
            <span>Connected</span>
          </>
        )}
      </div>

      {pendingSync > 0 && isOnline && !isClinicMode && (
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full"
        >
          <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      )}

      {lastSync && (
        <span className="text-xs opacity-60">
          Last sync: {new Date(lastSync).toLocaleTimeString()}
        </span>
      )}
    </div>
  )
}
