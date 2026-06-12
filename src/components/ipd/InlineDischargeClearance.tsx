'use client'
/**
 * src/components/ipd/InlineDischargeClearance.tsx
 *
 * Self-contained discharge clearance checker.
 * Replaces the existing DischargeClearance in the discharge workflow page
 * to fix the infinite API call loop.
 *
 * Checks: Billing, Lab, Pharmacy, Nursing, Consent, Doctor, Insurance
 * Reports clearance status via a ref-stable callback.
 *
 * NEW FILE — does not modify the existing DischargeClearance.tsx
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  CheckCircle, XCircle, Loader2, AlertCircle,
  IndianRupee, TestTube, Pill, Heart, Shield,
  Stethoscope, Building2, RefreshCw,
} from 'lucide-react'

interface ClearanceItem {
  id: string
  label: string
  icon: any
  status: 'pass' | 'fail' | 'warn' | 'loading'
  message: string
  canOverride: boolean
  overridden: boolean
}

interface Props {
  admissionId: string
  patientId: string
  onClearanceResult?: (canDischarge: boolean) => void
  isAdmin?: boolean
  currentUser?: string
}

export default function InlineDischargeClearance({
  admissionId, patientId, onClearanceResult, isAdmin, currentUser
}: Props) {
  const [items, setItems] = useState<ClearanceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const callbackRef = useRef(onClearanceResult)
  callbackRef.current = onClearanceResult

  // Run checks only once on mount + when admissionId changes
  const runChecks = useCallback(async () => {
    setLoading(true)
    setError('')

    const results: ClearanceItem[] = [
      { id: 'billing', label: 'Billing Cleared', icon: IndianRupee, status: 'loading', message: 'Checking...', canOverride: true, overridden: false },
      { id: 'lab', label: 'Lab Reports Complete', icon: TestTube, status: 'loading', message: 'Checking...', canOverride: true, overridden: false },
      { id: 'pharmacy', label: 'Pharmacy Cleared', icon: Pill, status: 'loading', message: 'Checking...', canOverride: true, overridden: false },
      { id: 'nursing', label: 'Nursing Sign-off', icon: Heart, status: 'loading', message: 'Checking...', canOverride: true, overridden: false },
      { id: 'consent', label: 'Consent Forms Signed', icon: Shield, status: 'loading', message: 'Checking...', canOverride: true, overridden: false },
      { id: 'doctor', label: 'Doctor Clearance', icon: Stethoscope, status: 'loading', message: 'Checking...', canOverride: false, overridden: false },
      { id: 'insurance', label: 'Insurance / TPA', icon: Building2, status: 'loading', message: 'Checking...', canOverride: true, overridden: false },
    ]

    setItems([...results])

    try {
      // 1. Billing check
      const { data: bills } = await supabase
        .from('bills')
        .select('id, total, paid, balance, status')
        .eq('patient_id', patientId)
        .gt('balance', 0)
        .limit(5)

      const unpaidCount = bills?.length || 0
      const totalBalance = bills?.reduce((s: number, b: any) => s + (b.balance || 0), 0) || 0

      if (unpaidCount === 0) {
        results[0] = { ...results[0], status: 'pass', message: 'All bills settled' }
      } else {
        results[0] = { ...results[0], status: 'fail', message: `${unpaidCount} unsettled bill(s) — Balance: Rs ${totalBalance.toLocaleString('en-IN')}` }
      }
      setItems([...results])

      // 2. Lab check
      const { data: pendingLabs } = await supabase
        .from('lab_orders')
        .select('id, test_name, status')
        .eq('patient_id', patientId)
        .in('status', ['ordered', 'collected', 'processing'])
        .limit(10)

      const pendingCount = pendingLabs?.length || 0
      if (pendingCount === 0) {
        results[1] = { ...results[1], status: 'pass', message: 'All lab reports received' }
      } else {
        const names = pendingLabs?.slice(0, 3).map((l: any) => l.test_name).join(', ') || ''
        results[1] = { ...results[1], status: 'warn', message: `${pendingCount} pending: ${names}` }
      }
      setItems([...results])

      // 3. Pharmacy — check if prescriptions exist (simple check)
      const { count: rxCount } = await supabase
        .from('prescriptions')
        .select('id', { count: 'exact', head: true })
        .eq('patient_id', patientId)

      if ((rxCount || 0) > 0) {
        results[2] = { ...results[2], status: 'pass', message: 'Prescriptions on file' }
      } else {
        results[2] = { ...results[2], status: 'warn', message: 'No prescriptions found — ensure discharge medications are prescribed' }
      }
      setItems([...results])

      // 4. Nursing — check recent vitals
      const { data: recentVitals } = await supabase
        .from('ipd_nursing')
        .select('id, recorded_at')
        .eq('ipd_admission_id', admissionId)
        .order('recorded_at', { ascending: false })
        .limit(1)

      if (recentVitals && recentVitals.length > 0) {
        const lastVital = recentVitals[0]
        const hoursAgo = lastVital.recorded_at
          ? Math.round((Date.now() - new Date(lastVital.recorded_at).getTime()) / 3600000)
          : 999

        if (hoursAgo <= 12) {
          results[3] = { ...results[3], status: 'pass', message: `Last vitals ${hoursAgo}h ago` }
        } else {
          results[3] = { ...results[3], status: 'warn', message: `Last vitals ${hoursAgo}h ago — record fresh vitals before discharge` }
        }
      } else {
        results[3] = { ...results[3], status: 'warn', message: 'No nursing records found for this admission' }
      }
      setItems([...results])

      // 5. Consent check
      try {
        const { count: consentCount } = await supabase
          .from('consent_records')
          .select('id', { count: 'exact', head: true })
          .eq('ipd_admission_id', admissionId)
          .eq('status', 'signed')

        if ((consentCount || 0) > 0) {
          results[4] = { ...results[4], status: 'pass', message: `${consentCount} consent(s) signed` }
        } else {
          results[4] = { ...results[4], status: 'warn', message: 'No signed consents found' }
        }
      } catch {
        // consent_records table might not exist
        results[4] = { ...results[4], status: 'pass', message: 'Consent check skipped (table not set up)' }
      }
      setItems([...results])

      // 6. Doctor clearance — check for discharge summary
      const { data: ds } = await supabase
        .from('discharge_summaries')
        .select('id, is_final, final_diagnosis, signed_by')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(1)

      if (ds && ds.length > 0 && ds[0].final_diagnosis) {
        results[5] = { ...results[5], status: 'pass', message: `Signed by ${ds[0].signed_by || 'Doctor'}` }
      } else {
        results[5] = { ...results[5], status: 'fail', message: 'Discharge summary not saved — save it in Tab 3 first' }
      }
      setItems([...results])

      // 7. Insurance — check admission for insurance info
      const { data: adm } = await supabase
        .from('ipd_admissions')
        .select('insurance_details')
        .eq('id', admissionId)
        .single()

      if (adm?.insurance_details) {
        results[6] = { ...results[6], status: 'warn', message: `Insurance: ${adm.insurance_details} — verify claim status` }
      } else {
        results[6] = { ...results[6], status: 'pass', message: 'No insurance — self-pay patient' }
      }
      setItems([...results])

    } catch (err: any) {
      setError(err.message || 'Failed to check clearance')
    }

    setLoading(false)

    // Report overall result via ref-stable callback
    const allPassed = results.every(r => r.status === 'pass' || r.status === 'warn' || r.overridden)
    if (callbackRef.current) {
      callbackRef.current(allPassed)
    }
  }, [admissionId, patientId])

  useEffect(() => {
    runChecks()
  }, [runChecks])

  // Override a failed item
  function overrideItem(id: string) {
    setItems(prev => {
      const updated = prev.map(item =>
        item.id === id ? { ...item, overridden: true, status: 'pass' as const, message: item.message + ' (Admin override)' } : item
      )
      const allPassed = updated.every(r => r.status === 'pass' || r.status === 'warn' || r.overridden)
      if (callbackRef.current) callbackRef.current(allPassed)
      return updated
    })
  }

  const passCount = items.filter(i => i.status === 'pass').length
  const failCount = items.filter(i => i.status === 'fail').length
  const warnCount = items.filter(i => i.status === 'warn').length

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-xs">
          <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> {passCount} Cleared
          </span>
          {warnCount > 0 && (
            <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {warnCount} Warning
            </span>
          )}
          {failCount > 0 && (
            <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full flex items-center gap-1">
              <XCircle className="w-3 h-3" /> {failCount} Blocking
            </span>
          )}
        </div>
        <button onClick={runChecks} disabled={loading}
          className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Re-check
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Checklist items */}
      <div className="space-y-2">
        {items.map(item => {
          const Icon = item.icon
          const statusIcon = item.status === 'pass' ? CheckCircle
            : item.status === 'fail' ? XCircle
            : item.status === 'warn' ? AlertCircle
            : Loader2

          const statusColor = item.status === 'pass' ? 'text-green-600'
            : item.status === 'fail' ? 'text-red-600'
            : item.status === 'warn' ? 'text-yellow-600'
            : 'text-gray-400'

          const bgColor = item.status === 'pass' ? 'bg-green-50 border-green-200'
            : item.status === 'fail' ? 'bg-red-50 border-red-200'
            : item.status === 'warn' ? 'bg-yellow-50 border-yellow-200'
            : 'bg-gray-50 border-gray-200'

          const StatusIcon = statusIcon

          return (
            <div key={item.id} className={`flex items-center justify-between p-3 rounded-lg border ${bgColor}`}>
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${statusColor}`} />
                <div>
                  <span className="text-sm font-medium text-gray-800">{item.label}</span>
                  <p className="text-xs text-gray-500 mt-0.5">{item.message}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon className={`w-5 h-5 ${statusColor} ${item.status === 'loading' ? 'animate-spin' : ''}`} />
                {item.status === 'fail' && item.canOverride && isAdmin && (
                  <button onClick={() => overrideItem(item.id)}
                    className="text-[10px] text-red-500 hover:text-red-700 border border-red-300 rounded px-2 py-0.5 hover:bg-red-50">
                    Override
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}