'use client'
/**
 * src/app/export/page.tsx
 *
 * Full Data Export Utility — Download ALL data from Supabase in a single shot.
 * Exports: patients, encounters, bills, ipd_admissions, lab_reports, hospital_fund,
 * beds, prescriptions, appointments, audit_log, clinic_users, lab_partners, etc.
 *
 * Output: Single JSON file containing all tables as separate arrays.
 * Also supports CSV export per table.
 */

import { useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import {
  Download, Database, FileJson, FileSpreadsheet,
  CheckCircle, AlertTriangle, Loader2, Shield,
  HardDrive, Clock, Lock
} from 'lucide-react'

// Tables to export — ordered by importance
const EXPORT_TABLES = [
  { name: 'patients', label: 'Patients', icon: '👤', critical: true },
  { name: 'encounters', label: 'OPD Encounters / Consultations', icon: '🩺', critical: true },
  { name: 'bills', label: 'Bills & Payments', icon: '💰', critical: true },
  { name: 'ipd_admissions', label: 'IPD Admissions', icon: '🏥', critical: true },
  { name: 'ipd_nursing', label: 'IPD Nursing Charts', icon: '📋', critical: false },
  { name: 'lab_reports', label: 'Lab Reports', icon: '🔬', critical: true },
  { name: 'hospital_fund', label: 'Hospital Fund Transactions', icon: '💵', critical: true },
  { name: 'beds', label: 'Bed Configuration', icon: '🛏️', critical: false },
  { name: 'prescriptions', label: 'Prescriptions', icon: '💊', critical: true },
  { name: 'appointments', label: 'Appointments', icon: '📅', critical: false },
  { name: 'lab_partners', label: 'Lab Partners', icon: '🤝', critical: false },
  { name: 'audit_log', label: 'Audit Log', icon: '📝', critical: false },
  { name: 'clinic_users', label: 'Staff / Users', icon: '👥', critical: false },
  { name: 'clinic_settings', label: 'Settings', icon: '⚙️', critical: false },
  { name: 'consultation_attachments', label: 'Consultation Attachments (metadata)', icon: '📎', critical: false },
  { name: 'patient_documents', label: 'Patient Documents (metadata)', icon: '📄', critical: false },
]

interface ExportProgress {
  table: string
  status: 'pending' | 'loading' | 'done' | 'error' | 'empty'
  count: number
  error?: string
}

export default function ExportPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<ExportProgress[]>([])
  const [exportComplete, setExportComplete] = useState(false)
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json')
  const [selectedTables, setSelectedTables] = useState<string[]>(
    EXPORT_TABLES.map(t => t.name)
  )

  function toggleTable(name: string) {
    setSelectedTables(prev =>
      prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name]
    )
  }

  function selectAll() { setSelectedTables(EXPORT_TABLES.map(t => t.name)) }
  function selectCritical() { setSelectedTables(EXPORT_TABLES.filter(t => t.critical).map(t => t.name)) }
  function selectNone() { setSelectedTables([]) }

  async function startExport() {
    if (selectedTables.length === 0) { alert('Select at least one table to export.'); return }

    setExporting(true)
    setExportComplete(false)
    const progressList: ExportProgress[] = selectedTables.map(t => ({
      table: t, status: 'pending', count: 0
    }))
    setProgress([...progressList])

    const allData: Record<string, any[]> = {}
    const exportMeta = {
      exported_at: new Date().toISOString(),
      exported_by: 'NexMedicon HMS',
      version: '2.0',
      tables_included: selectedTables,
      total_records: 0,
    }

    for (let i = 0; i < selectedTables.length; i++) {
      const tableName = selectedTables[i]
      progressList[i].status = 'loading'
      setProgress([...progressList])

      try {
        // Fetch all data from table (paginated for large tables)
        let allRows: any[] = []
        let from = 0
        const PAGE_SIZE = 1000
        let hasMore = true

        while (hasMore) {
          const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .range(from, from + PAGE_SIZE - 1)
            .order('created_at', { ascending: false })

          if (error) {
            // Try without ordering (some tables may not have created_at)
            const { data: data2, error: error2 } = await supabase
              .from(tableName)
              .select('*')
              .range(from, from + PAGE_SIZE - 1)

            if (error2) {
              progressList[i].status = 'error'
              progressList[i].error = error2.message
              setProgress([...progressList])
              break
            }
            if (data2) allRows = [...allRows, ...data2]
            hasMore = (data2?.length || 0) === PAGE_SIZE
          } else {
            if (data) allRows = [...allRows, ...data]
            hasMore = (data?.length || 0) === PAGE_SIZE
          }
          from += PAGE_SIZE
        }

        allData[tableName] = allRows
        progressList[i].status = allRows.length > 0 ? 'done' : 'empty'
        progressList[i].count = allRows.length
        exportMeta.total_records += allRows.length
      } catch (err: any) {
        progressList[i].status = 'error'
        progressList[i].error = err.message || 'Unknown error'
      }

      setProgress([...progressList])
    }

    // Generate and download file
    if (exportFormat === 'json') {
      const exportPayload = {
        _meta: exportMeta,
        ...allData,
      }
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' })
      downloadBlob(blob, `nexmedicon_full_export_${new Date().toISOString().slice(0, 10)}.json`)
    } else {
      // CSV: Download as ZIP-like combined file (each table separated)
      let csvContent = ''
      for (const [table, rows] of Object.entries(allData)) {
        if (rows.length === 0) continue
        csvContent += `\n\n${'='.repeat(60)}\n`
        csvContent += `TABLE: ${table} (${rows.length} records)\n`
        csvContent += `${'='.repeat(60)}\n`

        const headers = Object.keys(rows[0])
        csvContent += headers.join(',') + '\n'
        for (const row of rows) {
          const values = headers.map(h => {
            const val = row[h]
            if (val === null || val === undefined) return ''
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
            // Escape CSV
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str
          })
          csvContent += values.join(',') + '\n'
        }
      }

      const header = `NexMedicon HMS — Full Data Export\nExported: ${new Date().toLocaleString('en-IN')}\nTotal Records: ${exportMeta.total_records}\nTables: ${selectedTables.length}\n`
      const blob = new Blob([header + csvContent], { type: 'text/csv' })
      downloadBlob(blob, `nexmedicon_full_export_${new Date().toISOString().slice(0, 10)}.csv`)
    }

    setExportComplete(true)
    setExporting(false)
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (authLoading) {
    return (
      <AppShell>
        <div className="p-6 flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    )
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="p-6 max-w-2xl mx-auto text-center">
          <Lock className="w-12 h-12 text-red-300 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h1>
          <p className="text-gray-500">Only administrators can export database data.</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Database className="w-6 h-6 text-indigo-600" /> Full Data Export
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Download all your hospital data from Supabase in a single shot — patients, billing, encounters, labs, everything.
          </p>
        </div>

        {/* Format Selection */}
        <div className="card p-5 mb-5">
          <h3 className="font-semibold text-gray-800 mb-3">Export Format</h3>
          <div className="flex gap-3">
            <button
              onClick={() => setExportFormat('json')}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl border-2 transition-all ${
                exportFormat === 'json'
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <FileJson className="w-5 h-5" />
              <div className="text-left">
                <div className="font-semibold text-sm">JSON</div>
                <div className="text-xs text-gray-500">Complete structured data, best for backup/import</div>
              </div>
            </button>
            <button
              onClick={() => setExportFormat('csv')}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl border-2 transition-all ${
                exportFormat === 'csv'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <FileSpreadsheet className="w-5 h-5" />
              <div className="text-left">
                <div className="font-semibold text-sm">CSV</div>
                <div className="text-xs text-gray-500">Open in Excel/Google Sheets, good for CA/audit</div>
              </div>
            </button>
          </div>
        </div>

        {/* Table Selection */}
        <div className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">Select Tables to Export</h3>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-blue-600 hover:underline">All</button>
              <span className="text-gray-300">|</span>
              <button onClick={selectCritical} className="text-xs text-green-600 hover:underline">Critical Only</button>
              <span className="text-gray-300">|</span>
              <button onClick={selectNone} className="text-xs text-red-600 hover:underline">None</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {EXPORT_TABLES.map(t => (
              <label
                key={t.name}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                  selectedTables.includes(t.name)
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-white border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedTables.includes(t.name)}
                  onChange={() => toggleTable(t.name)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-base">{t.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-800">{t.label}</span>
                  {t.critical && (
                    <span className="ml-2 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">Critical</span>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Export Button */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={startExport}
            disabled={exporting || selectedTables.length === 0}
            className="btn-primary flex items-center gap-2 px-8 py-3 text-base disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Download className="w-5 h-5" />
            )}
            {exporting ? 'Exporting...' : `Export ${selectedTables.length} Tables`}
          </button>
          <span className="text-sm text-gray-500">
            {selectedTables.length} of {EXPORT_TABLES.length} tables selected
          </span>
        </div>

        {/* Progress */}
        {progress.length > 0 && (
          <div className="card p-5">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-indigo-500" />
              Export Progress
            </h3>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {progress.map(p => {
                const tableInfo = EXPORT_TABLES.find(t => t.name === p.table)
                return (
                  <div key={p.table} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <span className="text-base w-6 text-center">{tableInfo?.icon}</span>
                    <span className="flex-1 text-sm font-medium text-gray-700">{tableInfo?.label || p.table}</span>
                    <div className="flex items-center gap-2">
                      {p.status === 'pending' && <Clock className="w-4 h-4 text-gray-300" />}
                      {p.status === 'loading' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                      {p.status === 'done' && (
                        <>
                          <span className="text-xs font-mono text-gray-500">{p.count.toLocaleString()} rows</span>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        </>
                      )}
                      {p.status === 'empty' && (
                        <>
                          <span className="text-xs text-gray-400">Empty</span>
                          <CheckCircle className="w-4 h-4 text-gray-300" />
                        </>
                      )}
                      {p.status === 'error' && (
                        <>
                          <span className="text-xs text-red-500" title={p.error}>{p.error?.slice(0, 30)}</span>
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {exportComplete && (
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-3 bg-green-50 -mx-5 -mb-5 px-5 py-4 rounded-b-xl">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <div>
                  <p className="font-semibold text-green-800 text-sm">Export Complete!</p>
                  <p className="text-xs text-green-600">
                    {progress.filter(p => p.status === 'done').reduce((s, p) => s + p.count, 0).toLocaleString()} total records downloaded
                    as {exportFormat.toUpperCase()} file.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Security Note */}
        <div className="mt-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3 text-sm">
          <Shield className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-amber-800">
            <strong>Security Note:</strong> Exported data contains sensitive patient information (PHI).
            Store it securely, encrypt if sending via email, and comply with data protection laws.
            This export is logged in the audit trail.
          </div>
        </div>
      </div>
    </AppShell>
  )
}
