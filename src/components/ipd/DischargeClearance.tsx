'use client'
/**
 * src/components/ipd/DischargeClearance.tsx
 *
 * Discharge Clearance Checklist UI
 *
 * Renders the clearance status for each department and allows:
 *  - Manual checkbox for nursing sign-off, consent, pharmacy
 *  - Admin override for blocked items (with reason input)
 *  - Visual indication of what's blocking discharge
 *  - Gates the "Confirm Discharge" button
 */

import { useState, useEffect, useCallback } from 'react'
import {
  CheckCircle, XCircle, Clock, AlertTriangle,
  IndianRupee, Pill, TestTube, Heart, FileText,
  Stethoscope, Shield, Loader2, RefreshCw, Lock,
} from 'lucide-react'
import {
  checkDischargeClearance,
  applyOverride,
  getClearanceStatusDisplay,
  type ClearanceResult,
  type ClearanceItem,
  type ClearanceCategory,
} from '@/lib/discharge-clearance'

interface DischargeClearanceProps {
  admissionId: string
  onClearanceChange: (canDischarge: boolean) => void
  /** Provide manual checks state from parent to keep in sync with form */
  manualChecks?: Partial<Record<ClearanceCategory, { cleared: boolean; by?: string }>>
  /** Is the current user an admin? (enables override) */
  isAdmin?: boolean
  /** Current user name for audit */
  currentUser?: string
}

const CATEGORY_ICONS: Record<ClearanceCategory, typeof CheckCircle> = {
  billing: IndianRupee,
  pharmacy: Pill,
  lab: TestTube,
  nursing: Heart,
  consent: FileText,
  doctor: Stethoscope,
  insurance: Shield,
}

export default function DischargeClearance({
  admissionId,
  onClearanceChange,
  manualChecks = {},
  isAdmin = false,
  currentUser = 'Admin',
}: DischargeClearanceProps) {
  const [clearance, setClearance] = useState<ClearanceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [overrideTarget, setOverrideTarget] = useState<ClearanceCategory | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  // BUG-DC03: surface override-not-applicable feedback to the operator
  const [overrideError, setOverrideError] = useState<string | null>(null)

  const runCheck = useCallback(async () => {
    setLoading(true)
    try {
      const result = await checkDischargeClearance(admissionId, manualChecks)
      setClearance(result)
      onClearanceChange(result.canDischarge)
    } catch (err) {
      console.error('[DischargeClearance] Check failed:', err)
    }
    setLoading(false)
  }, [admissionId, manualChecks, onClearanceChange])

  useEffect(() => {
    runCheck()
  }, [runCheck])

  function handleOverride(category: ClearanceCategory) {
    if (!overrideReason.trim()) return
    if (!clearance) return
    setOverrideError(null)

    // BUG-DC03 fix: applyOverride now returns { applied, reason?, clearance }
    // so we can detect and surface non-overridable categories instead of
    // silently no-op'ing.
    const result = applyOverride(clearance, category, overrideReason.trim(), currentUser)

    if (!result.applied) {
      if (result.reason === 'category_not_overridable') {
        setOverrideError(
          `The "${category}" check cannot be overridden. ` +
          `It must be cleared by completing the corresponding workflow ` +
          `(e.g., for "doctor" — finalise the discharge summary).`,
        )
      } else if (result.reason === 'category_not_found') {
        setOverrideError(
          `No "${category}" item exists on this clearance. Please refresh and retry.`,
        )
      } else {
        setOverrideError('Override could not be applied.')
      }
      return
    }

    setClearance(result.clearance)
    onClearanceChange(result.clearance.canDischarge)
    setOverrideTarget(null)
    setOverrideReason('')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 text-blue-500 animate-spin mr-2" />
        <span className="text-sm text-gray-500">Checking discharge clearance...</span>
      </div>
    )
  }

  if (!clearance) {
    return (
      <div className="text-center py-4 text-red-500 text-sm">
        Failed to load clearance status
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-gray-800">Discharge Clearance</h3>
          {clearance.canDischarge ? (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              All Clear
            </span>
          ) : (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              {clearance.blockedCount} pending
            </span>
          )}
        </div>
        <button
          onClick={runCheck}
          className="text-xs text-gray-400 hover:text-blue-500 flex items-center gap-1"
          title="Re-check clearance"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {/* Clearance Items */}
      <div className="space-y-2">
        {clearance.items.map((item: ClearanceItem) => {
          const display = getClearanceStatusDisplay(item.status)
          const Icon = CATEGORY_ICONS[item.category] || CheckCircle
          const isBlocking = item.isRequired && (item.status === 'blocked' || item.status === 'pending')

          return (
            <div
              key={item.category}
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${display.bgColor}`}
            >
              {/* Status Icon */}
              <div className="flex-shrink-0 mt-0.5">
                {item.status === 'cleared' && <CheckCircle className="w-4 h-4 text-green-500" />}
                {item.status === 'blocked' && <XCircle className="w-4 h-4 text-red-500" />}
                {item.status === 'pending' && <Clock className="w-4 h-4 text-amber-500" />}
                {item.status === 'not_applicable' && <div className="w-4 h-4 rounded-full bg-gray-300" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className={`w-3.5 h-3.5 ${display.color}`} />
                  <span className={`text-sm font-semibold ${display.color}`}>{item.label}</span>
                  {item.isRequired && item.status !== 'cleared' && (
                    <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold">
                      REQUIRED
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>

                {/* Override button for admins */}
                {isBlocking && item.canOverride && isAdmin && (
                  <div className="mt-2">
                    {overrideTarget === item.category ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
                          placeholder="Override reason..."
                          value={overrideReason}
                          onChange={e => setOverrideReason(e.target.value)}
                          autoFocus
                        />
                        <button
                          onClick={() => handleOverride(item.category)}
                          disabled={!overrideReason.trim()}
                          className="text-xs bg-amber-500 text-white px-2 py-1 rounded font-medium disabled:opacity-50"
                        >
                          Override
                        </button>
                        <button
                          onClick={() => { setOverrideTarget(null); setOverrideReason(''); setOverrideError(null) }}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : item.canOverride ? (
                      // BUG-DC03: only show the Override button when the item
                      // can actually be overridden.  Items with canOverride=false
                      // (e.g., 'doctor') previously showed the button but the
                      // click silently did nothing.
                      <button
                        onClick={() => setOverrideTarget(item.category)}
                        className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1 font-medium"
                      >
                        <Lock className="w-3 h-3" /> Admin Override
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400 flex items-center gap-1 italic">
                        <Lock className="w-3 h-3" /> Cannot be overridden — complete the workflow
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Checked by indicator */}
              {item.checkedBy && item.status === 'cleared' && (
                <div className="text-[10px] text-gray-400 flex-shrink-0">
                  {item.checkedBy}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Overrides applied */}
      {clearance.overrides.length > 0 && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 mb-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Admin Overrides Applied ({clearance.overrides.length})
          </div>
          {clearance.overrides.map((
            ov: { category: ClearanceCategory; reason: string; overriddenBy: string }, 
            i: number
          ) => (
            <div key={i} className="text-xs text-amber-600 ml-5">
              {ov.category}: {ov.reason} — by {ov.overriddenBy}
            </div>
          ))}
        </div>
      )}

      {/* Override error message — BUG-DC03 surface failure to operator */}
      {overrideError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-red-700 flex-1">{overrideError}</div>
          <button
            onClick={() => setOverrideError(null)}
            className="text-red-400 hover:text-red-600 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Summary */}
      {!clearance.canDischarge && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-red-700">
            <strong>Cannot discharge yet.</strong> {clearance.blockedCount} required clearance(s) pending.
            {isAdmin && ' Use admin override if necessary.'}
          </div>
        </div>
      )}
    </div>
  )
}