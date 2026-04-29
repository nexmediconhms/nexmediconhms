'use client'

/**
 * src/components/clinical/ClinicalSafetyModal.tsx
 *
 * Universal Clinical Safety Alert Modal
 *
 * Used by prescription page and vitals entry to show:
 *   - Drug interaction warnings
 *   - Allergy alerts (with hard stops)
 *   - Dose validation alerts
 *   - Critical value alerts
 *
 * Hard Stop: Doctor MUST acknowledge with a documented reason before proceeding.
 * Warning: Doctor can proceed but alert is logged.
 */

import { useState } from 'react'
import { AlertTriangle, XCircle, AlertOctagon, Info, Shield, X } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────

export type AlertLevel = 'critical' | 'major' | 'moderate' | 'minor' | 'info'

export interface ClinicalAlert {
  id: string
  level: AlertLevel
  category: 'drug-interaction' | 'allergy' | 'dose' | 'critical-value' | 'pregnancy'
  title: string
  message: string
  details?: string
  action?: string
  isHardStop: boolean
}

interface ClinicalSafetyModalProps {
  alerts: ClinicalAlert[]
  onAcknowledge: (overrideReason?: string) => void
  onCancel: () => void
  patientName?: string
}

// ─── Component ────────────────────────────────────────────────

export default function ClinicalSafetyModal({
  alerts,
  onAcknowledge,
  onCancel,
  patientName,
}: ClinicalSafetyModalProps) {
  const [overrideReason, setOverrideReason] = useState('')
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set())

  const hasHardStop = alerts.some(a => a.isHardStop)
  const criticalAlerts = alerts.filter(a => a.level === 'critical')
  const majorAlerts = alerts.filter(a => a.level === 'major')
  const moderateAlerts = alerts.filter(a => a.level === 'moderate')
  const minorAlerts = alerts.filter(a => a.level === 'minor' || a.level === 'info')

  const allHardStopsAcknowledged = alerts
    .filter(a => a.isHardStop)
    .every(a => acknowledged.has(a.id))

  const canProceed = hasHardStop
    ? allHardStopsAcknowledged && overrideReason.trim().length >= 10
    : true

  function toggleAcknowledge(id: string) {
    setAcknowledged(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const levelConfig = {
    critical: {
      bg: 'bg-red-50 border-red-300',
      icon: <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />,
      badge: 'bg-red-600 text-white',
      label: 'CRITICAL',
    },
    major: {
      bg: 'bg-orange-50 border-orange-300',
      icon: <AlertOctagon className="w-5 h-5 text-orange-600 flex-shrink-0" />,
      badge: 'bg-orange-600 text-white',
      label: 'MAJOR',
    },
    moderate: {
      bg: 'bg-yellow-50 border-yellow-300',
      icon: <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />,
      badge: 'bg-yellow-600 text-white',
      label: 'MODERATE',
    },
    minor: {
      bg: 'bg-blue-50 border-blue-300',
      icon: <Info className="w-5 h-5 text-blue-600 flex-shrink-0" />,
      badge: 'bg-blue-600 text-white',
      label: 'MINOR',
    },
    info: {
      bg: 'bg-gray-50 border-gray-300',
      icon: <Info className="w-5 h-5 text-gray-600 flex-shrink-0" />,
      badge: 'bg-gray-600 text-white',
      label: 'INFO',
    },
  }

  function renderAlert(alert: ClinicalAlert) {
    const config = levelConfig[alert.level]
    return (
      <div key={alert.id} className={`border rounded-lg p-4 ${config.bg}`}>
        <div className="flex items-start gap-3">
          {config.icon}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${config.badge}`}>
                {config.label}
              </span>
              <span className="text-xs text-gray-500 capitalize">
                {alert.category.replace(/-/g, ' ')}
              </span>
            </div>
            <h4 className="font-semibold text-gray-900 text-sm">{alert.title}</h4>
            <p className="text-sm text-gray-700 mt-1">{alert.message}</p>
            {alert.details && (
              <p className="text-xs text-gray-500 mt-1 italic">{alert.details}</p>
            )}
            {alert.action && (
              <div className="mt-2 text-xs bg-white/60 rounded p-2 border border-gray-200">
                <span className="font-semibold">Recommended Action: </span>
                {alert.action}
              </div>
            )}
            {alert.isHardStop && (
              <label className="flex items-center gap-2 mt-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged.has(alert.id)}
                  onChange={() => toggleAcknowledge(alert.id)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                />
                <span className="text-xs font-semibold text-red-700">
                  I acknowledge this risk and accept responsibility
                </span>
              </label>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className={`px-6 py-4 rounded-t-2xl flex items-center justify-between ${
          criticalAlerts.length > 0 ? 'bg-red-600' : majorAlerts.length > 0 ? 'bg-orange-600' : 'bg-yellow-600'
        }`}>
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-white" />
            <div>
              <h2 className="text-lg font-bold text-white">
                ⚠️ Clinical Safety Alert{alerts.length > 1 ? 's' : ''}
              </h2>
              {patientName && (
                <p className="text-sm text-white/80">Patient: {patientName}</p>
              )}
            </div>
          </div>
          <button onClick={onCancel} className="text-white/80 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alert List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {criticalAlerts.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2">
                🚨 Critical — Requires Override
              </h3>
              <div className="space-y-2">{criticalAlerts.map(renderAlert)}</div>
            </div>
          )}
          {majorAlerts.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-orange-600 uppercase tracking-wider mb-2 mt-4">
                ⚠️ Major Warnings
              </h3>
              <div className="space-y-2">{majorAlerts.map(renderAlert)}</div>
            </div>
          )}
          {moderateAlerts.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-yellow-600 uppercase tracking-wider mb-2 mt-4">
                Moderate Warnings
              </h3>
              <div className="space-y-2">{moderateAlerts.map(renderAlert)}</div>
            </div>
          )}
          {minorAlerts.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2 mt-4">
                Informational
              </h3>
              <div className="space-y-2">{minorAlerts.map(renderAlert)}</div>
            </div>
          )}

          {/* Override Reason (required for hard stops) */}
          {hasHardStop && (
            <div className="mt-4 border-t pt-4">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Override Reason <span className="text-red-500">*</span>
                <span className="text-xs font-normal text-gray-500 ml-2">
                  (minimum 10 characters — this will be recorded in the audit log)
                </span>
              </label>
              <textarea
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                placeholder="Document your clinical justification for overriding this safety alert..."
                className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
                rows={3}
              />
              {overrideReason.length > 0 && overrideReason.length < 10 && (
                <p className="text-xs text-red-500 mt-1">
                  Please provide at least 10 characters ({10 - overrideReason.length} more needed)
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 rounded-b-2xl flex items-center justify-between">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            ← Go Back & Modify
          </button>
          <div className="flex items-center gap-3">
            {hasHardStop && (
              <span className="text-xs text-gray-500">
                {allHardStopsAcknowledged && overrideReason.trim().length >= 10
                  ? '✅ Ready to proceed'
                  : '⏳ Acknowledge all alerts and provide reason'}
              </span>
            )}
            <button
              onClick={() => onAcknowledge(hasHardStop ? overrideReason : undefined)}
              disabled={!canProceed}
              className={`px-6 py-2 text-sm font-semibold rounded-lg transition-colors ${
                canProceed
                  ? hasHardStop
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {hasHardStop ? 'Override & Proceed →' : 'Acknowledge & Proceed →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
