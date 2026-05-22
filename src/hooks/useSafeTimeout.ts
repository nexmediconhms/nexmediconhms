/**
 * src/hooks/useSafeTimeout.ts
 *
 * Safe timeout hook that automatically clears on component unmount.
 * Prevents "setState on unmounted component" warnings.
 *
 * USAGE:
 *   const { safeTimeout } = useSafeTimeout()
 *
 *   // Instead of: setTimeout(() => setCopied(false), 2000)
 *   // Use:        safeTimeout(() => setCopied(false), 2000)
 *
 * All timeouts are auto-cleared when the component unmounts.
 * No memory leaks, no warnings.
 */

import { useCallback, useEffect, useRef } from 'react'

/**
 * Hook that provides a safe setTimeout that auto-clears on unmount.
 *
 * Returns:
 *   safeTimeout(fn, delay) — replacement for setTimeout
 *   clearAllTimeouts()     — manually clear all pending timeouts
 */
export function useSafeTimeout() {
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const mountedRef = useRef(true)

  // Cleanup all timers on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      timersRef.current.forEach(timer => clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  /**
   * Safe replacement for setTimeout.
   * Callback only fires if component is still mounted.
   * Timer is auto-cleared on unmount.
   */
  const safeTimeout = useCallback((fn: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      if (mountedRef.current) {
        fn()
      }
    }, delay)
    timersRef.current.add(timer)
    return timer
  }, [])

  /**
   * Manually clear all pending timeouts.
   */
  const clearAllTimeouts = useCallback(() => {
    timersRef.current.forEach(timer => clearTimeout(timer))
    timersRef.current.clear()
  }, [])

  return { safeTimeout, clearAllTimeouts }
}

/**
 * Hook that provides a safe setInterval that auto-clears on unmount.
 *
 * USAGE:
 *   const { safeInterval } = useSafeInterval()
 *   safeInterval(() => fetchData(), 30000)
 */
export function useSafeInterval() {
  const intervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set())

  useEffect(() => {
    return () => {
      intervalsRef.current.forEach(interval => clearInterval(interval))
      intervalsRef.current.clear()
    }
  }, [])

  const safeInterval = useCallback((fn: () => void, delay: number) => {
    const interval = setInterval(fn, delay)
    intervalsRef.current.add(interval)
    return interval
  }, [])

  const clearAllIntervals = useCallback(() => {
    intervalsRef.current.forEach(interval => clearInterval(interval))
    intervalsRef.current.clear()
  }, [])

  return { safeInterval, clearAllIntervals }
}
