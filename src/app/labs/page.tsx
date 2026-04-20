'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime } from '@/lib/utils'
import FormScanner from '@/components/shared/FormScanner'
import type { OCRResult } from '@/lib/ocr'
import {
  FlaskConical, Search, Plus, X, ChevronRight,
  AlertTriangle, CheckCircle, ArrowLeft, Trash2, Save
} from 'lucide-react'

// ── Common lab test presets grouped by category ───────────────
const LAB_GROUPS = [
  {
    group: 'Blood — Routine',
    tests: [
      { name: 'Haemoglobin (Hb)',     unit: 'g/dL',   low: 11.5,  high: 16.5  },
      { name: 'WBC (Total Count)',    unit: 'cells/µL',low: 4000,  high: 11000 },
      { name: 'Platelet Count',       unit: 'cells/µL',low: 150000,high: 400000},
      { name: 'PCV / Haematocrit',    unit: '%',       low: 36,    high: 48    },
      { name: 'ESR',                  unit: 'mm/hr',   low: 0,     high: 20    },
    ],
  },
  {
    group: 'Blood — Sugar',
    tests: [
      { name: 'Blood Sugar Fasting',  unit: 'mg/dL',  low: 70,    high: 100   },
      { name: 'Blood Sugar PP',       unit: 'mg/dL',  low: 0,     high: 140   },
      { name: 'HbA1c',               unit: '%',       low: 0,     high: 5.7   },
      { name: 'OGTT (1 hr)',          unit: 'mg/dL',  low: 0,     high: 140   },
      { name: 'OGTT (2 hr)',          unit: 'mg/dL',  low: 0,     high: 120   },
    ],
  },
  {
    group: 'Thyroid',
    tests: [
      { name: 'TSH',   unit: 'mIU/L', low: 0.4, high: 4.0 },
      { name: 'T3',    unit: 'ng/dL', low: 80,  high: 200  },
      { name: 'T4',    unit: 'µg/dL', low: 5.1, high: 14.1 },
      { name: 'Free T4', unit: 'ng/dL', low: 0.9, high: 2.3},
    ],
  },
  {
    group: 'Hormones',
    tests: [
      { name: 'LH',         unit: 'mIU/mL', low: 1,    high: 12   },
      { name: 'FSH',         unit: 'mIU/mL', low: 3,    high: 10   },
      { name: 'Prolactin',   unit: 'ng/mL',  low: 2,    high: 29   },
      { name: 'Oestradiol',  unit: 'pg/mL',  low: 20,   high: 350  },
      { name: 'Progesterone',unit: 'ng/mL',  low: 0,    high: 25   },
      { name: 'AMH',         unit: 'ng/mL',  low: 1.5,  high: 4.5  },
      { name: 'Beta-hCG',    unit: 'mIU/mL', low: 0,    high: 5    },
      { name: 'CA-125',      unit: 'U/mL',   low: 0,    high: 35   },
      { name: 'Testosterone',unit: 'ng/dL',  low: 15,   high: 70   },
    ],
  },
  {
    group: 'Infection / Immunity',
    tests: [
      { name: 'HBsAg',               unit: '',       low: 0, high: 0 },
      { name: 'HIV (ELISA)',          unit: '',       low: 0, high: 0 },
      { name: 'VDRL (Syphilis)',      unit: '',       low: 0, high: 0 },
      { name: 'Antiphospholipid IgG', unit: 'GPL',    low: 0, high: 15 },
      { name: 'Antiphospholipid IgM', unit: 'MPL',    low: 0, high: 12 },
    ],
  },
  {
    group: 'Urine',
    tests: [
      { name: 'Urine Protein',    unit: '',        low: 0, high: 0 },
      { name: 'Urine Sugar',      unit: '',        low: 0, high: 0 },
      { name: 'Urine Culture',    unit: '',        low: 0, high: 0 },
    ],
  },
  {
    group: 'Iron Studies',
    tests: [
      { name: 'Serum Iron',      unit: 'µg/dL',  low: 50,  high: 170  },
      { name: 'TIBC',            unit: 'µg/dL',  low: 250, high: 370  },
      { name: 'Serum Ferritin',  unit: 'ng/mL',  low: 12,  high: 150  },
      { name: 'Vitamin B12',     unit: 'pg/mL',  low: 200, high: 900  },
      { name: 'Vitamin D3',      unit: 'ng/mL',  low: 30,  high: 100  },
    ],
  },
]

const ALL_TESTS = LAB_GROUPS.flatMap(g => g.tests.map(t => ({ ...t, group: g.group })))

interface LabEntry {
  testName:   string
  value:      string
  unit:       string
  referenceRange: string
  status:     'normal' | 'low' | 'high' | 'pending'
  remarks:    string
}

interface LabReport {
  id:          string
  patient_id:  string
  patient_name:string
  mrn:         string
  report_date: string
  lab_name:    string
  entries:     LabEntry[]
  notes:       string
  created_at:  string
  encounter_id?: string
}

// Storage key for localStorage (bills are in Supabase; labs in localStorage for now)
const LABS_KEY = 'nexmedicon_labs'
function loadLabs(): LabReport[] {
  try { return JSON.parse(localStorage.getItem(LABS_KEY) || '[]') } catch { return [] }
}
function saveLabs(labs: LabReport[]) {
  localStorage.setItem(LABS_KEY, JSON.stringify(labs))
}

function statusBadge(entry: LabEntry) {
  if (entry.status === 'high')    return <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle className="w-3 h-3"/>High</span>
  if (entry.status === 'low')     return <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle className="w-3 h-3"/>Low</span>
  if (entry.status === 'normal')  return <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle className="w-3 h-3"/>Normal</span>
  return <span className="text-xs text-gray-400">—</span>
}

function determineStatus(value: string, low: number, high: number): 'normal' | 'low' | 'high' | 'pending' {
  const v = parseFloat(value)
  if (isNaN(v) || !value.trim()) return 'pending'
  if (low === 0 && high === 0) return 'pending'  // qualitative test
  if (v < low) return 'low'
  if (v > high) return 'high'
  return 'normal'
}

export default function LabsPage() {
  const [view,       setView]       = useState<'list'|'new'|'detail'>('list')
  const [listSearch, setListSearch]  = useState('')
  const [labs,       setLabs]       = useState<LabReport[]>([])
  const [selected,   setSelected]   = useState<LabReport | null>(null)

  // New report form
  const [patientQuery,    setPatientQuery]    = useState('')
  const [patientResults,  setPatientResults]  = useState<any[]>([])
  const [selPatient,      setSelPatient]      = useState<any>(null)
  const [labName,         setLabName]         = useState('')
  const [reportDate,      setReportDate]      = useState(new Date().toISOString().split('T')[0])
  const [entries,         setEntries]         = useState<LabEntry[]>([])
  const [notes,           setNotes]           = useState('')
  const [selectedTest,    setSelectedTest]    = useState('')
  const [saving,          setSaving]          = useState(false)

  const searchParams = useSearchParams()
  const searchTimer = useRef<ReturnType<typeof setTimeout>|null>(null)

  useEffect(() => { setLabs(loadLabs()) }, [])

  useEffect(() => {
    const pid   = searchParams.get('patientId')
    const pname = searchParams.get('patientName')
    const mrn   = searchParams.get('mrn')
    if (pid && pname && !selPatient) {
      setSelPatient({ id: pid, full_name: decodeURIComponent(pname), mrn: mrn||'', age:'', mobile:'' })
      setView('new')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function searchPatients(q: string) {
    setPatientQuery(q); setSelPatient(null)
    if (q.trim().length < 2) { setPatientResults([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('patients')
        .select('id, full_name, mrn, age, mobile')
        .or(`full_name.ilike.%${q}%,mrn.ilike.%${q}%,mobile.ilike.%${q}%`).limit(6)
      setPatientResults(data || [])
    }, 300)
  }

  function addTest(testName: string) {
    if (!testName || entries.some(e => e.testName === testName)) return
    const preset = ALL_TESTS.find(t => t.name === testName)
    setEntries(prev => [...prev, {
      testName,
      value:          '',
      unit:           preset?.unit || '',
      referenceRange: preset ? `${preset.low}–${preset.high} ${preset.unit}`.trim() : '',
      status:         'pending',
      remarks:        '',
    }])
    setSelectedTest('')
  }

  function updateEntry(i: number, field: keyof LabEntry, value: string) {
    setEntries(prev => prev.map((e, j) => {
      if (j !== i) return e
      const updated = { ...e, [field]: value }
      if (field === 'value') {
        const preset = ALL_TESTS.find(t => t.name === e.testName)
        if (preset) updated.status = determineStatus(value, preset.low, preset.high)
      }
      return updated
    }))
  }

  function handleOCR(result: OCRResult) {
    if (result.lab?.all_results) {
      setNotes(prev => prev ? prev + '\n' + result.lab!.all_results : result.lab!.all_results!)
    }
  }

  function saveReport() {
    if (!selPatient || entries.length === 0) return
    setSaving(true)
    const report: LabReport = {
      id:           crypto.randomUUID(),
      patient_id:   selPatient.id,
      patient_name: selPatient.full_name,
      mrn:          selPatient.mrn,
      report_date:  reportDate,
      lab_name:     labName.trim() || 'External Lab',
      entries,
      notes,
      created_at:   new Date().toISOString(),
    }
    const updated = [report, ...labs]
    setLabs(updated)
    saveLabs(updated)
    setSaving(false)
    setSelected(report)
    setView('detail')
    resetForm()
  }

  function resetForm() {
    setSelPatient(null); setPatientQuery(''); setPatientResults([])
    setEntries([]); setNotes(''); setLabName('')
    setReportDate(new Date().toISOString().split('T')[0])
  }

  const filteredLabs = listSearch.trim()
    ? labs.filter(l =>
        l.patient_name.toLowerCase().includes(listSearch.toLowerCase()) ||
        l.mrn.toLowerCase().includes(listSearch.toLowerCase()) ||
        l.lab_name.toLowerCase().includes(listSearch.toLowerCase()))
    : labs

  const abnormals = (report: LabReport) =>
    report.entries.filter(e => e.status === 'high' || e.status === 'low').length

  // ── DETAIL VIEW ───────────────────────────────────────────
  if (view === 'detail' && selected) {
    return (
      <AppShell>
        <div className="p-6 max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => { setView('list'); setSelected(null) }} className="text-gray-400 hover:text-gray-700">
              <ArrowLeft className="w-5 h-5"/>
            </button>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900">Lab Report</h1>
              <p className="text-sm text-gray-500">{selected.patient_name} · {selected.mrn} · {formatDate(selected.report_date)}</p>
            </div>
            <Link href={`/patients/${selected.patient_id}`} className="btn-secondary text-xs">Patient Record</Link>
          </div>

          <div className="card p-5 mb-4">
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="font-semibold text-gray-900">{selected.lab_name}</div>
                <div className="text-sm text-gray-500">{formatDate(selected.report_date)}</div>
              </div>
              {abnormals(selected) > 0 && (
                <div className="flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                  <AlertTriangle className="w-3.5 h-3.5"/>
                  {abnormals(selected)} abnormal value{abnormals(selected) > 1 ? 's' : ''}
                </div>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Test','Result','Reference','Status','Remarks'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selected.entries.map((e, i) => (
                  <tr key={i} className={`border-b border-gray-50 ${e.status==='high'||e.status==='low'?'bg-red-50/30':''}`}>
                    <td className="px-3 py-2.5 font-medium text-gray-800">{e.testName}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold">
                      <span className={e.status==='high'||e.status==='low'?'text-red-700':'text-gray-900'}>
                        {e.value || '—'} {e.value && e.unit}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-400 text-xs">{e.referenceRange || '—'}</td>
                    <td className="px-3 py-2.5">{statusBadge(e)}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{e.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {selected.notes && (
              <div className="mt-4 bg-gray-50 rounded-lg p-3">
                <div className="text-xs font-semibold text-gray-500 mb-1">Additional Notes / Raw Results</div>
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans">{selected.notes}</pre>
              </div>
            )}
          </div>
        </div>
      </AppShell>
    )
  }

  // ── NEW REPORT VIEW ───────────────────────────────────────
  if (view === 'new') {
    return (
      <AppShell>
        <div className="p-6 max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => { resetForm(); setView('list') }} className="text-gray-400 hover:text-gray-700">
              <ArrowLeft className="w-5 h-5"/>
            </button>
            <h1 className="text-xl font-bold text-gray-900">Enter Lab Results</h1>
          </div>

          {/* Patient */}
          <div className="card p-5 mb-4">
            <h2 className="section-title">Patient</h2>
            {selPatient ? (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <div>
                  <div className="font-semibold">{selPatient.full_name}</div>
                  <div className="text-xs text-gray-500">{selPatient.mrn} · {selPatient.age}y · {selPatient.mobile}</div>
                </div>
                <button onClick={() => { setSelPatient(null); setPatientQuery('') }}>
                  <X className="w-4 h-4 text-gray-400 hover:text-red-500"/>
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
                <input className="input pl-9" placeholder="Search patient…" autoFocus
                  value={patientQuery} onChange={e => searchPatients(e.target.value)}/>
                {patientResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded-lg shadow-lg mt-1">
                    {patientResults.map(p => (
                      <button key={p.id} onClick={() => { setSelPatient(p); setPatientResults([]) }}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 text-sm border-b border-gray-50 last:border-0">
                        <span className="font-semibold">{p.full_name}</span>
                        <span className="text-gray-400 ml-2">{p.mrn} · {p.age}y</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Report info */}
          <div className="card p-5 mb-4">
            <h2 className="section-title">Report Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Lab / Pathology Centre Name</label>
                <input className="input" placeholder="e.g. Dr. Lal PathLabs, Metropolis…"
                  value={labName} onChange={e => setLabName(e.target.value)}/>
              </div>
              <div>
                <label className="label">Report Date</label>
                <input className="input" type="date" value={reportDate} onChange={e => setReportDate(e.target.value)}/>
              </div>
            </div>
          </div>

          {/* Scan lab report */}
          <FormScanner formType="lab_report" onExtracted={handleOCR}
            label="Scan printed lab report — extracts all values automatically"
            className="mb-4"/>

          {/* Test entry */}
          <div className="card p-5 mb-4">
            <h2 className="section-title">Test Results</h2>
            <div className="flex gap-2 mb-4">
              <select className="input flex-1" value={selectedTest}
                onChange={e => { addTest(e.target.value); setSelectedTest('') }}>
                <option value="">+ Add test from list…</option>
                {LAB_GROUPS.map(g => (
                  <optgroup key={g.group} label={g.group}>
                    {g.tests.map(t => (
                      <option key={t.name} value={t.name}
                        disabled={entries.some(e => e.testName === t.name)}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {entries.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4 border-2 border-dashed border-gray-100 rounded-lg">
                Select tests from the dropdown above, or scan the lab report to auto-fill.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      {['Test','Result','Unit','Reference Range','Remarks',''].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{e.testName}</td>
                        <td className="px-3 py-2">
                          <input className={`input w-24 font-mono text-sm py-1 ${
                            e.status==='high'||e.status==='low' ? 'border-red-400 bg-red-50' : ''
                          }`}
                            placeholder="value" value={e.value}
                            onChange={ev => updateEntry(i, 'value', ev.target.value)}/>
                        </td>
                        <td className="px-3 py-2">
                          <input className="input w-20 text-sm py-1" placeholder="unit"
                            value={e.unit} onChange={ev => updateEntry(i, 'unit', ev.target.value)}/>
                        </td>
                        <td className="px-3 py-2">
                          <input className="input w-28 text-xs py-1" placeholder="e.g. 11.5–16.5"
                            value={e.referenceRange} onChange={ev => updateEntry(i, 'referenceRange', ev.target.value)}/>
                        </td>
                        <td className="px-3 py-2">
                          <input className="input w-32 text-xs py-1" placeholder="remarks"
                            value={e.remarks} onChange={ev => updateEntry(i, 'remarks', ev.target.value)}/>
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => setEntries(prev => prev.filter((_, j) => j !== i))}
                            className="text-red-400 hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5"/>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Notes / raw */}
          <div className="card p-5 mb-5">
            <h2 className="section-title">Additional Notes / Raw Results</h2>
            <textarea className="input resize-none font-mono text-xs" rows={4}
              placeholder="Paste raw results, additional values, or any notes from the lab report here…"
              value={notes} onChange={e => setNotes(e.target.value)}/>
          </div>

          <div className="flex justify-between">
            <button onClick={() => { resetForm(); setView('list') }} className="btn-secondary">Cancel</button>
            <button onClick={saveReport}
              disabled={saving || !selPatient || entries.length === 0}
              className="btn-primary flex items-center gap-2 disabled:opacity-60">
              <Save className="w-4 h-4"/>
              {saving ? 'Saving…' : 'Save Lab Report'}
            </button>
          </div>
        </div>
      </AppShell>
    )
  }

  // ── LIST VIEW ─────────────────────────────────────────────
  return (
    <AppShell>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FlaskConical className="w-6 h-6 text-purple-600"/> Lab Results
            </h1>
            <p className="text-sm text-gray-500">Record and view patient laboratory reports.</p>
          </div>
          <button onClick={() => { resetForm(); setView('new') }}
            className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4"/> Enter Lab Results
          </button>
        </div>

        {/* Search bar */}
        <div className="card p-3 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
            <input className="input pl-9 bg-gray-50" placeholder="Search by patient name, MRN, or lab name..."
              value={listSearch} onChange={e => setListSearch(e.target.value)}/>
          </div>
        </div>

        {filteredLabs.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <FlaskConical className="w-12 h-12 mx-auto mb-4 opacity-20"/>
            <p className="font-medium mb-1">No lab reports yet</p>
            <p className="text-sm mb-4">Enter patient lab results to track them here.</p>
            <button onClick={() => { resetForm(); setView('new') }}
              className="btn-primary inline-flex items-center gap-2 text-xs">
              <Plus className="w-3.5 h-3.5"/> Enter First Lab Report
            </button>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Date','Patient','Lab','Tests','Abnormal',''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLabs.map(lab => {
                  const abn = abnormals(lab)
                  return (
                    <tr key={lab.id}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                      onClick={() => { setSelected(lab); setView('detail') }}>
                      <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(lab.report_date)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{lab.patient_name}</div>
                        <div className="text-xs text-gray-400">{lab.mrn}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{lab.lab_name}</td>
                      <td className="px-4 py-3 text-gray-600">{lab.entries.length} test{lab.entries.length !== 1 ? 's' : ''}</td>
                      <td className="px-4 py-3">
                        {abn > 0
                          ? <span className="flex items-center gap-1 text-xs text-red-700 font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5"/>{abn} abnormal
                            </span>
                          : <span className="text-xs text-green-600">All normal</span>}
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight className="w-4 h-4 text-gray-400"/>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
