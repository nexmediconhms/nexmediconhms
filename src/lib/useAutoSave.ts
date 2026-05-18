'use client'
/**
 * useAutoSave — Debounced auto-save hook for NexMedicon HMS
 *
 * DESIGN:
 *   - Debounced: waits for user to stop typing before saving (configurable delay)
 *   - Conflict-safe: skips save if data hasn't changed (deep equality check)
 *   - Status indicator: returns status ('idle' | 'saving' | 'saved' | 'error')
 *   - Non-blocking: never interrupts user input or navigation
 *   - Works with any async save function (Supabase, API, localStorage, etc.)
 *
 * USAGE:
 *   const { status, lastSavedAt, triggerSave } = useAutoSave({
 *     data: formState,
 *     onSave: async (data) => { await saveToSupabase(data) },
 *     delay: 2000,        // ms after last change (default: 2000)
 *     enabled: true,      // toggle auto-save on/off
 *   })
 *
 * The hook ALSO exposes `triggerSave()` for manual/immediate saves.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UseAutoSaveOptions<T> {
  /** The data to watch for changes */
  data: T
  /** Async function called when data should be persisted */
  onSave: (data: T) => Promise<boolean | void>
  /** Debounce delay in ms (default: 2000) */
  delay?: number
  /** Enable/disable auto-save (default: true) */
  enabled?: boolean
  /** Minimum change threshold — only save if data differs from last saved snapshot */
  skipIfUnchanged?: boolean
}

interface UseAutoSaveReturn {
  /** Current status of the auto-save cycle */
  status: AutoSaveStatus
  /** ISO timestamp of last successful save */
  lastSavedAt: string | null
  /** Trigger an immediate save (e.g. for a manual "Save" button) */
  triggerSave: () => Promise<void>
  /** Error message if status === 'error' */
  errorMessage: string | null
}

/**
 * Deep comparison using JSON serialization.
 * Simple and works well for plain objects/arrays (no functions, Dates etc.)
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export function useAutoSave<T>({
  data,
  onSave,
  delay = 2000,
  enabled = true,
  skipIfUnchanged = true,
}: UseAutoSaveOptions<T>): UseAutoSaveReturn {
  const [status, setStatus] = useState<AutoSaveStatus>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Refs to hold latest values without causing re-renders
  const dataRef = useRef<T>(data)
  const lastSavedDataRef = useRef<T | null>(null)
  const onSaveRef = useRef(onSave)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)

  // Keep refs in sync
  useEffect(() => { dataRef.current = data }, [data])
  useEffect(() => { onSaveRef.current = onSave }, [onSave])
  useEffect(() => { return () => { mountedRef.current = false } }, [])

  // Core save logic
  const executeSave = useCallback(async () => {
    if (savingRef.current) return // Already saving — skip
    const currentData = dataRef.current

    // Skip if nothing changed since last save
    if (skipIfUnchanged && lastSavedDataRef.current !== null) {
      if (isEqual(currentData, lastSavedDataRef.current)) return
    }

    savingRef.current = true
    if (mountedRef.current) {
      setStatus('saving')
      setErrorMessage(null)
    }

    try {
      const result = await onSaveRef.current(currentData)
      if (mountedRef.current) {
        // result === false means save failed explicitly
        if (result === false) {
          setStatus('error')
          setErrorMessage('Save failed')
        } else {
          lastSavedDataRef.current = currentData
          setStatus('saved')
          setLastSavedAt(new Date().toISOString())
          // Return to idle after 3s
          setTimeout(() => {
            if (mountedRef.current) setStatus('idle')
          }, 3000)
        }
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setStatus('error')
        setErrorMessage(err?.message || 'Auto-save failed')
        // Return to idle after 5s so user can retry
        setTimeout(() => {
          if (mountedRef.current) setStatus('idle')
        }, 5000)
      }
    } finally {
      savingRef.current = false
    }
  }, [skipIfUnchanged])

  // Debounced watcher — triggers save after `delay` ms of no changes
  useEffect(() => {
    if (!enabled) return

    // Clear existing timer
    if (timerRef.current) clearTimeout(timerRef.current)

    // Don't auto-save on first mount (let user make at least one change)
    if (lastSavedDataRef.current === null) {
      // Snapshot initial state so we can detect the first real change
      lastSavedDataRef.current = data
      return
    }

    // Set new debounce timer
    timerRef.current = setTimeout(() => {
      executeSave()
    }, delay)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [data, delay, enabled, executeSave])

  // Manual / immediate save
  const triggerSave = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    await executeSave()
  }, [executeSave])

  return { status, lastSavedAt, triggerSave, errorMessage }
}

/**
 * useFormDraft — Persist form state to sessionStorage as a draft.
 *
 * Useful for long forms (patient registration, lab reports) where the user
 * may navigate away accidentally. The draft is cleared on successful submit.
 *
 * USAGE:
 *   const { restoreDraft, clearDraft } = useFormDraft<FormData>('patient_new_draft', setForm)
 */
interface UseFormDraftOptions<T> {
  key: string
  setter: (data: T) => void
  enabled?: boolean
}

export function useFormDraft<T>({ key, setter, enabled = true }: UseFormDraftOptions<T>) {
  const draftSaved = useRef(false)

  // Restore draft on mount
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw) as T
        setter(parsed)
        draftSaved.current = true
      }
    } catch { /* corrupted / SSR — ignore */ }
  }, [key, setter, enabled])

  // Save draft (call on every form change)
  const saveDraft = useCallback((data: T) => {
    if (!enabled || typeof window === 'undefined') return
    try {
      sessionStorage.setItem(key, JSON.stringify(data))
      draftSaved.current = true
    } catch { /* quota — ignore */ }
  }, [key, enabled])

  // Clear draft (call after successful save)
  const clearDraft = useCallback(() => {
    if (typeof window === 'undefined') return
    try { sessionStorage.removeItem(key) } catch { /* ignore */ }
    draftSaved.current = false
  }, [key])

  // Check if a draft exists
  const hasDraft = useCallback(() => {
    if (typeof window === 'undefined') return false
    try { return !!sessionStorage.getItem(key) } catch { return false }
  }, [key])

  return { saveDraft, clearDraft, hasDraft }
}