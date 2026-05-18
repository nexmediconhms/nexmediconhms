'use client'
/**
 * AccessibilityHelpers — A11y improvements for NexMedicon HMS
 *
 * Components:
 *   - SkipToContent: Hidden link that becomes visible on Tab key focus
 *   - ScreenReaderOnly: Visually hidden text for screen readers
 *   - FocusTrap: Traps focus within a modal/dialog
 *   - LiveRegion: Announces dynamic content changes to screen readers
 */

import { useEffect, useRef, ReactNode } from 'react'

// ── Skip to Content ───────────────────────────────────────────
/**
 * Hidden link that appears when user tabs. Allows keyboard users
 * to skip past navigation directly to main content.
 *
 * Place this at the very top of your layout, before the sidebar.
 */
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[99999]
                 focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg
                 focus:text-sm focus:font-semibold focus:shadow-lg focus:outline-none
                 focus:ring-2 focus:ring-blue-300 transition-all"
    >
      Skip to main content
    </a>
  )
}

// ── Screen Reader Only text ───────────────────────────────────
export function ScreenReaderOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>
}

// ── Live Region for dynamic announcements ─────────────────────
/**
 * Announces content changes to screen readers without visual display.
 * Use for: toast notifications, form errors, status updates.
 *
 * USAGE:
 *   <LiveRegion message={errorMsg} />
 */
export function LiveRegion({
  message,
  politeness = 'polite',
}: {
  message: string
  politeness?: 'polite' | 'assertive'
}) {
  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  )
}

// ── Focus Trap (for modals) ───────────────────────────────────
/**
 * Traps keyboard focus within the container element.
 * When user tabs past the last focusable element, focus wraps to the first.
 *
 * USAGE:
 *   <FocusTrap active={isModalOpen}>
 *     <div className="modal">...</div>
 *   </FocusTrap>
 */
export function FocusTrap({
  active,
  children,
}: {
  active: boolean
  children: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active || !containerRef.current) return

    const container = containerRef.current
    const focusableElements = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )

    if (focusableElements.length === 0) return

    const first = focusableElements[0]
    const last = focusableElements[focusableElements.length - 1]

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first, wrap to last
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        // Tab: if focus is on last, wrap to first
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    // Auto-focus first element when trap activates
    first.focus()

    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [active])

  return <div ref={containerRef}>{children}</div>
}

// ── Keyboard shortcut hint badge ──────────────────────────────
/**
 * Small pill showing a keyboard shortcut hint.
 * Only visible on hover of parent (to avoid clutter on mobile).
 *
 * USAGE:
 *   <button>
 *     Search <ShortcutBadge keys={['Ctrl', 'K']} />
 *   </button>
 */
export function ShortcutBadge({ keys }: { keys: string[] }) {
  return (
    <span className="hidden md:inline-flex items-center gap-0.5 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
      {keys.map((key, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5
                     text-[10px] font-mono font-semibold text-gray-500 bg-gray-100
                     border border-gray-200 rounded shadow-sm"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
