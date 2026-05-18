'use client'
/**
 * useNetworkStatus — Detects online/offline status and shows appropriate UI.
 *
 * Features:
 *   - Detects when user goes offline (Wi-Fi drops, mobile signal loss)
 *   - Shows reconnection notification when coming back online
 *   - Provides status for components that need to disable network operations
 *   - Works reliably on mobile browsers (clinic staff often use tablets)
 *
 * USAGE:
 *   const { isOnline, wasOffline } = useNetworkStatus()
 *   // isOnline: current status
 *   // wasOffline: true if user was offline and just came back (for 5s)
 */

import { useEffect, useState, useCallback } from 'react'

interface NetworkStatus {
  /** True if browser reports navigator.onLine */
  isOnline: boolean
  /** True for 5 seconds after reconnecting (use for "reconnected!" toast) */
  wasOffline: boolean
  /** Timestamp of last disconnect (null if never disconnected) */
  lastDisconnect: number | null
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(true)
  const [wasOffline, setWasOffline] = useState(false)
  const [lastDisconnect, setLastDisconnect] = useState<number | null>(null)

  useEffect(() => {
    // Initialize with actual browser state
    if (typeof navigator !== 'undefined') {
      setIsOnline(navigator.onLine)
    }

    function handleOnline() {
      setIsOnline(true)
      // Show "reconnected" for 5 seconds
      setWasOffline(true)
      setTimeout(() => setWasOffline(false), 5000)
    }

    function handleOffline() {
      setIsOnline(false)
      setLastDisconnect(Date.now())
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOnline, wasOffline, lastDisconnect }
}