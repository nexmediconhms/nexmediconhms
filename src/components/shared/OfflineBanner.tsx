/**
 * src/components/shared/OfflineBanner.tsx
 *
 * Offline mode indicator component.
 * Shows a banner when internet is down and displays pending operation count.
 * Auto-hides when connection restores and sync completes.
 *
 * FIX: Internet goes down — user sees clear status instead of confusing errors.
 *
 * Usage (add to AppShell or layout):
 *   import OfflineBanner from '@/components/shared/OfflineBanner'
 *
 *   // In your layout:
 *   <OfflineBanner />
 */

'use client'

import { useEffect, useState } from 'react'
import { WifiOff, Wifi, Cloud, Loader2 } from 'lucide-react'
import { offlineQueue } from '@/lib/offline-queue'

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [showBanner, setShowBanner] = useState(false)
  const [justReconnected, setJustReconnected] = useState(false)

  useEffect(() => {
    // Initial state
    setIsOnline(navigator.onLine)
    setShowBanner(!navigator.onLine)

    // Load pending count
    offlineQueue.getPendingCount().then(setPendingCount).catch(() => {})

    // Subscribe to pending count changes
    const unsubscribe = offlineQueue.onPendingChange(setPendingCount)

    // Online/offline event listeners
    function handleOnline() {
      setIsOnline(true)
      setJustReconnected(true)
      setIsSyncing(true)

      // Sync pending operations
      offlineQueue.syncAll().then((result) => {
        setIsSyncing(false)
        if (result.synced > 0 || result.failed > 0) {
          // Keep banner visible briefly to show sync result
          setTimeout(() => {
            setShowBanner(false)
            setJustReconnected(false)
          }, 3000)
        } else {
          setShowBanner(false)
          setJustReconnected(false)
        }
      }).catch(() => {
        setIsSyncing(false)
      })
    }

    function handleOffline() {
      setIsOnline(false)
      setShowBanner(true)
      setJustReconnected(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      unsubscribe()
    }
  }, [])

  // Also show banner if there are pending items even when online
  useEffect(() => {
    if (pendingCount > 0 && isOnline && !isSyncing) {
      setShowBanner(true)
    }
  }, [pendingCount, isOnline, isSyncing])

  if (!showBanner && pendingCount === 0) return null

  // ── Offline state ─────────────────────────────────────────
  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white px-4 py-2 text-center text-sm font-medium shadow-lg flex items-center justify-center gap-2">
        <WifiOff className="w-4 h-4" />
        <span>
          You are offline.
          {pendingCount > 0 && ` ${pendingCount} operation${pendingCount > 1 ? 's' : ''} queued — will sync when online.`}
          {pendingCount === 0 && ' Changes will be saved locally and synced when internet restores.'}
        </span>
      </div>
    )
  }

  // ── Syncing state ─────────────────────────────────────────
  if (isSyncing) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-blue-500 text-white px-4 py-2 text-center text-sm font-medium shadow-lg flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Syncing {pendingCount} pending operation{pendingCount > 1 ? 's' : ''}...</span>
      </div>
    )
  }

  // ── Just reconnected ──────────────────────────────────────
  if (justReconnected) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-green-500 text-white px-4 py-2 text-center text-sm font-medium shadow-lg flex items-center justify-center gap-2 transition-all">
        <Wifi className="w-4 h-4" />
        <span>Back online! All data synced successfully.</span>
      </div>
    )
  }

  // ── Pending items while online (retry available) ──────────
  if (pendingCount > 0 && isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-orange-100 text-orange-800 px-4 py-2 text-center text-sm font-medium shadow-md flex items-center justify-center gap-2">
        <Cloud className="w-4 h-4" />
        <span>{pendingCount} operation{pendingCount > 1 ? 's' : ''} pending sync.</span>
        <button
          onClick={() => {
            setIsSyncing(true)
            offlineQueue.syncAll().then(() => setIsSyncing(false)).catch(() => setIsSyncing(false))
          }}
          className="ml-2 px-2 py-0.5 bg-orange-600 text-white rounded text-xs hover:bg-orange-700"
        >
          Retry Now
        </button>
      </div>
    )
  }

  return null
}
