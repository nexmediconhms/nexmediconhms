'use client'
/**
 * src/components/shared/SendPortalLinkSection.tsx
 *
 * A card section you can drop into src/app/patients/[id]/page.tsx
 * inside the patient header card's action area.
 *
 * It shows:
 *   - A "Send Portal Link" button (uses PatientPortalLinkButton internally)
 *   - After sending, displays the generated portal URL so staff can
 *     also copy & share it manually.
 *
 * ── How to integrate into patients/[id]/page.tsx ──
 *
 * 1. Import at the top:
 *      import SendPortalLinkSection from '@/components/shared/SendPortalLinkSection'
 *
 * 2. Add inside the patient header card, e.g. near the Edit / OPD buttons:
 *      <SendPortalLinkSection
 *        patientId={patient.id}
 *        mrn={patient.mrn}
 *        mobile={patient.mobile}
 *        patientName={patient.full_name}
 *      />
 *
 * Nothing else in patients/[id]/page.tsx needs to change.
 */

import { useState } from 'react'
import { ExternalLink, Loader2, CheckCircle, AlertCircle, Copy, MessageCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Props {
  patientId: string
  mrn: string
  mobile?: string | null
  patientName?: string
}

type State = 'idle' | 'loading' | 'done' | 'error'

export default function SendPortalLinkSection({ patientId, mrn, mobile, patientName }: Props) {
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [portalUrl, setPortalUrl] = useState('')
  const [waLink, setWaLink] = useState('')
  const [copied, setCopied] = useState(false)

  async function handleSend() {
    if (state === 'loading') return

    // FIX: Open a placeholder tab synchronously (inside the click gesture)
    // so the WhatsApp deep-link isn't blocked by the popup blocker after the
    // async API call. The "Open WhatsApp" button below is the manual fallback.
    const waWindow = mobile ? window.open('about:blank', '_blank') : null

    setState('loading')
    setErrorMsg('')
    setPortalUrl('')
    setWaLink('')

    try {
      // FIX: /api/portal/send-link requires a Bearer token. Without it the
      // request was failing with 401 and no link was ever generated.
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      if (sessionError || !session?.access_token) {
        waWindow?.close()
        setErrorMsg('Your session has expired. Please log in again.')
        setState('error')
        return
      }

      const res = await fetch('/api/portal/send-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          patient_id:   patientId,
          mrn,
          mobile:       mobile ?? '',
          patient_name: patientName ?? '',
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        waWindow?.close()
        setErrorMsg(data.error || 'Failed to generate portal link')
        setState('error')
        return
      }

      setPortalUrl(data.portal_url || '')
      setWaLink(data.whatsapp_link || '')
      setState('done')

      // Auto-open WhatsApp in the pre-opened tab (survives popup blocker)
      if (data.whatsapp_link && waWindow) {
        waWindow.location.href = data.whatsapp_link
      } else if (data.whatsapp_link) {
        window.open(data.whatsapp_link, '_blank', 'noopener,noreferrer')
      } else {
        waWindow?.close()
      }
    } catch {
      waWindow?.close()
      setErrorMsg('Network error. Please check your connection.')
      setState('error')
    }
  }

  async function copyLink() {
    if (!portalUrl) return
    try {
      await navigator.clipboard.writeText(portalUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      window.prompt('Copy this portal link:', portalUrl)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Patient Portal</span>

        {state === 'idle' && (
          <button
            onClick={handleSend}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors font-medium">
            <ExternalLink className="w-3.5 h-3.5" />
            Send Portal Link via WhatsApp
          </button>
        )}

        {state === 'loading' && (
          <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 text-green-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Generating link…
          </span>
        )}

        {state === 'error' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertCircle className="w-3.5 h-3.5" />
              {errorMsg}
            </span>
            <button
              onClick={() => setState('idle')}
              className="text-xs text-blue-600 hover:underline">
              Try again
            </button>
          </div>
        )}

        {state === 'done' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              Portal link generated!
            </span>

            {/* Re-open WhatsApp */}
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs px-2 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium">
                <MessageCircle className="w-3 h-3" />
                Open WhatsApp
              </a>
            )}

            {/* Copy link */}
            {portalUrl && (
              <button
                onClick={copyLink}
                className="flex items-center gap-1 text-xs px-2 py-1 bg-gray-100 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-200 transition-colors font-medium">
                <Copy className="w-3 h-3" />
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
            )}

            {/* Send again */}
            <button
              onClick={() => setState('idle')}
              className="text-xs text-blue-600 hover:underline">
              Send again
            </button>
          </div>
        )}
      </div>

      {/* Show the URL inline so staff can read it */}
      {state === 'done' && portalUrl && (
        <p className="mt-1.5 text-xs text-gray-400 font-mono truncate" title={portalUrl}>
          {portalUrl}
        </p>
      )}

      {/* Helper text when no mobile is present */}
      {!mobile && state === 'idle' && (
        <p className="mt-1 text-xs text-amber-600">
          ⚠ No mobile number on file — link will be generated but WhatsApp won&apos;t auto-open.
        </p>
      )}
    </div>
  )
}