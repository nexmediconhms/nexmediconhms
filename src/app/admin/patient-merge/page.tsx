'use client'
/**
 * src/app/admin/patient-merge/page.tsx
 *
 * Patient Merge / Deduplication Tool (Admin only)
 *
 * Real-life scenarios in Indian clinics:
 *  - Same patient registered twice with slight name variations (Priya vs Priya Sharma)
 *  - Same mobile number but different MRNs (receptionist created new instead of searching)
 *  - Husband's name used first time, own name second time
 *  - Patient visited before Aadhaar linking, re-registered after
 *
 * Merge logic:
 *  - Select PRIMARY record (keeps MRN, all data)
 *  - Select DUPLICATE record (will be deactivated)
 *  - All encounters, prescriptions, lab_reports, bills, appointments, ipd_admissions
 *    from DUPLICATE are re-pointed to PRIMARY patient_id
 *  - DUPLICATE record is soft-deleted (is_active = false, merged_into = primary_id)
 *  - Full audit trail of what was merged
 */

import { useCallback, useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { escapeLike, formatDate } from '@/lib/utils'
import {
  Users, Search, ArrowRight, AlertTriangle, CheckCircle,
  Loader2, X, Merge, Shield, RefreshCw,
} from 'lucide-react'

interface PatientRow {
  id: string
  mrn: string
  full_name: string
  age: number | string
  gender: string
  mobile: string
  date_of_birth: string | null
  blood_group: string | null
  abha_id: string | null
  aadhaar: string | null
  created_at: string
  is_active: boolean
}

interface MergePreview {
  encounters: number
  prescriptions: number
  lab_reports: number
  bills: number
  appointments: number
  ipd_admissions: number
  discharge_summaries: number
}

export default function PatientMergePage() {
  const { user, isAdmin } = useAuth()
  const [searchA, setSearchA] = useState('')
  const [searchB, setSearchB] = useState('')
  const [resultsA, setResultsA] = useState<PatientRow[]>([])
  const [resultsB, setResultsB] = useState<PatientRow[]>([])
  const [primary, setPrimary] = useState<PatientRow | null>(null)
  const [duplicate, setDuplicate] = useState<PatientRow | null>(null)
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [merging, setMerging] = useState(false)
  const [merged, setMerged] = useState(false)
  const [error, setError] = useState('')

  // Auto-detect duplicates
  const [autoResults, setAutoResults] = useState<{ a: PatientRow; b: PatientRow; reason: string }[]>([])
  const [autoLoading, setAutoLoading] = useState(false)

  async function searchPatients(q: string, setter: (r: PatientRow[]) => void) {
    if (q.trim().length < 2) { setter([]); return }
    const safe = escapeLike(q)
    const { data } = await supabase
      .from('patients')
      .select('id, mrn, full_name, age, gender, mobile, date_of_birth, blood_group, abha_id, aadhaar, created_at, is_active')
      .or(`full_name.ilike.%${safe}%,mrn.ilike.%${safe}%,mobile.ilike.%${safe}%`)
      .order('created_at', { ascending: false })
      .limit(10)
    setter((data || []) as PatientRow[])
  }

  // Generate merge preview — count records that will be moved
  async function generatePreview() {
    if (!primary || !duplicate) return
    setPreviewLoading(true)
    setError('')

    const dupId = duplicate.id
    const [enc, rx, lab, bill, appt, ipd, ds] = await Promise.all([
      supabase.from('encounters').select('id', { count: 'exact', head: true }).eq('patient_id', dupId),
      supabase.from('prescriptions').select('id', { count: 'exact', head: true }).eq('patient_id', dupId),
      supabase.from('lab_reports').select('id', { count: 'exact', head: true }).eq('patient_id', dupId),
      supabase.from('bills').select('id', { count: 'exact', head: true }).eq('patient_id', dupId),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', dupId),
      supabase.from('ipd_admissions').select('id', { count: 'exact', head: true }).eq('patient_id', dupId),
      supabase.from('discharge_summaries').select('id', { count: 'exact', head: true }).eq('patient_id', dupId),
    ])

    setPreview({
      encounters: enc.count || 0,
      prescriptions: rx.count || 0,
      lab_reports: lab.count || 0,
      bills: bill.count || 0,
      appointments: appt.count || 0,
      ipd_admissions: ipd.count || 0,
      discharge_summaries: ds.count || 0,
    })
    setPreviewLoading(false)
  }

  useEffect(() => {
    if (primary && duplicate) generatePreview()
  }, [primary?.id, duplicate?.id])

  // Execute merge
  async function executeMerge() {
    if (!primary || !duplicate || !preview) return
    if (!confirm(
      `CONFIRM MERGE:\n\n` +
      `PRIMARY (keeps): ${primary.full_name} (${primary.mrn})\n` +
      `DUPLICATE (deactivates): ${duplicate.full_name} (${duplicate.mrn})\n\n` +
      `${Object.values(preview).reduce((s, n) => s + n, 0)} records will be moved.\n\n` +
      `This action cannot be easily undone. Proceed?`
    )) return

    setMerging(true)
    setError('')

    const dupId = duplicate.id
    const priId = primary.id
    const now = new Date().toISOString()

    try {
      // Move all records from duplicate to primary
      const updates = [
        supabase.from('encounters').update({ patient_id: priId }).eq('patient_id', dupId),
        supabase.from('prescriptions').update({ patient_id: priId }).eq('patient_id', dupId),
        supabase.from('lab_reports').update({ patient_id: priId }).eq('patient_id', dupId),
        supabase.from('bills').update({ patient_id: priId, patient_name: primary.full_name, mrn: primary.mrn }).eq('patient_id', dupId),
        supabase.from('appointments').update({ patient_id: priId, patient_name: primary.full_name, mrn: primary.mrn, mobile: primary.mobile }).eq('patient_id', dupId),
        supabase.from('ipd_admissions').update({ patient_id: priId, patient_name: primary.full_name, mrn: primary.mrn, mobile: primary.mobile }).eq('patient_id', dupId),
        supabase.from('discharge_summaries').update({ patient_id: priId }).eq('patient_id', dupId),
        supabase.from('ipd_nursing').update({ patient_id: priId }).eq('patient_id', dupId),
        supabase.from('ipd_charges').update({ patient_id: priId }).eq('patient_id', dupId),
      ]

      const results = await Promise.all(updates)
      const anyError = results.find(r => r.error)
      if (anyError?.error) throw new Error(anyError.error.message)

      // Deactivate duplicate patient
      await supabase.from('patients').update({
        is_active: false,
        notes: `[MERGED] Merged into ${primary.mrn} (${primary.full_name}) on ${now}. Original MRN: ${duplicate.mrn}`,
        updated_at: now,
      }).eq('id', dupId)

      // Audit log
      await supabase.from('audit_log').insert({
        action: 'patient_merge',
        entity_type: 'patient',
        entity_id: priId,
        entity_label: `Merged ${duplicate.full_name} (${duplicate.mrn}) → ${primary.full_name} (${primary.mrn})`,
        changes: JSON.stringify({
          primary_id: priId,
          primary_mrn: primary.mrn,
          primary_name: primary.full_name,
          duplicate_id: dupId,
          duplicate_mrn: duplicate.mrn,
          duplicate_name: duplicate.full_name,
          records_moved: preview,
          merged_at: now,
          merged_by: user?.full_name || user?.email || 'admin',
        }),
        user_email: user?.email || 'admin',
        user_role: 'admin',
      })

      setMerged(true)
    } catch (err: any) {
      setError(`Merge failed: ${err.message}`)
    }
    setMerging(false)
  }

  // Auto-detect potential duplicates (same mobile number)
  async function detectDuplicates() {
    setAutoLoading(true)
    setAutoResults([])

    // Find patients with same mobile number (most common duplicate in Indian clinics)
    const { data } = await supabase
      .from('patients')
      .select('id, mrn, full_name, age, gender, mobile, date_of_birth, blood_group, abha_id, aadhaar, created_at, is_active')
      .eq('is_active', true)
      .not('mobile', 'is', null)
      .neq('mobile', '')
      .order('mobile')
      .limit(500)

    if (!data) { setAutoLoading(false); return }

    const mobileMap = new Map<string, PatientRow[]>()
    for (const p of data as PatientRow[]) {
      const mobile = p.mobile?.replace(/\D/g, '').slice(-10) // Normalize to last 10 digits
      if (mobile && mobile.length === 10) {
        const existing = mobileMap.get(mobile) || []
        existing.push(p)
        mobileMap.set(mobile, existing)
      }
    }

    const dupes: { a: PatientRow; b: PatientRow; reason: string }[] = []
    for (const [mobile, patients] of mobileMap) {
      if (patients.length >= 2) {
        for (let i = 0; i < patients.length - 1; i++) {
          dupes.push({
            a: patients[i],
            b: patients[i + 1],
            reason: `Same mobile: ${mobile}`,
          })
        }
      }
    }

    setAutoResults(dupes.slice(0, 20))
    setAutoLoading(false)
  }

  function reset() {
    setPrimary(null); setDuplicate(null); setPreview(null)
    setMerged(false); setError(''); setSearchA(''); setSearchB('')
    setResultsA([]); setResultsB([])
  }

  // Access control
  if (!isAdmin) {
    return (
      <AppShell>
        <div className="p-6 text-center py-20">
          <Shield className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-gray-900">Admin Access Required</h2>
          <p className="text-sm text-gray-500 mt-1">Only administrators can merge patient records.</p>
        </div>
      </AppShell>
    )
  }

  // Success view
  if (merged) {
    return (
      <AppShell>
        <div className="p-6 max-w-2xl mx-auto text-center py-16">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Merge Complete!</h2>
          <p className="text-gray-600 mb-2">
            <strong>{duplicate?.full_name}</strong> ({duplicate?.mrn}) has been merged into{' '}
            <strong>{primary?.full_name}</strong> ({primary?.mrn}).
          </p>
          <p className="text-sm text-gray-500 mb-6">
            {preview && `${Object.values(preview).reduce((s, n) => s + n, 0)} records moved. Duplicate record deactivated.`}
          </p>
          <button onClick={reset} className="btn-primary">Merge Another</button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Merge className="w-6 h-6 text-purple-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Patient Merge / Deduplication</h1>
            <p className="text-sm text-gray-500">Find and merge duplicate patient records safely</p>
          </div>
          <button onClick={detectDuplicates} disabled={autoLoading}
            className="ml-auto btn-secondary flex items-center gap-2 text-xs">
            {autoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Auto-Detect Duplicates
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {/* Auto-detected duplicates */}
        {autoResults.length > 0 && (
          <div className="card p-4 mb-6 border-l-4 border-orange-400">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              Potential Duplicates Found ({autoResults.length})
            </h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {autoResults.map((d, i) => (
                <div key={i} className="flex items-center gap-3 bg-orange-50 border border-orange-100 rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900">
                      {d.a.full_name} ({d.a.mrn}) <span className="text-gray-400 mx-1">↔</span> {d.b.full_name} ({d.b.mrn})
                    </div>
                    <div className="text-xs text-orange-600">{d.reason}</div>
                  </div>
                  <button onClick={() => { setPrimary(d.a); setDuplicate(d.b); setAutoResults([]) }}
                    className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 flex-shrink-0">
                    Select & Merge
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Manual search */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Primary (Keep) */}
          <div className="card p-5 border-l-4 border-green-400">
            <h3 className="font-bold text-green-800 mb-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> PRIMARY — Keep This Record
            </h3>
            {primary ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-gray-900">{primary.full_name}</div>
                    <div className="text-xs text-gray-600 mt-1">
                      MRN: {primary.mrn} · {primary.age}y · {primary.gender} · {primary.mobile}
                    </div>
                    {primary.abha_id && <div className="text-xs text-blue-600 mt-0.5">ABHA: {primary.abha_id}</div>}
                    <div className="text-xs text-gray-400 mt-0.5">Registered: {formatDate(primary.created_at)}</div>
                  </div>
                  <button onClick={() => setPrimary(null)} className="text-gray-400 hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input className="input pl-9" placeholder="Search by name, MRN, mobile..."
                    value={searchA} onChange={e => { setSearchA(e.target.value); searchPatients(e.target.value, setResultsA) }} />
                </div>
                {resultsA.length > 0 && (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {resultsA.map(p => (
                      <button key={p.id} onClick={() => { setPrimary(p); setResultsA([]) }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-green-50 border border-transparent hover:border-green-200 text-sm">
                        <span className="font-medium">{p.full_name}</span>
                        <span className="text-gray-400 ml-2">{p.mrn} · {p.mobile}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Duplicate (Remove) */}
          <div className="card p-5 border-l-4 border-red-400">
            <h3 className="font-bold text-red-800 mb-3 flex items-center gap-2">
              <X className="w-4 h-4" /> DUPLICATE — Deactivate This Record
            </h3>
            {duplicate ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-gray-900">{duplicate.full_name}</div>
                    <div className="text-xs text-gray-600 mt-1">
                      MRN: {duplicate.mrn} · {duplicate.age}y · {duplicate.gender} · {duplicate.mobile}
                    </div>
                    {duplicate.abha_id && <div className="text-xs text-blue-600 mt-0.5">ABHA: {duplicate.abha_id}</div>}
                    <div className="text-xs text-gray-400 mt-0.5">Registered: {formatDate(duplicate.created_at)}</div>
                  </div>
                  <button onClick={() => setDuplicate(null)} className="text-gray-400 hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input className="input pl-9" placeholder="Search duplicate to merge..."
                    value={searchB} onChange={e => { setSearchB(e.target.value); searchPatients(e.target.value, setResultsB) }} />
                </div>
                {resultsB.length > 0 && (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {resultsB.filter(p => p.id !== primary?.id).map(p => (
                      <button key={p.id} onClick={() => { setDuplicate(p); setResultsB([]) }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-red-50 border border-transparent hover:border-red-200 text-sm">
                        <span className="font-medium">{p.full_name}</span>
                        <span className="text-gray-400 ml-2">{p.mrn} · {p.mobile}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Merge Preview */}
        {primary && duplicate && (
          <div className="card p-5 mb-6">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Merge className="w-4 h-4 text-purple-600" /> Merge Preview
            </h3>

            {primary.id === duplicate.id && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                Cannot merge a patient with itself. Select two different patients.
              </div>
            )}

            {primary.id !== duplicate.id && (
              <>
                <div className="flex items-center gap-4 mb-4 bg-gray-50 rounded-xl p-4">
                  <div className="flex-1 text-center">
                    <div className="text-sm font-bold text-green-700">{primary.full_name}</div>
                    <div className="text-xs text-gray-500">{primary.mrn}</div>
                    <div className="text-xs text-green-600 font-semibold mt-1">KEEPS ALL DATA</div>
                  </div>
                  <ArrowRight className="w-6 h-6 text-purple-500 flex-shrink-0" />
                  <div className="flex-1 text-center">
                    <div className="text-sm font-bold text-red-700 line-through">{duplicate.full_name}</div>
                    <div className="text-xs text-gray-500">{duplicate.mrn}</div>
                    <div className="text-xs text-red-600 font-semibold mt-1">DEACTIVATED</div>
                  </div>
                </div>

                {previewLoading ? (
                  <div className="text-center py-6"><Loader2 className="w-6 h-6 animate-spin mx-auto text-purple-500" /></div>
                ) : preview && (
                  <>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
                      {[
                        { label: 'Encounters', count: preview.encounters },
                        { label: 'Prescriptions', count: preview.prescriptions },
                        { label: 'Lab Reports', count: preview.lab_reports },
                        { label: 'Bills', count: preview.bills },
                        { label: 'Appointments', count: preview.appointments },
                        { label: 'IPD Admissions', count: preview.ipd_admissions },
                        { label: 'Discharge Summaries', count: preview.discharge_summaries },
                      ].map(item => (
                        <div key={item.label} className="bg-purple-50 border border-purple-100 rounded-lg p-3 text-center">
                          <div className="text-xl font-bold text-purple-700">{item.count}</div>
                          <div className="text-xs text-purple-600">{item.label}</div>
                        </div>
                      ))}
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                      <p className="text-xs text-amber-800 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>
                          <strong>Warning:</strong> {Object.values(preview).reduce((s, n) => s + n, 0)} records from{' '}
                          {duplicate.full_name} ({duplicate.mrn}) will be moved to {primary.full_name} ({primary.mrn}).
                          The duplicate record will be deactivated (soft-delete). This action is logged but difficult to reverse.
                        </span>
                      </p>
                    </div>

                    <div className="flex gap-3">
                      <button onClick={executeMerge} disabled={merging}
                        className="flex items-center gap-2 bg-purple-700 hover:bg-purple-800 text-white font-bold px-6 py-3 rounded-xl disabled:opacity-50">
                        {merging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Merge className="w-4 h-4" />}
                        {merging ? 'Merging...' : 'Execute Merge'}
                      </button>
                      <button onClick={reset} className="btn-secondary">Cancel</button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Instructions */}
        {!primary && !duplicate && autoResults.length === 0 && (
          <div className="card p-6 text-center bg-gray-50 border-dashed border-2 border-gray-200">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <h3 className="font-medium text-gray-700">How to Merge Patients</h3>
            <ol className="text-sm text-gray-500 mt-3 text-left max-w-md mx-auto space-y-2">
              <li><strong>1.</strong> Click &quot;Auto-Detect Duplicates&quot; to find patients with same mobile number</li>
              <li><strong>2.</strong> Or manually search for the PRIMARY record (the one you want to keep)</li>
              <li><strong>3.</strong> Then search for the DUPLICATE record (the one to deactivate)</li>
              <li><strong>4.</strong> Review the preview — all encounters, bills, labs etc. from duplicate will move to primary</li>
              <li><strong>5.</strong> Click &quot;Execute Merge&quot; — duplicate is deactivated, not deleted</li>
            </ol>
            <p className="text-xs text-gray-400 mt-4">Tip: Always keep the record with the most history as PRIMARY.</p>
          </div>
        )}
      </div>
    </AppShell>
  )
}
