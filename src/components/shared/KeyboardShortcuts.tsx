/**
 * src/components/shared/KeyboardShortcuts.tsx
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * ────────
 * Adds global keyboard shortcuts for fast navigation in the HMS.
 * Hospital staff can navigate without touching the mouse.
 * 
 * THE BUG (Bug #17):
 * ──────────────────
 * There were NO keyboard shortcuts in the app. In a busy clinic:
 * - Receptionist registers 50+ patients/day → needs fast navigation
 * - Doctor switches between OPD, prescriptions, labs frequently
 * - Reaching for the mouse slows down the workflow
 * 
 * WHAT THIS FILE DOES:
 * ────────────────────
 * Provides a component that listens for keyboard shortcuts globally
 * and navigates to the appropriate page.
 * 
 * SHORTCUTS:
 * ──────────
 *   Alt + D → Dashboard
 *   Alt + P → Patients
 *   Alt + N → New Patient Registration
 *   Alt + O → OPD (New Consultation search)
 *   Alt + A → Appointments
 *   Alt + B → Billing
 *   Alt + Q → OPD Queue
 *   Alt + S → Settings
 *   Alt + / → Show shortcut help dialog
 *   Escape  → Close any open modal/dialog
 * 
 * WHY Alt + KEY (not Ctrl):
 * ─────────────────────────
 * - Ctrl+key conflicts with browser shortcuts (Ctrl+P = print, Ctrl+S = save page)
 * - Alt+key is mostly unused by browsers (only Alt alone opens menu bar)
 * - Works on Windows, Mac (Option+key), and Linux
 * 
 * WHERE IT'S USED:
 * ────────────────
 * - src/components/layout/AppShell.tsx (mounted globally, always active)
 * 
 * DOES IT BREAK ANYTHING?
 * ───────────────────────
 * No. This is a NEW component. It only activates when Alt is held.
 * It does NOT fire when user is typing in an input/textarea (smart detection).
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { X, Keyboard } from 'lucide-react'

// ── Shortcut definitions ──────────────────────────────────────
interface Shortcut {
  key: string          // The letter key (lowercase)
  label: string        // Display label (e.g. "Alt + D")
  description: string  // What it does
  path: string         // Where to navigate
}

const SHORTCUTS: Shortcut[] = [
  { key: 'd', label: 'Alt + D', description: 'Go to Dashboard', path: '/dashboard' },
  { key: 'p', label: 'Alt + P', description: 'Go to Patients', path: '/patients' },
  { key: 'n', label: 'Alt + N', description: 'Register New Patient', path: '/patients/new' },
  { key: 'o', label: 'Alt + O', description: 'Start OPD Consultation', path: '/opd' },
  { key: 'a', label: 'Alt + A', description: 'Appointments', path: '/appointments' },
  { key: 'b', label: 'Alt + B', description: 'Billing', path: '/billing' },
  { key: 'q', label: 'Alt + Q', description: 'OPD Queue', path: '/queue' },
  { key: 's', label: 'Alt + S', description: 'Settings', path: '/settings' },
  { key: 'r', label: 'Alt + R', description: 'Reports', path: '/reports' },
  { key: 'l', label: 'Alt + L', description: 'Lab Reports', path: '/labs' },
]

/**
 * Global keyboard shortcut handler.
 * Mount this ONCE in AppShell — it handles all navigation shortcuts.
 * 
 * Also provides a help dialog (Alt + /) showing all available shortcuts.
 */
export default function KeyboardShortcuts() {
  const router = useRouter()
  const [showHelp, setShowHelp] = useState(false)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't fire shortcuts when user is typing in an input field
    const target = e.target as HTMLElement
    const isTyping = target.tagName === 'INPUT' || 
                     target.tagName === 'TEXTAREA' || 
                     target.tagName === 'SELECT' ||
                     target.isContentEditable

    // Escape always works (close help dialog)
    if (e.key === 'Escape') {
      setShowHelp(false)
      return
    }

    // All shortcuts require Alt key (Option on Mac)
    if (!e.altKey) return

    // Don't fire when typing in inputs (except Alt+/ for help)
    if (isTyping && e.key !== '/') return

    // Alt + / → show help
    if (e.key === '/') {
      e.preventDefault()
      setShowHelp(prev => !prev)
      return
    }

    // Check if the pressed key matches a shortcut
    const shortcut = SHORTCUTS.find(s => s.key === e.key.toLowerCase())
    if (shortcut) {
      e.preventDefault()
      setShowHelp(false)
      router.push(shortcut.path)
    }
  }, [router])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Help dialog
  if (!showHelp) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => setShowHelp(false)}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">Keyboard Shortcuts</h2>
          </div>
          <button onClick={() => setShowHelp(false)} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Shortcuts list */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-2">
            {SHORTCUTS.map(s => (
              <div key={s.key} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50">
                <span className="text-sm text-gray-700">{s.description}</span>
                <kbd className="px-2.5 py-1 text-xs font-mono bg-gray-100 border border-gray-200 rounded-md text-gray-600 shadow-sm">
                  {s.label}
                </kbd>
              </div>
            ))}
            {/* Special shortcuts */}
            <div className="border-t border-gray-100 pt-2 mt-2">
              <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50">
                <span className="text-sm text-gray-700">Show/hide this help</span>
                <kbd className="px-2.5 py-1 text-xs font-mono bg-gray-100 border border-gray-200 rounded-md text-gray-600 shadow-sm">
                  Alt + /
                </kbd>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50">
                <span className="text-sm text-gray-700">Close dialog / cancel</span>
                <kbd className="px-2.5 py-1 text-xs font-mono bg-gray-100 border border-gray-200 rounded-md text-gray-600 shadow-sm">
                  Escape
                </kbd>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400 text-center">
            Shortcuts are disabled when typing in input fields
          </p>
        </div>
      </div>
    </div>
  )
}
