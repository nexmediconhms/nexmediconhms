'use client'
/**
 * src/components/shared/PatientPortalLinkButton.tsx
 *
 * Reusable "Send Portal Link" button for staff.
 * Calls /api/portal/send-link, then opens WhatsApp with the pre-filled message.
 *
 * Usage (patients/page.tsx row, patients/[id]/page.tsx header, etc.):
 *   <PatientPortalLinkButton
 *     patientId={p.id}
 *     mrn={p.mrn}
 *     mobile={p.mobile}
 *     patientName={p.full_name}
 *   />
 *
 * ── What it does ──
 * 1. Staff clicks the button.
 * 2. A POST to /api/portal/send-link generates:
 *    - A new OTP + magic-link token in portal_otp table (10 min expiry)
 *    - A legacy portal_tokens entry (24 hr expiry) for backward compat
 * 3. The API returns a WhatsApp deep-link with a pre-filled message that
 *    contains the magic link URL (/portal/verify?token=XXX) and OTP.
 * 4. The browser opens that WhatsApp link so the staff member can tap Send.
 * 5. Patient taps the link on WhatsApp → /portal/verify?token=XXX
 *    → token verified → session created → /portal/dashboard
 *
 * ── No existing code is changed ──
 * Drop this file into src/components/shared/ and import where needed.
 */

import { useState } from 'react'
import { ExternalLink, Loader2, CheckCircle, AlertCircle } from 'lucide-react'

interface Props {
  patientId: string
  mrn: string
  mobile?: string | null
  patientName?: string
  /** Optional extra CSS classes on the button */
  className?: string
  /** Button label (defaults to "Send Portal Link") */
  label?: string
  /** Show as icon-only (no text) — useful for table rows */
  iconOnly?: boolean
}

type State = 'idle' | 'loading' | 'sent' | 'error'

export default function PatientPortalLinkButton({
  patientId,
  mrn,
  mobile,
  patientName,
  className = '',
  label = 'Send Portal Link',
  iconOnly = false,
}: Props) {
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSend(e: React.MouseEvent) {
    // Prevent row-click navigation on tables
    e.stopPropagation()
    e.preventDefault()

    if (state === 'loading') return

    // Warn if no mobile — link will still be generated but WhatsApp won't auto-open
    if (!mobile) {
      const ok = window.confirm(
        `No mobile number on file for ${patientName || 'this patient'}.\n\n` +
        `A portal link will still be generated, but you'll need to share it manually.\n\nContinue?`
      )
      if (!ok) return
    }

    setState('loading')
    setErrorMsg('')

    try {
      const res = await fetch('/api/portal/send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id:   patientId,
          mrn,
          mobile:       mobile ?? '',
          patient_name: patientName ?? '',
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to generate link')
        setState('error')
        // Reset to idle after 4 seconds so staff can retry
        setTimeout(() => setState('idle'), 4000)
        return
      }

      setState('sent')

      // Open WhatsApp if we have a deep-link
      if (data.whatsapp_link) {
        window.open(data.whatsapp_link, '_blank', 'noopener,noreferrer')
      } else {
        // No mobile — copy link to clipboard as fallback
        if (data.portal_url) {
          try {
            await navigator.clipboard.writeText(data.portal_url)
            alert(`Portal link copied to clipboard:\n${data.portal_url}`)
          } catch {
            alert(`Portal link:\n${data.portal_url}`)
          }
        }
      }

      // Reset to idle after 3 seconds so button can be re-used
      setTimeout(() => setState('idle'), 3000)
    } catch (err) {
      console.error('[PatientPortalLinkButton]', err)
      setErrorMsg('Network error. Please try again.')
      setState('error')
      setTimeout(() => setState('idle'), 4000)
    }
  }

  // ── Icon + colour per state ────────────────────────────────────
  const stateConfig = {
    idle: {
      icon: <ExternalLink className="w-3.5 h-3.5" />,
      text: label,
      cls: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
    },
    loading: {
      icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      text: 'Sending…',
      cls: 'bg-green-50 text-green-400 border-green-200 cursor-not-allowed opacity-70',
    },
    sent: {
      icon: <CheckCircle className="w-3.5 h-3.5" />,
      text: 'Sent!',
      cls: 'bg-green-100 text-green-700 border-green-300',
    },
    error: {
      icon: <AlertCircle className="w-3.5 h-3.5" />,
      text: errorMsg || 'Error',
      cls: 'bg-red-50 text-red-600 border-red-200',
    },
  }

  const { icon, text, cls } = stateConfig[state]

  return (
    <button
      type="button"
      onClick={handleSend}
      disabled={state === 'loading'}
      title={
        state === 'error'
          ? errorMsg
          : mobile
          ? `Send portal magic link to ${mobile}`
          : 'No mobile — will copy link to clipboard'
      }
      className={`
        flex items-center gap-1 text-xs px-2 py-1
        border rounded-lg transition-colors font-medium whitespace-nowrap
        ${cls}
        ${className}
      `}
    >
      {icon}
      {!iconOnly && <span>{text}</span>}
    </button>
  )
}