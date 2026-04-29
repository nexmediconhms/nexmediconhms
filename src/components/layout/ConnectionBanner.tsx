'use client'

/**
 * src/components/layout/ConnectionBanner.tsx
 *
 * Connection Status Banner — Clinic Mode Indicator
 *
 * Shows a banner when:
 *   - Browser is offline
 *   - Supabase is unreachable (Clinic Mode)
 *   - Pending sync items exist
 *
 * Automatically checks connection every 30 seconds.
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
      // Auto-sync when coming back online
      handleSync()
    }
    const handleOffline = () => {
      setIsOnline(false)
      setIsClinicMode(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Check Supabase connectivity periodically
    const interval = setInterval(async () => {
      try {
        const { checkSupabaseConnection, getCacheStats } = await import('@/lib/offline-store')
        const reachable = await checkSupabaseConnection()
        setIsClinicMode(!reachable)

        const stats = await getCacheStats()
        setPendingSync(stats.pendingSync)
        setLastSync(stats.lastSync)
      } catch {
        // Offline store not available
      }
    }, 30000)

    // Initial check
    ;(async () => {
      try {
        const { checkSupabaseConnection, getCacheStats } = await import('@/lib/offline-store')
        const reachable = await checkSupabaseConnection()
        setIsClinicMode(!reachable)
        const stats = await getCacheStats()
        setPendingSync(stats.pendingSync)
        setLastSync(stats.lastSync)
      } catch {
        // Offline store not available
      }
    })()

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
