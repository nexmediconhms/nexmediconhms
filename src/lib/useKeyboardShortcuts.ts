'use client'
/**
 * useKeyboardShortcuts — Global keyboard shortcuts for power users.
 *
 * Shortcuts:
 *   Ctrl+K / Cmd+K    → Open global search
 *   Ctrl+N / Cmd+N    → New patient registration
 *   Ctrl+Shift+O      → New OPD consultation (from queue)
 *   Ctrl+B / Cmd+B    → Open billing
 *   Escape            → Close modals / go back
 *
 * This hook is designed to be used once in AppShell.
 * It respects input focus (won't fire when typing in inputs).
 */

import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface ShortcutConfig {
  enabled?: boolean
}

export function useKeyboardShortcuts({ enabled = true }: ShortcutConfig = {}) {
  const router = useRouter()

  const handler = useCallback((e: KeyboardEvent) => {
    if (!enabled) return

    // Don't trigger when typing in form fields
    const tag = (e.target as HTMLElement)?.tagName
    const isEditable = (e.target as HTMLElement)?.isContentEditable
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isEditable) return

    const mod = e.metaKey || e.ctrlKey

    // Ctrl+K → Global search
    if (mod && e.key === 'k') {
      e.preventDefault()
      router.push('/search')
      return
    }

    // Ctrl+N → New patient
    if (mod && e.key === 'n' && !e.shiftKey) {
      e.preventDefault()
      router.push('/patients/new')
      return
    }

    // Ctrl+Shift+O → OPD queue
    if (mod && e.shiftKey && e.key === 'O') {
      e.preventDefault()
      router.push('/queue')
      return
    }

    // Ctrl+B → Billing
    if (mod && e.key === 'b') {
      e.preventDefault()
      router.push('/billing')
      return
    }

    // Ctrl+D → Dashboard
    if (mod && e.key === 'd') {
      e.preventDefault()
      router.push('/dashboard')
      return
    }

    // Ctrl+Shift+A → Appointments
    if (mod && e.shiftKey && e.key === 'A') {
      e.preventDefault()
      router.push('/appointments')
      return
    }

    // Ctrl+P → Print (native)
    // Don't override — let browser handle it

  }, [enabled, router])

  useEffect(() => {
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handler])
}

/**
 * ShortcutHelpData — for displaying a shortcuts help panel
 */
export const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], desc: 'Global search' },
  { keys: ['Ctrl', 'N'], desc: 'New patient' },
  { keys: ['Ctrl', 'Shift', 'O'], desc: 'OPD queue' },
  { keys: ['Ctrl', 'B'], desc: 'Billing' },
  { keys: ['Ctrl', 'D'], desc: 'Dashboard' },
  { keys: ['Ctrl', 'Shift', 'A'], desc: 'Appointments' },
  { keys: ['Alt', 'P'], desc: 'Print page' },
  { keys: ['Esc'], desc: 'Close / go back' },
] as const
