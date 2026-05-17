'use client'
/**
 * Smart Visit Detection Component
 * 
 * Shows at reception/queue page when a patient is selected.
 * Auto-detects visit type and suggests fees.
 */

import { useState, useEffect } from 'react'
import { detectVisitType, VisitDetectionResult } from '@/lib/smart-visit'
import {
  Clock, IndianRupee, CheckCircle, AlertCircle,
  UserPlus, RefreshCw, Calendar, Baby,
  Stethoscope, ArrowRight, Zap,
} from 'lucide-react'

interface Props {
  patientId: string
  patientName: string
  onFeeSelected?: (fee: number, visitType: string) => void
  onAddToQueue?: (visitType: string, fee: number) => void
  compact?: boolean
}

export default function VisitDetector({ patientId, patientName, onFeeSelected, onAddToQueue, compact }: Props) {
  const [result, setResult] = useState<VisitDetectionResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [overrideFee, setOverrideFee] = useState<number | null>(null)
  const [overrideType, setOverrideType] = useState<string | null>(null)

  useEffect(() => {
    if (!patientId) return
    setLoading(true)
    detectVisitType(patientId)
      .then(r => { setResult(r); setOverrideFee(null); setOverrideType(null) })
      .finally(() => setLoading(false))
  }, [patientId])

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
        <div className="h-3 bg-gray-100 rounded w-2/3" />
      </div>
    )
  }

  if (!result) return null

  const activeFee = overrideFee ?? result.suggestedFee
  const activeType = overrideType ?? result.visitType

  const typeConfig = {
    'new': { icon: UserPlus, color: 'bg-blue-50 border-blue-200 text-blue-700', badge: 'bg-blue-100 text-blue-700', label: 'New Consultation' },
    'follow-up': { icon: RefreshCw, color: 'bg-green-50 border-green-200 text-green-700', badge: 'bg-green-100 text-green-700', label: 'Follow-up' },
    'anc-followup': { icon: Baby, color: 'bg-pink-50 border-pink-200 text-pink-700', badge: 'bg-pink-100 text-pink-700', label: 'ANC Visit' },
    'post-op': { icon: Stethoscope, color: 'bg-purple-50 border-purple-200 text-purple-700', badge: 'bg-purple-100 text-purple-700', label: 'Post-Op Follow-up' },
    'procedure': { icon: Calendar, color: 'bg-orange-50 border-orange-200 text-orange-700', badge: 'bg-orange-100 text-orange-700', label: 'Procedure' },
  }

  const config = typeConfig[activeType as keyof typeof typeConfig] || typeConfig['new']
  const Icon = config.icon

  if (compact) {
    return (
      <div className={`flex items-center gap-3 border rounded-lg p-3 ${config.color}`}>
        <Icon className="w-4 h-4 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold">{config.label}</span>
          <span className="text-xs opacity-70 ml-2">₹{activeFee}</span>
        </div>
        {onAddToQueue && (
          <button
            onClick={() => onAddToQueue(activeType, activeFee)}
            className="text-xs font-bold bg-white/80 px-2.5 py-1 rounded-lg hover:bg-white transition-colors flex items-center gap-1"
          >
            <Zap className="w-3 h-3" /> Queue
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`border rounded-xl overflow-hidden ${config.color}`}>
      {/* Header */}
      <div className="p-4 border-b border-current/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5" />
            <div>
              <h3 className="text-sm font-bold">{config.label}</h3>
              <p className="text-xs opacity-70">{result.reason}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${config.badge}`}>
              {result.confidence === 'high' ? '✓ High confidence' : '? Verify with patient'}
            </span>
          </div>
        </div>
      </div>

      {/* Fee & Last Visit */}
      <div className="p-4 bg-white/50">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Suggested Fee</div>
            <div className="text-2xl font-black text-gray-900 flex items-center gap-1">
              <IndianRupee className="w-5 h-5" />
              {activeFee}
            </div>
          </div>

          {/* Quick fee override buttons */}
          <div className="flex gap-1.5">
            {result.visitType !== 'new' && (
              <button
                onClick={() => { setOverrideFee(result.suggestedFee); setOverrideType(result.visitType) }}
                className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                  activeType === result.visitType ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Follow-up ₹{result.suggestedFee}
              </button>
            )}
            <button
              onClick={() => { setOverrideFee(500); setOverrideType('new') }}
              className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                activeType === 'new' && overrideFee === 500 ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              New ₹500
            </button>
          </div>
        </div>

        {/* Last visit info */}
        {result.lastVisit && (
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-3 h-3 text-gray-400" />
              <span className="text-[10px] font-bold text-gray-500">
                Last Visit: {result.lastVisit.daysSince} days ago ({result.lastVisit.date})
              </span>
            </div>
            {result.lastVisit.complaint && (
              <p className="text-xs text-gray-600">
                <span className="font-medium">Complaint:</span> {result.lastVisit.complaint}
              </p>
            )}
            {result.lastVisit.diagnosis && (
              <p className="text-xs text-gray-600">
                <span className="font-medium">Diagnosis:</span> {result.lastVisit.diagnosis}
              </p>
            )}
          </div>
        )}

        {/* ANC info */}
        {result.ancData && (
          <div className="bg-pink-50 border border-pink-100 rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 mb-1">
              <Baby className="w-3 h-3 text-pink-400" />
              <span className="text-[10px] font-bold text-pink-600">Active Pregnancy</span>
            </div>
            <p className="text-xs text-pink-700">
              GA: {result.ancData.gestationalAge} • EDD: {result.ancData.edd} • Visit #{result.ancData.visitNumber}
            </p>
          </div>
        )}

        {/* Suggested Actions */}
        <div className="space-y-1.5">
          {result.suggestedActions.map((action, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
              <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" />
              {action}
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-4">
          {onAddToQueue && (
            <button
              onClick={() => onAddToQueue(activeType, activeFee)}
              className="flex-1 flex items-center justify-center gap-2 bg-gray-900 text-white font-bold text-xs px-4 py-2.5 rounded-lg hover:bg-gray-800 transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />
              Add to Queue (₹{activeFee})
            </button>
          )}
          {onFeeSelected && (
            <button
              onClick={() => onFeeSelected(activeFee, activeType)}
              className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 font-bold text-xs px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              Proceed
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
