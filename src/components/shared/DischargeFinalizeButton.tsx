/**
 * DischargeFinalizeButton
 *
 * WHAT THIS IS:
 *   A drop-in replacement for the inline "Finalise" button that was inside
 *   handleSave(finalise=true) in src/app/patients/[id]/discharge/page.tsx.
 *
 * WHAT CHANGED vs original code:
 *   - Original: "Finalise & Sign" triggered handleSave(true) which called
 *     supabase.from('dischargesummaries').update({ isfinal: true }) directly
 *     from the browser — no separate API, no concurrency protection.
 *   - Now: calls POST /api/discharge/finalize (server-side, auth-guarded).
 *   - The Unfinalize flow is brand new — there was no way to revert previously.
 *
 * HOW TO INTEGRATE (3 lines change in discharge/page.tsx):
 *   1. Import this component at the top.
 *   2. Replace the existing "Finalise & Sign" button JSX with <DischargeFinalizeButton ...>.
 *   3. Remove the `finalise` parameter from handleSave — drafts still use handleSave(false).
 *
 * PROPS:
 *   dischargeSummaryId  - UUID of the existing saved record (null = not saved yet → button disabled)
 *   patientId           - UUID of the patient
 *   version             - current version number from the loaded record (for conflict detection)
 *   isFinal             - current isfinal value from the loaded record
 *   signedBy            - who signed it (from existing.signedby)
 *   signedAt            - ISO timestamp (from existing.signedat)
 *   role                - 'admin' | 'doctor' | 'staff' (from Supabase session)
 *   onFinalized         - callback after successful finalization (update parent state)
 *   onUnfinalized       - callback after successful unfinalization (update parent state)
 */

'use client'

import { useState } from 'react'
import { CheckCircle, Lock, Unlock, AlertTriangle, Loader2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { supabase } from '@/lib/supabase'

// Helper: fetch the current Supabase access token. Returns null if the
// session has expired so callers can show a clear "log in again" message
// instead of letting the request fall through with no Authorization header
// (which the new auth-guarded discharge API now rejects with 401).
async function getAuthHeader(): Promise<Record<string, string> | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return null
  return { Authorization: `Bearer ${session.access_token}` }
}

interface DischargeFinalizeButtonProps {
  dischargeSummaryId: string | null
  patientId: string
  version: number
  isFinal: boolean
  signedBy?: string | null
  signedAt?: string | null
  role: 'admin' | 'doctor' | 'staff'
  onFinalized: () => void
  onUnfinalized: () => void
}

export default function DischargeFinalizeButton({
  dischargeSummaryId,
  patientId,
  version,
  isFinal,
  signedBy,
  signedAt,
  role,
  onFinalized,
  onUnfinalized,
}: DischargeFinalizeButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUnfinalizeModal, setShowUnfinalizeModal] = useState(false)
  const [unfinalizeReason, setUnfinalizeReason] = useState('')
  const [unfinalizeLoading, setUnfinalizeLoading] = useState(false)

  // ── Finalize handler
  async function handleFinalize() {
    if (!dischargeSummaryId) {
      setError('Save the summary as a draft first before finalizing.')
      return
    }
    if (!confirm('Finalize this discharge summary? Once finalized, it cannot be edited by doctors.')) return

    setLoading(true)
    setError(null)
    try {
      const authHeader = await getAuthHeader()
      if (!authHeader) {
        setError('Your session has expired. Please log in again.')
        return
      }
      const res = await fetch('/api/discharge/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ dischargeId: dischargeSummaryId, patientId, version }),
      })
      const data = await res.json().catch(() => ({} as Record<string, unknown>))

      if (!res.ok) {
        const errMsg = (data as { error?: string }).error || 'Failed to finalize.'
        if (res.status === 409) {
          setError(`${errMsg} Please refresh the page.`)
        } else if (res.status === 401) {
          setError('Your session has expired. Please log in again.')
        } else if (res.status === 403) {
          setError('You do not have permission to finalize discharge summaries.')
        } else {
          setError(errMsg)
        }
        return
      }
      onFinalized()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Unfinalize handler (admin only)
  async function handleUnfinalize() {
    if (!unfinalizeReason.trim() || unfinalizeReason.trim().length < 5) {
      setError('Please provide a reason (at least 5 characters).')
      return
    }
    setUnfinalizeLoading(true)
    setError(null)
    try {
      const authHeader = await getAuthHeader()
      if (!authHeader) {
        setError('Your session has expired. Please log in again.')
        return
      }
      const res = await fetch('/api/discharge/finalize?action=unfinalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ dischargeId: dischargeSummaryId, patientId, reason: unfinalizeReason.trim() }),
      })
      const data = await res.json().catch(() => ({} as Record<string, unknown>))

      if (!res.ok) {
        const errMsg = (data as { error?: string }).error || 'Failed to unfinalize.'
        if (res.status === 401) {
          setError('Your session has expired. Please log in again.')
        } else if (res.status === 403) {
          setError('Only an administrator can revert a finalized discharge summary.')
        } else {
          setError(errMsg)
        }
        return
      }
      setShowUnfinalizeModal(false)
      setUnfinalizeReason('')
      onUnfinalized()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error. Please try again.')
    } finally {
      setUnfinalizeLoading(false)
    }
  }

  // ── Render: already finalized
  if (isFinal) {
    return (
      <div className="space-y-2">
        {/* Finalized badge */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-green-800">Discharge Summary Finalised</p>
            {signedBy && (
              <p className="text-xs text-green-600 mt-0.5">
                Signed by {signedBy}
                {signedAt ? ` · ${formatDateTime(signedAt)}` : ''}
              </p>
            )}
          </div>
          <Lock className="w-4 h-4 text-green-400 flex-shrink-0" />
        </div>

        {/* Admin-only unfinalize */}
        {role === 'admin' && (
          <button
            type="button"
            onClick={() => { setShowUnfinalizeModal(true); setError(null) }}
            className="flex items-center gap-1.5 text-xs text-orange-600 hover:text-orange-700 hover:underline px-1"
          >
            <Unlock className="w-3.5 h-3.5" />
            Admin: Revert to Draft
          </button>
        )}

        {/* Error */}
        {error && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> {error}
          </p>
        )}

        {/* Unfinalize modal */}
        {showUnfinalizeModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <Unlock className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Revert to Draft</h3>
                  <p className="text-xs text-gray-500">Admin action — recorded in audit log</p>
                </div>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                This will unlock the discharge summary for editing. The reason will be permanently
                recorded and visible to all administrators.
              </p>

              <div className="mb-4">
                <label className="label">Reason for reverting <span className="text-red-500">*</span></label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  value={unfinalizeReason}
                  onChange={e => setUnfinalizeReason(e.target.value)}
                  placeholder="e.g. Incorrect diagnosis entered, needs correction before dispatch"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">{unfinalizeReason.trim().length} / 5 min characters</p>
              </div>

              {error && (
                <p className="text-sm text-red-600 mb-3 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleUnfinalize}
                  disabled={unfinalizeLoading || unfinalizeReason.trim().length < 5}
                  className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {unfinalizeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Revert to Draft
                </button>
                <button
                  type="button"
                  onClick={() => { setShowUnfinalizeModal(false); setUnfinalizeReason(''); setError(null) }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Render: draft — show Finalize button
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleFinalize}
        disabled={loading || !dischargeSummaryId}
        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-5 py-2.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title={!dischargeSummaryId ? 'Save as draft first, then finalize' : 'Finalize & sign this discharge summary'}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <CheckCircle className="w-4 h-4" />
        )}
        {loading ? 'Finalizing…' : 'Finalise & Sign'}
      </button>

      {!dischargeSummaryId && (
        <p className="text-xs text-gray-400">Save as draft first to enable finalization.</p>
      )}

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </p>
      )}
    </div>
  )
}
