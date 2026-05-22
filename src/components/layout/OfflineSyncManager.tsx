'use client'
/**
 * OfflineSyncManager — Background sync component
 *
 * Mounted inside AppShell, this component:
 * 1. Listens for online/offline transitions
 * 2. When connection restores, processes the IndexedDB sync queue
 * 3. Shows a toast/banner when syncing is in progress
 * 4. Shows count of pending items when offline
 *
 * Does NOT break any existing functionality — it's purely additive.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  onConnectionChange,
  processSyncQueue,
  getSyncQueue,
  checkSupabaseConnection,
  getConnectionStatus,
} from '@/lib/offline-store'
import { WifiOff, Wifi, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'

type SyncStatus = 'idle' | 'offline' | 'syncing' | 'synced' | 'error'

export default function OfflineSyncManager() {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [pendingCount, setPendingCount] = useState(0)
  const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const syncInProgress = useRef(false)
  const checkInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check pending queue count periodically
  const refreshPendingCount = useCallback(async () => {
    try {
      const queue = await getSyncQueue()
      setPendingCount(queue.length)
    } catch {
      // IndexedDB not available — ignore
    }
  }, [])

  // Process sync queue when online
  const doSync = useCallback(async () => {
    if (syncInProgress.current) return
    syncInProgress.current = true
    setStatus('syncing')
    setShowBanner(true)

    try {
      // Verify Supabase is reachable before syncing
      const reachable = await checkSupabaseConnection()
      if (!reachable) {
        setStatus('offline')
        syncInProgress.current = false
        return
      }

      const result = await processSyncQueue()
      setSyncResult(result)
      setStatus(result.failed > 0 ? 'error' : 'synced')
      await refreshPendingCount()

      // Hide banner after 4 seconds on success
      if (result.failed === 0) {
        setTimeout(() => setShowBanner(false), 4000)
      }
    } catch (err) {
      setStatus('error')
    } finally {
      syncInProgress.current = false
    }
  }, [refreshPendingCount])

  useEffect(() => {
    // Initial state check
    const { browserOnline, supabaseReachable } = getConnectionStatus()
    if (!browserOnline || !supabaseReachable) {
      setStatus('offline')
      setShowBanner(true)
    }
    refreshPendingCount()

    // Subscribe to connection changes
    const unsubscribe = onConnectionChange(async (online: boolean) => {
      if (online) {
        // Connection restored — attempt sync
        const queue = await getSyncQueue()
        if (queue.length > 0) {
          await doSync()
        } else {
          setStatus('idle')
          setShowBanner(false)
        }
      } else {
        setStatus('offline')
        setShowBanner(true)
      }
    })

    // Periodically check queue (every 30s)
    checkInterval.current = setInterval(refreshPendingCount, 30000)

    return () => {
      unsubscribe()
      if (checkInterval.current) clearInterval(checkInterval.current)
    }
  }, [doSync, refreshPendingCount])

  // Manual sync trigger
  const handleManualSync = async () => {
    await doSync()
  }

  // Don't render if nothing to show
  if (!showBanner && status === 'idle') return null

  return (
    <div className="no-print">
      {/* Offline banner */}
      {status === 'offline' && (
        <div className="bg-orange-50 border-b border-orange-200 px-4 py-2 flex items-center gap-3">
          <WifiOff className="w-4 h-4 text-orange-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-orange-800">
              You are offline
              {pendingCount > 0 && (
                <span className="ml-2 font-normal text-orange-700">
                  ({pendingCount} change{pendingCount > 1 ? 's' : ''} pending sync)
                </span>
              )}
            </p>
            <p className="text-xs text-orange-600">
              You can still view cached data. Changes will sync when connection restores.
            </p>
          </div>
        </div>
      )}

      {/* Syncing banner */}
      {status === 'syncing' && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-3">
          <RefreshCw className="w-4 h-4 text-blue-600 flex-shrink-0 animate-spin" />
          <p className="text-xs font-semibold text-blue-800">
            Syncing {pendingCount} pending change{pendingCount > 1 ? 's' : ''}...
          </p>
        </div>
      )}

      {/* Sync complete */}
      {status === 'synced' && showBanner && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-2 flex items-center gap-3">
          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
          <p className="text-xs font-semibold text-green-800">
            Connection restored. {syncResult?.synced || 0} change{(syncResult?.synced || 0) > 1 ? 's' : ''} synced successfully.
          </p>
          <button onClick={() => setShowBanner(false)} className="ml-auto text-xs text-green-600 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Sync error */}
      {status === 'error' && showBanner && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-red-800">
              Sync completed with errors.
              {syncResult && ` ${syncResult.synced} synced, ${syncResult.failed} failed.`}
            </p>
          </div>
          <button onClick={handleManualSync}
            className="text-xs text-red-700 underline font-semibold">
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
