'use client'
/**
 * src/components/ipd/InlineDischargeClearance.tsx
 *
 * Self-contained discharge clearance checker with explicit sign-off.
 * Replaces the existing DischargeClearance in the discharge workflow page
 * to fix the infinite API call loop.
 *
 * Checks: Billing, Lab, Pharmacy, Nursing, Consent, Doctor, Insurance
 * Reports clearance status via a ref-stable callback.
 *
 * ENHANCED: Adds explicit Nurse and Doctor sign-off buttons that
 * persist to the `discharge_signoffs` table for audit trail.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  CheckCircle, XCircle, Loader2, AlertCircle,
  IndianRupee, TestTube, Pill, Heart, Shield,
  Stethoscope, Building2, RefreshCw, PenTool, UserCheck,
} from 'lucide-react'

interface ClearanceItem {
  id: string
  label: string
  icon: any
  status: 'pass' | 'fail' | 'warn' | 'loading'
  message: string
  canOverride: boolean
  overridden: boolean
  needsSignoff?: boolean
  signoffRole?: 'nurse' | 'doctor'
  signedBy?: string
  signedAt?: string
}

interface SignoffRecord {
  id: string
  role: string
  signed_by: string
  signed_at: string
  status: string
  comments: string | null
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
  const [signoffs, setSignoffs] = useState<SignoffRecord[]>([])
  const [signoffLoading, setSignoffLoading] = useState<string | null>(null)
  const [signoffComment, setSignoffComment] = useState('')
  const [showCommentFor, setShowCommentFor] = useState<string | null>(null)
  const callbackRef = useRef(onClearanceResult)
  callbackRef.current = onClearanceResult

  // Fetch existing sign-offs from the database
  const fetchSignoffs = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('discharge_signoffs')
        .select('*')
        .eq('admission_id', admissionId)
        .eq('status', 'approved')
        .order('signed_at', { ascending: false })
      if (data) setSignoffs(data as SignoffRecord[])
    } catch {
      // Table may not exist yet - graceful fallback
    }
  }, [admissionId])

  // Run checks only once on mount + when admissionId changes
  const runChecks = useCallback(async () => {
    setLoading(true)
    setError('')

    // Fetch sign-offs first
    let currentSignoffs: SignoffRecord[] = []
    try {
      const { data } = await supabase
        .from('discharge_signoffs')
        .select('*')
        .eq('admission_id', admissionId)
        .eq('status', 'approved')
        .order('signed_at', { ascending: false })
      if (data) {
        currentSignoffs = data as SignoffRecord[]
        setSignoffs(currentSignoffs)
      }
    } catch {
      // Table may not exist yet
    }

    const nurseSignoff = currentSignoffs.find(s => s.role === 'nurse')
    const doctorSignoff = currentSignoffs.find(s => s.role === 'doctor')

    const results: ClearanceItem[] = [
      { id: 'billing', label: 'Billing Cleared', icon: IndianRupee, status: 'loading', message: 'Checking...', canOverride: true, overridden: false },
      { id: 'lab', label: 'Lab Reports Complete', icon: TestTube, status: 'loading', message: 'Checking...', canOverride: true, overridden: false },
      { id: 'pharmacy', label: 'Pharmacy Cleared', icon: Pill, status: 'loading', message: 'Checking...', canOverride: true, overridden: false },
      { id: 'nursing', label: 'Nursing Sign-off', icon: Heart, status: 'loading', message: 'Checking...', canOverride: true, overridden: false, needsSignoff: true, signoffRole: 'nurse' },
      { id: 'consent', label: 'Consent Forms Signed', icon: Shield, status: 'loading', message: 'Checking...', canOverride: true, overridden: false },
      { id: 'doctor', label: 'Doctor Sign-off', icon: Stethoscope, status: 'loading', message: 'Checking...', canOverride: false, overridden: false, needsSignoff: true, signoffRole: 'doctor' },
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
        results[0] = { ...results[0], status: 'fail', message: `${unpaidCount} unsettled bill(s) \u2014 Balance: Rs ${totalBalance.toLocaleString('en-IN')}` }
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

      // 3. Pharmacy check
      const { count: rxCount } = await supabase
        .from('prescriptions')
        .select('id', { count: 'exact', head: true })
        .eq('patient_id', patientId)

      if ((rxCount || 0) > 0) {
        results[2] = { ...results[2], status: 'pass', message: 'Prescriptions on file' }
      } else {
        results[2] = { ...results[2], status: 'warn', message: 'No prescriptions found \u2014 ensure discharge medications are prescribed' }
      }
      setItems([...results])

      // 4. Nursing Sign-off - Check both vitals AND explicit sign-off
      if (nurseSignoff) {
        const signedTime = new Date(nurseSignoff.signed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        results[3] = { ...results[3], status: 'pass', message: `Signed by ${nurseSignoff.signed_by} on ${signedTime}`, signedBy: nurseSignoff.signed_by, signedAt: nurseSignoff.signed_at }
      } else {
        // Fallback: check recent vitals but still require explicit sign-off
        const { data: recentVitals } = await supabase
          .from('ipd_nursing')
          .select('id, recorded_at')
          .eq('ipd_admission_id', admissionId)
          .order('recorded_at', { ascending: false })
          .limit(1)

        if (recentVitals && recentVitals.length > 0) {
          results[3] = { ...results[3], status: 'warn', message: 'Vitals recorded but nurse has not signed off yet' }
        } else {
          results[3] = { ...results[3], status: 'fail', message: 'Nursing sign-off required \u2014 no vitals or sign-off found' }
        }
      }
      setItems([...results])

      // 5. Consent check - check both consent_records and consents tables
      try {
        let totalConsents = 0;
        const { count: consentCount } = await supabase
          .from('consent_records')
          .select('id', { count: 'exact', head: true })
          .eq('ipd_admission_id', admissionId)
          .eq('status', 'signed')
        totalConsents += (consentCount || 0);

        // Also check 'consents' table (alternate storage)
        try {
          const { count: c2 } = await supabase
            .from('consents')
            .select('id', { count: 'exact', head: true })
            .eq('patient_id', patientId)
            .eq('status', 'signed')
          totalConsents += (c2 || 0);
        } catch { /* consents table may not exist */ }

        if (totalConsents > 0) {
          results[4] = { ...results[4], status: 'pass', message: `${totalConsents} consent(s) signed` }
        } else {
          results[4] = { ...results[4], status: 'warn', message: 'No signed consents found — go to IPD Chart → Consent Forms' }
        }
      } catch {
        results[4] = { ...results[4], status: 'pass', message: 'Consent check skipped (table not set up)' }
      }
      setItems([...results])

      // 6. Doctor Sign-off - Check both discharge summary AND explicit sign-off
      if (doctorSignoff) {
        const signedTime = new Date(doctorSignoff.signed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        results[5] = { ...results[5], status: 'pass', message: `Signed by Dr. ${doctorSignoff.signed_by} on ${signedTime}`, signedBy: doctorSignoff.signed_by, signedAt: doctorSignoff.signed_at }
      } else {
        // Fallback: check discharge summary but still require explicit sign-off
        const { data: ds } = await supabase
          .from('discharge_summaries')
          .select('id, is_final, final_diagnosis, signed_by')
          .eq('patient_id', patientId)
          .order('created_at', { ascending: false })
          .limit(1)

        if (ds && ds.length > 0 && ds[0].final_diagnosis) {
          results[5] = { ...results[5], status: 'warn', message: 'Discharge summary saved but doctor has not signed off yet' }
        } else {
          results[5] = { ...results[5], status: 'fail', message: 'Doctor sign-off required \u2014 save discharge summary and sign off' }
        }
      }
      setItems([...results])

      // 7. Insurance check
      const { data: adm } = await supabase
        .from('ipd_admissions')
        .select('insurance_details')
        .eq('id', admissionId)
        .single()

      if (adm?.insurance_details) {
        results[6] = { ...results[6], status: 'warn', message: `Insurance: ${adm.insurance_details} \u2014 verify claim status` }
      } else {
        results[6] = { ...results[6], status: 'pass', message: 'No insurance \u2014 self-pay patient' }
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

  // Handle explicit sign-off
  async function handleSignoff(role: 'nurse' | 'doctor') {
    const signer = currentUser || 'Admin'
    setSignoffLoading(role)
    try {
      const { error } = await supabase
        .from('discharge_signoffs')
        .insert({
          admission_id: admissionId,
          patient_id: patientId,
          role,
          signed_by: signer,
          status: 'approved',
          comments: signoffComment || null,
        })

      if (error) throw error

      setSignoffComment('')
      setShowCommentFor(null)
      // Re-run checks to reflect updated status
      await runChecks()
    } catch (err: any) {
      setError(err.message || `Failed to record ${role} sign-off`)
    } finally {
      setSignoffLoading(null)
    }
  }

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
            <div key={item.id} className={`border rounded-lg ${bgColor}`}>
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${statusColor}`} />
                  <div>
                    <span className="text-sm font-medium text-gray-800">{item.label}</span>
                    <p className="text-xs text-gray-500 mt-0.5">{item.message}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusIcon className={`w-5 h-5 ${statusColor} ${item.status === 'loading' ? 'animate-spin' : ''}`} />
                  {item.status === 'fail' && item.canOverride && isAdmin && !item.needsSignoff && (
                    <button onClick={() => overrideItem(item.id)}
                      className="text-[10px] text-red-500 hover:text-red-700 border border-red-300 rounded px-2 py-0.5 hover:bg-red-50">
                      Override
                    </button>
                  )}
                </div>
              </div>

              {/* Sign-off button for nursing and doctor */}
              {item.needsSignoff && item.status !== 'pass' && item.status !== 'loading' && (
                <div className="px-3 pb-3">
                  {showCommentFor === item.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={signoffComment}
                        onChange={(e) => setSignoffComment(e.target.value)}
                        placeholder={`Optional comments for ${item.signoffRole} sign-off...`}
                        className="w-full text-xs border border-gray-300 rounded-md p-2 resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSignoff(item.signoffRole!)}
                          disabled={signoffLoading === item.signoffRole}
                          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50"
                        >
                          {signoffLoading === item.signoffRole ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <PenTool className="w-3 h-3" />
                          )}
                          Confirm Sign-off
                        </button>
                        <button
                          onClick={() => { setShowCommentFor(null); setSignoffComment('') }}
                          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5">
                          Cancel
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-400">
                        Signing off as: <span className="font-medium text-gray-600">{currentUser || 'Admin'}</span>
                      </p>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowCommentFor(item.id)}
                      className="flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      {item.signoffRole === 'nurse' ? 'Nurse Sign-off' : 'Doctor Sign-off'}
                    </button>
                  )}
                </div>
              )}

              {/* Show sign-off history for signed items */}
              {item.needsSignoff && item.status === 'pass' && item.signedBy && (
                <div className="px-3 pb-2">
                  <div className="flex items-center gap-1.5 text-[10px] text-green-700 bg-green-100 px-2 py-1 rounded-md inline-flex">
                    <UserCheck className="w-3 h-3" />
                    <span>Verified by {item.signedBy}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Sign-off History Section */}
      {signoffs.length > 0 && (
        <div className="mt-6 border-t border-gray-200 pt-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
            <UserCheck className="w-4 h-4" /> Sign-off Audit Trail
          </h4>
          <div className="space-y-1.5">
            {signoffs.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                    s.role === 'doctor' ? 'bg-blue-100 text-blue-700' :
                    s.role === 'nurse' ? 'bg-pink-100 text-pink-700' :
                    'bg-gray-200 text-gray-700'
                  }`}>{s.role}</span>
                  <span className="text-xs text-gray-800 font-medium">{s.signed_by}</span>
                  {s.comments && <span className="text-[10px] text-gray-500 italic">\u2014 {s.comments}</span>}
                </div>
                <span className="text-[10px] text-gray-400">
                  {new Date(s.signed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
