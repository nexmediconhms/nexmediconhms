'use client'
/**
 * src/app/settings/data-retention/page.tsx
 *
 * Data Retention & Auto-Purge Settings UI
 *
 * Admin-only page to:
 *   1. View and edit retention policies per data type
 *   2. Toggle auto-purge for eligible tables
 *   3. View retention compliance report (expired records count)
 *   4. Trigger manual purge with confirmation
 *   5. View legal minimums (greyed out / non-editable)
 */

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import {
  getRetentionPolicies,
  updateRetentionPolicy,
  generateRetentionReport,
  formatRetentionPeriod,
  executeAutoPurge,
  type RetentionPolicy,
  type RetentionReport,
} from '@/lib/data-retention'
import {
  Shield, Database, Clock, AlertTriangle, CheckCircle,
  Loader2, Trash2, RefreshCw, ArrowLeft, Info, Lock,
} from 'lucide-react'
import Link from 'next/link'

export default function DataRetentionPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [userId, setUserId] = useState('')
  const [policies, setPolicies] = useState<RetentionPolicy[]>([])
  const [report, setReport] = useState<RetentionReport[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [purging, setPurging] = useState(false)
  const [purgeResult, setPurgeResult] = useState<{ purged: { table: string; count: number }[]; errors: { table: string; error: string }[] } | null>(null)
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false)

  // Check admin role
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setIsAdmin(false); return }
      const { data } = await supabase
        .from('clinic_users').select('id, role').eq('auth_id', user.id).single()
      setIsAdmin(data?.role === 'admin')
      if (data?.id) setUserId(data.id)
    })
  }, [])

  useEffect(() => {
    if (isAdmin) loadData()
  }, [isAdmin])

  async function loadData() {
    setLoading(true)
    try {
      const [pols, rep] = await Promise.all([
        getRetentionPolicies(),
        generateRetentionReport(),
      ])
      setPolicies(pols)
      setReport(rep)
    } catch (e: any) {
      setError(e.message || 'Failed to load retention data')
    }
    setLoading(false)
  }

  async function handleUpdatePolicy(entityType: string, retentionDays: number, autoPurge: boolean) {
    setSaving(entityType)
    setError('')
    setSuccess('')
    const result = await updateRetentionPolicy(entityType, retentionDays, autoPurge, userId)
    setSaving(null)
    if (result.success) {
      setSuccess(`Updated ${entityType.replace('_', ' ')} retention policy.`)
      setTimeout(() => setSuccess(''), 3000)
      loadData()
    } else {
      setError(result.error || 'Failed to update policy')
    }
  }

  async function handlePurge() {
    setPurging(true)
    setPurgeResult(null)
    setShowPurgeConfirm(false)
    try {
      const result = await executeAutoPurge()
      setPurgeResult(result)
      loadData()
    } catch (e: any) {
      setError(e.message || 'Purge failed')
    }
    setPurging(false)
  }

  if (isAdmin === null) {
    return <AppShell><div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Checking permissions...</div></AppShell>
  }

  if (isAdmin === false) {
    return (
      <AppShell>
        <div className="max-w-xl mx-auto px-4 py-16 text-center">
          <Shield className="w-12 h-12 mx-auto text-red-400 mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Admin Only</h2>
          <p className="text-gray-500 text-sm">Data retention settings are only accessible to admin accounts.</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/settings" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
            <Database className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Data Retention</h1>
            <p className="text-sm text-gray-500">Manage how long patient data is kept and configure auto-purge.</p>
          </div>
        </div>

        {/* Legal notice */}
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3 text-sm text-amber-800">
          <Lock className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Indian Medical Council & DPDP Act:</span> Patient medical records must be retained for a minimum of 7 years. Financial records for 8 years. These legal minimums cannot be overridden.
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {success && (
          <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 flex-shrink-0" /> {success}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading retention policies...
          </div>
        ) : (
          <>
            {/* Policies Table */}
            <div className="card mb-6 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-purple-600" /> Retention Policies
                </h2>
                <button onClick={loadData} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
              </div>
              <div className="divide-y divide-gray-50">
                {policies.length === 0 ? (
                  <div className="px-5 py-8 text-center text-gray-400 text-sm">
                    <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p>No retention policies configured.</p>
                    <p className="text-xs mt-1">Run the SQL migration to create default policies.</p>
                  </div>
                ) : (
                  policies.map(policy => (
                    <PolicyRow
                      key={policy.id}
                      policy={policy}
                      report={report.find(r => r.entity_type === policy.entity_type)}
                      saving={saving === policy.entity_type}
                      onUpdate={handleUpdatePolicy}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Compliance Report Summary */}
            {report.length > 0 && (
              <div className="card mb-6 p-5">
                <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-green-600" /> Compliance Report
                </h2>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-green-50 border border-green-100 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-green-700">
                      {report.reduce((s, r) => s + r.total_records, 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-green-600">Total Records</div>
                  </div>
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-amber-700">
                      {report.reduce((s, r) => s + r.expired_records, 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-amber-600">Past Retention</div>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-blue-700">
                      {report.filter(r => r.compliant).length}/{report.length}
                    </div>
                    <div className="text-xs text-blue-600">Compliant</div>
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  Records past retention period can be purged if auto-purge is enabled for that table.
                  Patient records, encounters, prescriptions, and lab reports are never auto-purged regardless of settings.
                </p>
              </div>
            )}

            {/* Auto-Purge Section */}
            <div className="card p-5">
              <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-500" /> Manual Purge
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Run auto-purge manually for all eligible tables. Only tables with auto-purge enabled will be affected.
                Critical tables (patients, encounters, prescriptions, lab_reports, bills, audit_log) are never purged.
              </p>

              {purgeResult && (
                <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
                  {purgeResult.purged.length > 0 ? (
                    <div className="space-y-1">
                      <p className="font-semibold text-gray-700">Purge completed:</p>
                      {purgeResult.purged.map(p => (
                        <p key={p.table} className="text-green-700">
                          - {p.table}: {p.count} records removed
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500">No records were eligible for purging.</p>
                  )}
                  {purgeResult.errors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="font-semibold text-red-700">Errors:</p>
                      {purgeResult.errors.map(e => (
                        <p key={e.table} className="text-red-600">- {e.table}: {e.error}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {showPurgeConfirm ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-red-800 mb-3">
                    Are you sure? This will permanently delete expired records from eligible tables.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handlePurge}
                      disabled={purging}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center gap-2"
                    >
                      {purging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      {purging ? 'Purging...' : 'Confirm Purge'}
                    </button>
                    <button
                      onClick={() => setShowPurgeConfirm(false)}
                      className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowPurgeConfirm(true)}
                  className="px-4 py-2 bg-white border border-red-200 text-red-700 text-sm font-semibold rounded-lg hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> Run Manual Purge
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

// ── Policy Row Component ──────────────────────────────────────

function PolicyRow({
  policy,
  report,
  saving,
  onUpdate,
}: {
  policy: RetentionPolicy
  report?: RetentionReport
  saving: boolean
  onUpdate: (entityType: string, retentionDays: number, autoPurge: boolean) => void
}) {
  const [days, setDays] = useState(policy.retention_days)
  const [autoPurge, setAutoPurge] = useState(policy.auto_purge)
  const [edited, setEdited] = useState(false)

  const NEVER_PURGE = ['audit_log', 'patients', 'encounters', 'prescriptions', 'lab_reports', 'bills']
  const isPurgeSafe = !NEVER_PURGE.includes(policy.entity_type)

  function handleDaysChange(val: string) {
    const num = parseInt(val)
    if (!isNaN(num) && num >= 0) {
      setDays(num)
      setEdited(true)
    }
  }

  function handleAutoPurgeChange(val: boolean) {
    setAutoPurge(val)
    setEdited(true)
  }

  function handleSave() {
    onUpdate(policy.entity_type, days, autoPurge)
    setEdited(false)
  }

  return (
    <div className="px-5 py-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-4">
        {/* Table name & description */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900 capitalize">
            {policy.entity_type.replace(/_/g, ' ')}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{policy.description}</div>
          {report && report.total_records > 0 && (
            <div className="text-xs text-gray-400 mt-1">
              {report.total_records.toLocaleString()} records
              {report.expired_records > 0 && (
                <span className="text-amber-600 ml-1">
                  ({report.expired_records} past retention)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Legal minimum badge */}
        <div className="text-center flex-shrink-0 w-20">
          <div className="text-xs text-gray-400">Legal min</div>
          <div className="text-xs font-semibold text-gray-600">
            {formatRetentionPeriod(policy.legal_minimum_days)}
          </div>
        </div>

        {/* Retention input */}
        <div className="flex-shrink-0 w-28">
          <div className="text-xs text-gray-400 mb-1">Retention</div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={policy.legal_minimum_days}
              value={days}
              onChange={e => handleDaysChange(e.target.value)}
              className="w-16 text-sm border border-gray-200 rounded-md px-2 py-1 text-center"
            />
            <span className="text-xs text-gray-500">days</span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            = {formatRetentionPeriod(days)}
          </div>
        </div>

        {/* Auto-purge toggle */}
        <div className="flex-shrink-0 w-24 text-center">
          <div className="text-xs text-gray-400 mb-1">Auto-purge</div>
          {isPurgeSafe ? (
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoPurge}
                onChange={e => handleAutoPurgeChange(e.target.checked)}
                className="sr-only peer"
              />
              <div className="relative w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500" />
            </label>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <Lock className="w-3 h-3" /> Protected
            </span>
          )}
        </div>

        {/* Save button */}
        <div className="flex-shrink-0 w-16">
          {edited && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
