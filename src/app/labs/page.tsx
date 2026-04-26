'use client'
/**
 * src/app/labs/page.tsx  (UPDATED — A. Lab Results → Supabase)
 *
 * Changes from original:
 *  - localStorage replaced with Supabase `lab_reports` table
 *  - Audit log on create/update/delete
 *  - All other UI/logic identical to original
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase }       from '@/lib/supabase'
import { audit }          from '@/lib/audit'
import { formatDate, formatDateTime } from '@/lib/utils'
import FormScanner        from '@/components/shared/FormScanner'
import type { OCRResult } from '@/lib/ocr'
import {
  FlaskConical, Search, Plus, X, ChevronRight,
  AlertTriangle, CheckCircle, ArrowLeft, Trash2, Save,
} from 'lucide-react'

// ── Lab test presets (unchanged from original) ────────────────
const LAB_GROUPS = [
  { group: 'Blood — Routine', tests: [
    { name: 'Haemoglobin (Hb)',    unit: 'g/dL',    low: 11.5,   high: 16.5   },
    { name: 'WBC (Total Count)',   unit: 'cells/µL', low: 4000,   high: 11000  },
    { name: 'Platelet Count',      unit: 'cells/µL', low: 150000, high: 400000 },
    { name: 'PCV / Haematocrit',   unit: '%',        low: 36,     high: 48     },
    { name: 'ESR',                 unit: 'mm/hr',    low: 0,      high: 20     },
  ]},
  { group: 'Blood — Sugar', tests: [
    { name: 'Blood Sugar Fasting', unit: 'mg/dL', low: 70,  high: 100 },
    { name: 'Blood Sugar PP',      unit: 'mg/dL', low: 0,   high: 140 },
    { name: 'HbA1c',              unit: '%',      low: 0,   high: 5.7 },
    { name: 'OGTT (1 hr)',         unit: 'mg/dL', low: 0,   high: 140 },
    { name: 'OGTT (2 hr)',         unit: 'mg/dL', low: 0,   high: 120 },
  ]},
  { group: 'Thyroid', tests: [
    { name: 'TSH',    unit: 'mIU/L', low: 0.4, high: 4.0  },
    { name: 'T3',     unit: 'ng/dL', low: 80,  high: 200  },
    { name: 'T4',     unit: 'µg/dL', low: 5.1, high: 14.1 },
    { name: 'Free T4',unit: 'ng/dL', low: 0.9, high: 2.3  },
  ]},
  { group: 'Hormones', tests: [
    { name: 'LH',          unit: 'mIU/mL', low: 1,   high: 12  },
    { name: 'FSH',         unit: 'mIU/mL', low: 3,   high: 10  },
    { name: 'Prolactin',   unit: 'ng/mL',  low: 2,   high: 29  },
    { name: 'Oestradiol',  unit: 'pg/mL',  low: 20,  high: 350 },
    { name: 'Progesterone',unit: 'ng/mL',  low: 0,   high: 25  },
    { name: 'AMH',         unit: 'ng/mL',  low: 1.5, high: 4.5 },
    { name: 'Beta-hCG',    unit: 'mIU/mL', low: 0,   high: 5   },
    { name: 'CA-125',      unit: 'U/mL',   low: 0,   high: 35  },
    { name: 'Testosterone',unit: 'ng/dL',  low: 15,  high: 70  },
  ]},
  { group: 'Infection / Immunity', tests: [
    { name: 'HBsAg',               unit: '',    low: 0, high: 0  },
    { name: 'HIV (ELISA)',          unit: '',    low: 0, high: 0  },
    { name: 'VDRL (Syphilis)',      unit: '',    low: 0, high: 0  },
    { name: 'Antiphospholipid IgG', unit: 'GPL', low: 0, high: 15 },
    { name: 'Antiphospholipid IgM', unit: 'MPL', low: 0, high: 12 },
  ]},
  { group: 'Urine', tests: [
    { name: 'Urine Protein', unit: '', low: 0, high: 0 },
    { name: 'Urine Sugar',   unit: '', low: 0, high: 0 },
    { name: 'Urine Culture', unit: '', low: 0, high: 0 },
  ]},
  { group: 'Iron Studies', tests: [
    { name: 'Serum Iron',     unit: 'µg/dL', low: 50,  high: 170 },
    { name: 'TIBC',           unit: 'µg/dL', low: 250, high: 370 },
    { name: 'Serum Ferritin', unit: 'ng/mL', low: 12,  high: 150 },
    { name: 'Vitamin B12',    unit: 'pg/mL', low: 200, high: 900 },
    { name: 'Vitamin D3',     unit: 'ng/mL', low: 30,  high: 100 },
  ]},
]

const ALL_TESTS = LAB_GROUPS.flatMap(g => g.tests.map(t => ({ ...t, group: g.group })))

interface LabEntry {
  testName:       string
  value:          string
  unit:           string
  referenceRange: string
  status:         'normal' | 'low' | 'high' | 'pending'
  remarks:        string
}

interface LabReport {
  id:           string
  patient_id:   string
  patient_name: string
  mrn:          string
  report_date:  string
  lab_name:     string
  entries:      LabEntry[]
  notes:        string
  created_at:   string
  encounter_id?: string
}

// ── Helpers ───────────────────────────────────────────────────
function normaliseEntry(e: Partial<LabEntry>): LabEntry {
  return {
    testName:       e.testName       ?? '',
    value:          e.value          ?? '',
    unit:           e.unit           ?? '',
    referenceRange: e.referenceRange ?? '',
    status:         e.status         ?? 'pending',
    remarks:        e.remarks        ?? '',
  }
}

function determineStatus(test: typeof ALL_TESTS[0], value: string): LabEntry['status'] {
  const v = parseFloat(value)
  if (isNaN(v) || !value.trim()) return 'pending'
  if (test.low === 0 && test.high === 0) return 'normal'
  if (v < test.low) return 'low'
  if (v > test.high) return 'high'
  return 'normal'
}

// ── Page ──────────────────────────────────────────────────────
export default function LabsPage() {
  const searchParams = useSearchParams()

  const [reports,       setReports]       = useState<LabReport[]>([])
  const [loading,       setLoading]       = useState(true)
  const [searchQuery,   setSearchQuery]   = useState('')
  const [view,          setView]          = useState<'list' | 'form'>('list')
  const [editingReport, setEditingReport] = useState<LabReport | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')

  // Form state
  const [patientId,   setPatientId]   = useState(searchParams.get('patient') ?? '')
  const [encounterId, setEncounterId] = useState(searchParams.get('encounter') ?? '')
  const [patientName, setPatientName] = useState('')
  const [mrn,         setMrn]         = useState('')
  const [reportDate,  setReportDate]  = useState(new Date().toISOString().slice(0, 10))
  const [labName,     setLabName]     = useState('')
  const [notes,       setNotes]       = useState('')
  const [entries,     setEntries]     = useState<LabEntry[]>([normaliseEntry({})])
  const [testSearch,  setTestSearch]  = useState('')
  const [showPresets, setShowPresets] = useState(false)

  // ── Load from Supabase ────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('lab_reports')
        .select(`
          id, report_date, lab_name, entries, notes, created_at, encounter_id,
          patients!inner ( id, full_name, mrn )
        `)
        .order('report_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (patientId) q = q.eq('patient_id', patientId)

      const { data, error: err } = await q
      if (err) throw err

      const mapped: LabReport[] = (data || []).map((r: any) => ({
        id:           r.id,
        patient_id:   r.patients.id,
        patient_name: r.patients.full_name,
        mrn:          r.patients.mrn,
        report_date:  r.report_date,
        lab_name:     r.lab_name,
        entries:      r.entries ?? [],
        notes:        r.notes ?? '',
        created_at:   r.created_at,
        encounter_id: r.encounter_id,
      }))

      setReports(mapped)
    } catch (e: any) {
      setError(`Failed to load: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => { load() }, [load])

  // Pre-fill patient info if URL param provided
  useEffect(() => {
    if (!patientId) return
    supabase.from('patients').select('full_name, mrn').eq('id', patientId).single()
      .then(({ data }) => {
        if (data) { setPatientName(data.full_name); setMrn(data.mrn) }
      })
  }, [patientId])

  // ── OCR auto-fill ─────────────────────────────────────────
  function handleOCR(result: OCRResult) {
    const raw = result.raw_text ?? ''
    if (!labName && raw.toLowerCase().includes('lab')) setLabName('Lab Report')
    const labTests = ALL_TESTS.filter(t =>
      raw.toLowerCase().includes(t.name.toLowerCase().slice(0, 4))
    )
    if (labTests.length > 0) {
      const newEntries: LabEntry[] = labTests.slice(0, 10).map(t => normaliseEntry({
        testName: t.name, unit: t.unit,
        referenceRange: t.low === 0 && t.high === 0 ? 'Negative' : `${t.low}–${t.high}`,
        status: 'pending',
      }))
      setEntries(newEntries)
    }
  }

  // ── Save ──────────────────────────────────────────────────
  async function handleSave() {
    if (!patientId)    { setError('Select a patient first.'); return }
    if (!reportDate)   { setError('Enter a report date.'); return }
    if (entries.filter(e => e.testName.trim()).length === 0) {
      setError('Add at least one test result.'); return
    }

    setSaving(true); setError('')

    const payload = {
      patient_id:   patientId,
      encounter_id: encounterId || null,
      report_date:  reportDate,
      lab_name:     labName.trim(),
      entries:      entries.filter(e => e.testName.trim()),
      notes:        notes.trim(),
    }

    try {
      if (editingReport) {
        const { error: e } = await supabase
          .from('lab_reports').update(payload).eq('id', editingReport.id)
        if (e) throw e
        await audit('update', 'lab_report', editingReport.id, `Lab report — ${patientName}`)
      } else {
        const { data, error: e } = await supabase
          .from('lab_reports').insert(payload).select().single()
        if (e) throw e
        await audit('create', 'lab_report', data?.id, `Lab report — ${patientName}`)
      }

      resetForm()
      setView('list')
      load()
    } catch (e: any) {
      setError(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function deleteReport(id: string, pname: string) {
    if (!confirm('Delete this lab report? This cannot be undone.')) return
    const { error: e } = await supabase.from('lab_reports').delete().eq('id', id)
    if (e) { setError(e.message); return }
    await audit('delete', 'lab_report', id, `Lab report — ${pname}`)
    load()
  }

  function editReport(r: LabReport) {
    setEditingReport(r)
    setPatientId(r.patient_id)
    setPatientName(r.patient_name)
    setMrn(r.mrn)
    setReportDate(r.report_date)
    setLabName(r.lab_name)
    setNotes(r.notes)
    setEntries(r.entries.length > 0 ? r.entries : [normaliseEntry({})])
    setEncounterId(r.encounter_id ?? '')
    setView('form')
  }

  function resetForm() {
    setEditingReport(null)
    setPatientId(searchParams.get('patient') ?? '')
    setEncounterId(searchParams.get('encounter') ?? '')
    setPatientName(''); setMrn('')
    setReportDate(new Date().toISOString().slice(0, 10))
    setLabName(''); setNotes('')
    setEntries([normaliseEntry({})])
    setTestSearch('')
  }

  // ── Entry helpers ─────────────────────────────────────────
  function addPreset(test: typeof ALL_TESTS[0]) {
    setEntries(prev => {
      const already = prev.some(e => e.testName === test.name)
      if (already) return prev
      const blank = prev.length === 1 && !prev[0].testName
      const newEntry = normaliseEntry({
        testName: test.name, unit: test.unit,
        referenceRange: test.low === 0 && test.high === 0 ? 'Negative' : `${test.low}–${test.high}`,
      })
      return blank ? [newEntry] : [...prev, newEntry]
    })
    setShowPresets(false)
    setTestSearch('')
  }

  function updateEntry(i: number, field: keyof LabEntry, val: string) {
    setEntries(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: val }
      if (field === 'value') {
        const preset = ALL_TESTS.find(t => t.name === next[i].testName)
        next[i].status = preset ? determineStatus(preset, val) : 'pending'
      }
      return next
    })
  }

  function removeEntry(i: number) {
    setEntries(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)
  }

  // ── Filter ────────────────────────────────────────────────
  const filtered = reports.filter(r =>
    !searchQuery ||
    r.patient_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.mrn.includes(searchQuery) ||
    r.lab_name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredPresets = testSearch
    ? ALL_TESTS.filter(t => t.name.toLowerCase().includes(testSearch.toLowerCase()))
    : ALL_TESTS

  const statusColour = (s: LabEntry['status']) =>
    s === 'high'    ? 'text-red-600 bg-red-50 border-red-200' :
    s === 'low'     ? 'text-blue-700 bg-blue-50 border-blue-200' :
    s === 'normal'  ? 'text-green-700 bg-green-50 border-green-200' :
    'text-gray-500 bg-gray-50 border-gray-200'

  // ── Render ────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {view === 'form' && (
              <button onClick={() => { resetForm(); setView('list') }} className="p-2 hover:bg-gray-100 rounded-lg">
                <ArrowLeft className="w-5 h-5 text-gray-600"/>
              </button>
            )}
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-indigo-600"/>
                Lab Results
              </h1>
              <p className="text-sm text-gray-500">
                {view === 'list' ? 'All lab reports — stored in Supabase' : editingReport ? 'Edit lab report' : 'New lab report'}
              </p>
            </div>
          </div>
          {view === 'list' && (
            <button onClick={() => { resetForm(); setView('form') }}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">
              <Plus className="w-4 h-4"/> New Report
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5"/>
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4"/></button>
          </div>
        )}

        {/* ── LIST VIEW ── */}
        {view === 'list' && (
          <>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by patient, MRN, or lab name…"
                className="input pl-9"/>
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-400">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
                <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-30"/>
                <p className="font-medium">No lab reports yet</p>
                <p className="text-sm mt-1">Click "New Report" to add the first one</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map(r => {
                  const abnormal = r.entries.filter(e => e.status === 'high' || e.status === 'low')
                  return (
                    <div key={r.id} className="card p-4 hover:border-indigo-200 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-gray-900">{r.patient_name}</span>
                            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">MRN {r.mrn}</span>
                            {abnormal.length > 0 && (
                              <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3"/> {abnormal.length} abnormal
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500 mt-0.5">
                            {formatDate(r.report_date)} · {r.lab_name || 'Lab not specified'} · {r.entries.length} test{r.entries.length !== 1 ? 's' : ''}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {r.entries.slice(0, 6).map((e, i) => (
                              <span key={i} className={`text-xs px-2 py-0.5 rounded-full border ${statusColour(e.status)}`}>
                                {e.testName}{e.value ? ` ${e.value}` : ''}
                              </span>
                            ))}
                            {r.entries.length > 6 && <span className="text-xs text-gray-400">+{r.entries.length - 6} more</span>}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => editReport(r)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg" title="Edit">
                            <ChevronRight className="w-4 h-4"/>
                          </button>
                          <button onClick={() => deleteReport(r.id, r.patient_name)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg" title="Delete">
                            <Trash2 className="w-4 h-4"/>
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── FORM VIEW ── */}
        {view === 'form' && (
          <div className="space-y-5">

            {/* OCR Scanner */}
            <div className="card p-4">
              <FormScanner
                formType="lab_report"
                onExtracted={handleOCR}
                label="Scan printed lab report — extracts all values automatically"
              />
            </div>

            {/* Patient + Meta */}
            <div className="card p-5">
              <h3 className="font-semibold text-gray-900 mb-4">Report Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Patient Name</label>
                  <input className="input" value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="Patient name"/>
                </div>
                <div>
                  <label className="label">MRN</label>
                  <input className="input" value={mrn} onChange={e => setMrn(e.target.value)} placeholder="MRN"/>
                </div>
                <div>
                  <label className="label">Report Date</label>
                  <input type="date" className="input" value={reportDate} onChange={e => setReportDate(e.target.value)}/>
                </div>
                <div>
                  <label className="label">Laboratory Name</label>
                  <input className="input" value={labName} onChange={e => setLabName(e.target.value)} placeholder="e.g. Metropolis, SRL, local lab"/>
                </div>
              </div>
            </div>

            {/* Test Results */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Test Results</h3>
                <div className="relative">
                  <button onClick={() => setShowPresets(v => !v)}
                    className="flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-medium px-3 py-1.5 rounded-lg">
                    <Plus className="w-4 h-4"/> Add Test
                  </button>
                  {showPresets && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 w-72 max-h-80 overflow-hidden flex flex-col">
                      <div className="p-2 border-b border-gray-100">
                        <input autoFocus value={testSearch} onChange={e => setTestSearch(e.target.value)}
                          placeholder="Search tests…" className="input text-sm"/>
                      </div>
                      <div className="overflow-y-auto flex-1">
                        {LAB_GROUPS
                          .filter(g => !testSearch || g.tests.some(t => t.name.toLowerCase().includes(testSearch.toLowerCase())))
                          .map(g => (
                            <div key={g.group}>
                              <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">{g.group}</div>
                              {g.tests
                                .filter(t => !testSearch || t.name.toLowerCase().includes(testSearch.toLowerCase()))
                                .map(t => (
                                  <button key={t.name} onClick={() => addPreset({ ...t, group: g.group })}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-gray-800">
                                    {t.name} <span className="text-gray-400 text-xs">({t.unit || 'qualitative'})</span>
                                  </button>
                                ))
                              }
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {entries.map((entry, i) => (
                  <div key={i} className="border border-gray-100 rounded-xl p-3 bg-gray-50">
                    <div className="flex gap-2 mb-2">
                      <input className="input text-sm flex-1" placeholder="Test name"
                        value={entry.testName} onChange={e => updateEntry(i, 'testName', e.target.value)}/>
                      {entries.length > 1 && (
                        <button onClick={() => removeEntry(i)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                          <X className="w-4 h-4"/>
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="text-xs text-gray-500 font-medium">Value</label>
                        <input className="input text-sm mt-1" placeholder="e.g. 12.5"
                          value={entry.value} onChange={e => updateEntry(i, 'value', e.target.value)}/>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 font-medium">Unit</label>
                        <input className="input text-sm mt-1" placeholder="g/dL"
                          value={entry.unit} onChange={e => updateEntry(i, 'unit', e.target.value)}/>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 font-medium">Ref. Range</label>
                        <input className="input text-sm mt-1" placeholder="11.5–16.5"
                          value={entry.referenceRange} onChange={e => updateEntry(i, 'referenceRange', e.target.value)}/>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 font-medium">Status</label>
                        <select className={`input text-sm mt-1 ${statusColour(entry.status)}`}
                          value={entry.status} onChange={e => updateEntry(i, 'status', e.target.value as any)}>
                          <option value="pending">Pending</option>
                          <option value="normal">Normal</option>
                          <option value="low">Low ↓</option>
                          <option value="high">High ↑</option>
                        </select>
                      </div>
                    </div>
                    {(entry.status === 'high' || entry.status === 'low') && (
                      <input className="input text-sm mt-2" placeholder="Remarks (optional)"
                        value={entry.remarks} onChange={e => updateEntry(i, 'remarks', e.target.value)}/>
                    )}
                  </div>
                ))}
                <button onClick={() => setEntries(prev => [...prev, normaliseEntry({})])}
                  className="w-full py-2 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4"/> Add another test
                </button>
              </div>
            </div>

            {/* Notes */}
            <div className="card p-5">
              <label className="label">Notes / Remarks</label>
              <textarea className="input resize-none" rows={3} placeholder="Any additional notes…"
                value={notes} onChange={e => setNotes(e.target.value)}/>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-2.5 rounded-lg disabled:opacity-50">
                {saving ? 'Saving…' : <><Save className="w-4 h-4"/> Save Report</>}
              </button>
              <button onClick={() => { resetForm(); setView('list') }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}