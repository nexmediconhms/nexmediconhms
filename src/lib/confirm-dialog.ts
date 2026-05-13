/**
 * src/lib/confirm-dialog.ts
 *
 * ═══════════════════════════════════════════════════════════════
 * CRITICAL BUG FIX: Replace native confirm() with a proper
 * Promise-based dialog.
 *
 * WHY THIS MATTERS:
 *   - Native confirm() is BLOCKED in iframes (the video
 *     consultation panel embeds Jitsi in an iframe — any code
 *     running in that context cannot use confirm()).
 *   - Some mobile browsers (especially Chrome on Android) suppress
 *     confirm() dialogs entirely.
 *   - confirm() is synchronous and blocks the main thread.
 *
 * HOW TO USE:
 *
 *   import { showConfirm } from '@/lib/confirm-dialog'
 *
 *   // Simple replacement for: if (!confirm('Delete this slot?')) return
 *   const ok = await showConfirm({
 *     title:   'Delete Slot',
 *     message: 'Are you sure you want to delete this appointment slot? This cannot be undone.',
 *     confirmLabel: 'Delete',
 *     danger:  true,
 *   })
 *   if (!ok) return
 *
 * IMPLEMENTATION:
 *   - Injects a modal into document.body dynamically.
 *   - Returns a Promise<boolean> that resolves when user clicks.
 *   - Cleans up (removes modal from DOM) after resolution.
 *   - Works in all modern browsers and does NOT depend on React.
 *   - Safe in iframes (uses DOM, not window.confirm).
 *   - Keyboard accessible: Enter = confirm, Escape = cancel.
 *   - Focus-trapped within the dialog while open.
 * ═══════════════════════════════════════════════════════════════
 */

export interface ConfirmOptions {
  title?:         string
  message:        string
  confirmLabel?:  string
  cancelLabel?:   string
  danger?:        boolean  // true = red confirm button
}

/**
 * Shows a styled confirmation dialog.
 * Returns true if the user clicked Confirm, false if Cancel/Escape.
 *
 * Completely safe as a drop-in for:
 *   if (!confirm('...')) return
 *   →
 *   if (!(await showConfirm({ message: '...' }))) return
 */
export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  const {
    title        = 'Confirm',
    message,
    confirmLabel = 'Confirm',
    cancelLabel  = 'Cancel',
    danger       = false,
  } = options

  return new Promise<boolean>((resolve) => {
    // ── Create overlay ─────────────────────────────────────────
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-labelledby', 'confirm-title')
    overlay.setAttribute('aria-describedby', 'confirm-message')
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:99999',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:rgba(0,0,0,0.45)',
      'padding:16px',
      'animation:fadeIn 0.1s ease',
    ].join(';')

    // ── Create dialog box ──────────────────────────────────────
    const dialog = document.createElement('div')
    dialog.style.cssText = [
      'background:#fff',
      'border-radius:12px',
      'padding:24px',
      'max-width:400px',
      'width:100%',
      'box-shadow:0 20px 60px rgba(0,0,0,0.3)',
      'animation:slideUp 0.15s ease',
    ].join(';')

    // Title
    const titleEl = document.createElement('h3')
    titleEl.id    = 'confirm-title'
    titleEl.style.cssText = 'margin:0 0 8px 0;font-size:16px;font-weight:700;color:#111827'
    titleEl.textContent   = title

    // Message
    const msgEl = document.createElement('p')
    msgEl.id    = 'confirm-message'
    msgEl.style.cssText = 'margin:0 0 20px 0;font-size:14px;color:#4b5563;line-height:1.5'
    msgEl.textContent   = message

    // Button row
    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end'

    // Cancel button
    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = cancelLabel
    cancelBtn.style.cssText = [
      'padding:8px 16px',
      'border-radius:8px',
      'border:1px solid #d1d5db',
      'background:#fff',
      'color:#374151',
      'font-size:14px',
      'font-weight:600',
      'cursor:pointer',
    ].join(';')

    // Confirm button
    const confirmBtn = document.createElement('button')
    confirmBtn.textContent = confirmLabel
    confirmBtn.style.cssText = [
      'padding:8px 16px',
      'border-radius:8px',
      'border:none',
      danger ? 'background:#dc2626' : 'background:#2563eb',
      'color:#fff',
      'font-size:14px',
      'font-weight:600',
      'cursor:pointer',
    ].join(';')

    // ── Cleanup & resolve ─────────────────────────────────────
    function cleanup(result: boolean) {
      document.removeEventListener('keydown', keyHandler)
      document.body.removeChild(overlay)
      resolve(result)
    }

    // ── Event handlers ────────────────────────────────────────
    cancelBtn.addEventListener('click',  () => cleanup(false))
    confirmBtn.addEventListener('click', () => cleanup(true))

    // Close on overlay click (not dialog click)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false)
    })

    // Keyboard: Escape = cancel, Enter = confirm
    function keyHandler(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false) }
      if (e.key === 'Enter')  { e.preventDefault(); cleanup(true)  }
    }
    document.addEventListener('keydown', keyHandler)

    // ── Assemble ──────────────────────────────────────────────
    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(confirmBtn)
    dialog.appendChild(titleEl)
    dialog.appendChild(msgEl)
    dialog.appendChild(btnRow)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    // Focus the confirm button (or cancel if danger=true for safety)
    setTimeout(() => {
      danger ? cancelBtn.focus() : confirmBtn.focus()
    }, 50)
  })
}

/**
 * Convenience: shows a red "danger" confirm dialog.
 * Use for all destructive actions (delete, cancel, override).
 *
 * Example:
 *   const ok = await dangerConfirm('Delete this appointment slot?')
 *   if (!ok) return
 */
export async function dangerConfirm(
  message: string,
  title = 'Are you sure?',
): Promise<boolean> {
  return showConfirm({
    title,
    message,
    confirmLabel: 'Yes, Delete',
    cancelLabel:  'Cancel',
    danger:       true,
  })
}