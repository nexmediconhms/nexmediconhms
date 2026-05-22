'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, IndianRupee, MessageCircle, CheckCircle, Loader2, ExternalLink } from 'lucide-react'
import { createFollowUp } from '@/lib/services/appointmentService'
import { getIndiaToday } from '@/lib/utils'

interface PostDischargeActionsProps {
  patientId: string
  patientName: string
  mrn?: string
  admissionId?: string
  isFinalized: boolean
}

interface ActionStatus {
  followUp: 'idle' | 'loading' | 'done' | 'error'
  billing: 'idle' | 'done'
  notify: 'idle' | 'done'
}

export default function PostDischargeActions({
  patientId,
  patientName,
  mrn,
  admissionId,
  isFinalized,
}: PostDischargeActionsProps) {
  const router = useRouter()
  const [status, setStatus] = useState<ActionStatus>({
    followUp: 'idle',
    billing: 'idle',
    notify: 'idle',
  })
  const [error, setError] = useState<string | null>(null)

  if (!isFinalized) return null

  async function handleScheduleFollowUp() {
    if (status.followUp === 'done' || status.followUp === 'loading') return

    setStatus(prev => ({ ...prev, followUp: 'loading' }))
    setError(null)

    try {
      const today = getIndiaToday()
      const followUpDate = new Date(today)
      followUpDate.setDate(followUpDate.getDate() + 7)
      const followUpDateStr = followUpDate.toISOString().split('T')[0]

      await createFollowUp(patientId, admissionId || '', followUpDateStr, {
        patientName,
        mrn: mrn || '',
        encounterDateLabel: today,
      })

      setStatus(prev => ({ ...prev, followUp: 'done' }))
    } catch (err) {
      console.error('[PostDischargeActions] Follow-up creation failed:', err)
      setError('Failed to schedule follow-up. Please try again.')
      setStatus(prev => ({ ...prev, followUp: 'error' }))
    }
  }

  function handleGenerateBill() {
    if (status.billing === 'done') return

    setStatus(prev => ({ ...prev, billing: 'done' }))
    router.push(`/billing?patient=${patientId}`)
  }

  function handleNotifyPatient() {
    if (status.notify === 'done') return

    const message = encodeURIComponent(
      `Dear ${patientName},\n\nYou have been discharged from the hospital. ` +
      `Please follow the discharge instructions provided. ` +
      `Your follow-up visit is scheduled for 7 days from now.\n\n` +
      `If you have any concerns, please contact us.\n\n` +
      `Thank you for choosing our hospital.`
    )

    // Open WhatsApp link
    const waUrl = `https://wa.me/?text=${message}`
    window.open(waUrl, '_blank')

    setStatus(prev => ({ ...prev, notify: 'done' }))
  }

  return (
    <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
          <CheckCircle className="w-4 h-4 text-green-600" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-900">Next Steps</h3>
          <p className="text-[10px] text-gray-500">
            Discharge finalized for {patientName}
            {mrn && <span className="ml-1 text-gray-400">({mrn})</span>}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2.5">
        {/* 1. Schedule Follow-up */}
        <button
          onClick={handleScheduleFollowUp}
          disabled={status.followUp === 'done' || status.followUp === 'loading'}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${
            status.followUp === 'done'
              ? 'bg-green-100 border-green-200 cursor-default'
              : status.followUp === 'loading'
              ? 'bg-white border-gray-200 cursor-wait opacity-70'
              : 'bg-white border-gray-200 hover:border-green-300 hover:bg-green-50 cursor-pointer'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              status.followUp === 'done' ? 'bg-green-200' : 'bg-blue-100'
            }`}>
              {status.followUp === 'loading' ? (
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              ) : status.followUp === 'done' ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <Calendar className="w-4 h-4 text-blue-600" />
              )}
            </div>
            <div className="text-left">
              <span className="text-sm font-medium text-gray-800 block">
                Schedule Follow-up (7 days)
              </span>
              <span className="text-[10px] text-gray-500">
                {status.followUp === 'done' ? 'Follow-up scheduled successfully' : 'Auto-creates appointment with reminder'}
              </span>
            </div>
          </div>
          {status.followUp === 'done' && (
            <CheckCircle className="w-5 h-5 text-green-500" />
          )}
        </button>

        {/* 2. Generate Final Bill */}
        <button
          onClick={handleGenerateBill}
          disabled={status.billing === 'done'}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${
            status.billing === 'done'
              ? 'bg-green-100 border-green-200 cursor-default'
              : 'bg-white border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 cursor-pointer'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              status.billing === 'done' ? 'bg-green-200' : 'bg-emerald-100'
            }`}>
              {status.billing === 'done' ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <IndianRupee className="w-4 h-4 text-emerald-600" />
              )}
            </div>
            <div className="text-left">
              <span className="text-sm font-medium text-gray-800 block">
                Generate Final Bill
              </span>
              <span className="text-[10px] text-gray-500">
                {status.billing === 'done' ? 'Redirected to billing' : 'Open billing page for this patient'}
              </span>
            </div>
          </div>
          {status.billing === 'done' ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : (
            <ExternalLink className="w-4 h-4 text-gray-400" />
          )}
        </button>

        {/* 3. Notify Patient (WhatsApp) */}
        <button
          onClick={handleNotifyPatient}
          disabled={status.notify === 'done'}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${
            status.notify === 'done'
              ? 'bg-green-100 border-green-200 cursor-default'
              : 'bg-white border-gray-200 hover:border-green-300 hover:bg-green-50 cursor-pointer'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              status.notify === 'done' ? 'bg-green-200' : 'bg-green-100'
            }`}>
              {status.notify === 'done' ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <MessageCircle className="w-4 h-4 text-green-600" />
              )}
            </div>
            <div className="text-left">
              <span className="text-sm font-medium text-gray-800 block">
                Notify Patient (WhatsApp)
              </span>
              <span className="text-[10px] text-gray-500">
                {status.notify === 'done' ? 'WhatsApp message opened' : 'Send discharge summary via WhatsApp'}
              </span>
            </div>
          </div>
          {status.notify === 'done' ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : (
            <ExternalLink className="w-4 h-4 text-gray-400" />
          )}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}
    </div>
  )
}