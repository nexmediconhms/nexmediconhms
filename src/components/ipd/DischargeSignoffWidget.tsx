'use client'
/**
 * src/components/ipd/DischargeSignoffWidget.tsx
 *
 * Compact sign-off widget for use in IPD Chart pages.
 * Allows nurses and doctors to sign off for discharge
 * directly from the IPD Chart, syncing with the discharge workflow.
 */

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { CheckCircle, Loader2, UserCheck, PenTool } from 'lucide-react'

interface Props {
  admissionId: string
  patientId: string
  currentUser: string
  role: 'nurse' | 'doctor'
}

export default function DischargeSignoffWidget({ admissionId, patientId, currentUser, role }: Props) {
  const [signoff, setSignoff] = useState<{ signed_by: string; signed_at: string; comments: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [signing, setSigning] = useState(false)
  const [comment, setComment] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadSignoff()
  }, [admissionId, role])

  async function loadSignoff() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('discharge_signoffs')
        .select('signed_by, signed_at, comments')
        .eq('admission_id', admissionId)
        .eq('role', role)
        .eq('status', 'approved')
        .order('signed_at', { ascending: false })
        .limit(1)
        .single()
      if (data) setSignoff(data)
    } catch {
      // Table may not exist yet - graceful fallback
    }
    setLoading(false)
  }

  async function handleSignoff() {
    setSigning(true)
    setError('')
    try {
      const { error: err } = await supabase
        .from('discharge_signoffs')
        .insert({
          admission_id: admissionId,
          patient_id: patientId,
          role,
          signed_by: currentUser || 'Admin',
          status: 'approved',
          comments: comment || null,
        })
      if (err) throw err
      setComment('')
      setShowForm(false)
      await loadSignoff()
    } catch (e: any) {
      setError(e.message || 'Failed to sign off')
    } finally {
      setSigning(false)
    }
  }

  const roleLabel = role === 'nurse' ? 'Nursing' : 'Doctor'
  const roleColor = role === 'nurse' ? 'pink' : 'blue'

  if (loading) {
    return (
      <div className="mt-6 border-t border-gray-200 pt-4">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 className="w-3 h-3 animate-spin" /> Checking discharge sign-off status...
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6 border-t border-gray-200 pt-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
        <UserCheck className="w-4 h-4" /> {roleLabel} Discharge Sign-off
      </h4>

      {signoff ? (
        <div className={`bg-${roleColor}-50 border border-${roleColor}-200 rounded-lg p-3 flex items-center gap-2`}>
          <CheckCircle className={`w-4 h-4 text-${roleColor}-600`} />
          <div>
            <p className={`text-xs font-medium text-${roleColor}-800`}>
              Signed off by {signoff.signed_by}
            </p>
            <p className="text-[10px] text-gray-500">
              {new Date(signoff.signed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              { signoff.comments ? ` \u2014 ${signoff.comments}` : ''}
            </p>
          </div>
        </div>
      ) : (
        <div>
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className={`flex items-center gap-1.5 bg-${roleColor}-50 hover:bg-${roleColor}-100 text-${roleColor}-700 border border-${roleColor}-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors`}
            >
              <PenTool className="w-4 h-4" /> {roleLabel} Sign-off for Discharge
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={`Optional comments for ${roleLabel.toLowerCase()} sign-off...`}
                className="w-full text-sm border border-gray-300 rounded-lg p-2.5 resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={2}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSignoff}
                  disabled={signing}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {signing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenTool className="w-4 h-4" />}
                  Confirm Sign-off
                </button>
                <button
                  onClick={() => { setShowForm(false); setComment('') }}
                  className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[10px] text-gray-400">
                Signing off as: <span className="font-medium text-gray-600">{currentUser || 'Admin'}</span>
              </p>
            </div>
          )}
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      )}
    </div>
  )
}
