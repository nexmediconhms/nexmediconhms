'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import ConsultationAttachments from '@/components/shared/ConsultationAttachments'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime, ageFromDOB, calculateGA, calculateEDD } from '@/lib/utils'
import { assessObstetricRisk, assessVitalRisk, riskLevelStyle } from '@/lib/clinical-risk'
import type { RiskAssessment } from '@/lib/clinical-risk'
import type { Patient, Encounter, Prescription, DischargeSummary } from '@/types'
import {
  ArrowLeft, Stethoscope, Pill, Printer, Phone, Calendar,
  Droplets, User, Edit, Plus, FileText, ClipboardList,
  CheckCircle, Sparkles, Loader2, AlertCircle, AlertTriangle, TrendingUp, FlaskConical, IndianRupee,
  Shield, Download
} from 'lucide-react'

// ── Inline mini vitals chart (pure SVG, no library needed) ───
function VitalsChart({ encounters }: { encounters: Encounter[] }) {
  // Show last 8 encounters with vitals, oldest→newest
  const pts = [...encounters]
    .filter(e => e.bp_systolic || e.pulse || e.weight)
    .slice(0, 8)
    .reverse()

  if (pts.length < 2) return (
    <p className="text-xs text-gray-400 py-4 text-center">
      At least 2 consultations with vitals needed to show trends.
    </p>
  )

  type LineKey = 'bp_systolic' | 'pulse' | 'weight'

  const lines: { key: LineKey; label: string; color: string; unit: string }[] = [
    { key: 'bp_systolic', label: 'BP Systolic', color: '#ef4444', unit: 'mmHg' },
    { key: 'pulse',       label: 'Pulse',       color: '#3b82f6', unit: 'bpm'  },
    { key: 'weight',      label: 'Weight',      color: '#22c55e', unit: 'kg'   },
  ]

  const W = 480; const H = 120; const PAD = { t:10, r:10, b:28, l:42 }
  const chartW = W - PAD.l - PAD.r
  const chartH = H - PAD.t - PAD.b

  function makePath(key: LineKey): string {
    const vals = pts.map(e => Number(e[key]) || null)
    const valid = vals.filter(v => v !== null) as number[]
    if (valid.length < 2) return ''
    const minV = Math.min(...valid) * 0.95
    const maxV = Math.max(...valid) * 1.05
    const range = maxV - minV || 1
    const coords = pts.map((_, i) => {
      const v = vals[i]
      if (v === null) return null
      const x = PAD.l + (i / (pts.length - 1)) * chartW
      const y = PAD.t + chartH - ((v - minV) / range) * chartH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    const segments = coords.reduce<string[]>((acc, c, i) => {
      if (c === null) return acc
      const prev = coords.slice(0, i).reverse().find(x => x !== null)
      return [...acc, prev ? `L${c}` : `M${c}`]
    }, [])
    return segments.join(' ')
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }}>
        {/* Y-axis gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <line key={f}
            x1={PAD.l} y1={PAD.t + chartH * (1-f)}
            x2={PAD.l + chartW} y2={PAD.t + chartH * (1-f)}
            stroke="#f1f5f9" strokeWidth="1"/>
        ))}
        {/* X axis labels */}
        {pts.map((e, i) => (
          <text key={i}
            x={PAD.l + (i/(pts.length-1))*chartW}
            y={H - 4}
            textAnchor="middle" fontSize="8" fill="#94a3b8">
            {new Date(e.encounter_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}
          </text>
        ))}
        {/* Lines */}
        {lines.map(({ key, color }) => {
          const d = makePath(key)
          if (!d) return null
          return (
            <g key={key}>
              <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
              {pts.map((e, i) => {
                const v = Number(e[key]) || null
                if (v === null) return null
                const vals = pts.map(p => Number(p[key]) || null).filter(Boolean) as number[]
                const minV = Math.min(...vals)*0.95; const maxV = Math.max(...vals)*1.05; const range=maxV-minV||1
                const x = PAD.l + (i/(pts.length-1))*chartW
                const y = PAD.t + chartH - ((v-minV)/range)*chartH
                return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.5" fill={color} stroke="white" strokeWidth="1"/>
              })}
            </g>
          )
        })}
      </svg>
      {/* Legend */}
      <div className="flex gap-4 justify-center mt-1">
        {lines.map(({ key, label, color, unit }) => {
          const last = [...pts].reverse().find(e => Number(e[key]))
          return last ? (
            <div key={key} className="flex items-center gap-1 text-xs text-gray-500">
              <span className="w-3 h-0.5 rounded inline-block" style={{ background: color }}/>
              {label}: <strong style={{ color }}>{Number(last[key])}{unit}</strong>
            </div>
          ) : null
        })}
      </div>
    </div>
  )
}

const BLOOD_COLOR: Record<string, string> = {
  'A+':'badge-red','A-':'badge-red','B+':'badge-blue','B-':'badge-blue',
  'O+':'badge-green','O-':'badge-green','AB+':'badge-yellow','AB-':'badge-yellow'
}

type Tab = 'overview' | 'visits' | 'prescriptions' | 'discharge' | 'billing' | 'labs' | 'files'

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()

  const [patient,       setPatient]       = useState<Patient | null>(null)
  const [encounters,    setEncounters]    = useState<Encounter[]>([])
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [discharges,    setDischarges]    = useState<DischargeSummary[]>([])
  const [bills,         setBills]         = useState<any[]>([])
  const [labReports,    setLabReports]    = useState<any[]>([])
  const [loading,       setLoading]       = useState(true)
  const [activeTab,     setActiveTab]     = useState<Tab>('overview')
  const [fhirExporting, setFhirExporting] = useState(false)

  // AI summary state
  const [summary,       setSummary]       = useState('')
  const [summaryState,  setSummaryState]  = useState<'idle'|'loading'|'done'|'error'>('idle')
  const [summaryError,  setSummaryError]  = useState('')

  useEffect(() => { if (id) loadAll() }, [id])
  useEffect(() => {
    // Labs stored in localStorage keyed by patient_id
    try {
      const all = JSON.parse(localStorage.getItem('nexmedicon_labs') || '[]')
      setLabReports(all.filter((r: any) => r.patient_id === id))
    } catch {}
  }, [id])

  async function loadAll() {
    setLoading(true)
    const [{ data: p }, { data: enc }, { data: rx }, { data: ds }, { data: bills }] = await Promise.all([
      supabase.from('patients').select('*').eq('id', id).single(),
      supabase.from('encounters').select('*').eq('patient_id', id).order('encounter_date', { ascending: false }),
      supabase.from('prescriptions').select('*').eq('patient_id', id).order('created_at', { ascending: false }),
      supabase.from('discharge_summaries').select('*').eq('patient_id', id).order('created_at', { ascending: false }),
      supabase.from('bills').select('*').eq('patient_id', id).order('created_at', { ascending: false }).limit(20),
    ])
    setPatient(p)
    setEncounters(enc || [])
    setPrescriptions(rx || [])
    setDischarges(ds || [])
    setBills((bills as any) || [])
    setLoading(false)
  }

  // Live age: prefer DOB calculation, fall back to stored age
  function displayAge(p: Patient): string {
    const live = ageFromDOB(p.date_of_birth)
    if (live !== null) return `${live} years`
    if (p.age)         return `${p.age} years`
    return '—'
  }

  async function generateSummary() {
    if (!patient) return
    setSummaryState('loading')
    setSummaryError('')
    try {
      const res = await fetch('/api/patient-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient, encounters, prescriptions, discharges }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setSummary(data.summary)
      setSummaryState('done')
    } catch (e: any) {
      setSummaryError(e.message || 'Summary failed. Try again.')
      setSummaryState('error')
    }
  }

  if (loading) return (
    <AppShell><div className="p-6 flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div></AppShell>
  )

  if (!patient) return (
    <AppShell><div className="p-6 text-center py-20">
      <p className="text-gray-500">Patient not found.</p>
      <Link href="/patients" className="text-blue-600 text-sm hover:underline mt-2 block">← Back to patients</Link>
    </div></AppShell>
  )

  return (
    <AppShell>
      <div className="p-6">

        {/* Breadcrumb */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-sm text-gray-400">
            <Link href="/patients" className="hover:text-blue-600">Patients</Link>
            <span className="mx-2">/</span>
            <span className="text-gray-700 font-medium">{patient.full_name}</span>
          </div>
        </div>

        {/* Patient Header Card */}
        <div className="card p-6 mb-5">
          <div className="flex items-start gap-5">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center flex-shrink-0">
              <span className="text-2xl font-bold text-blue-700">{patient.full_name.charAt(0)}</span>
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{patient.full_name}</h1>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="badge-blue font-mono text-xs">{patient.mrn}</span>
                    {patient.gender && <span className="badge-gray">{patient.gender}</span>}
                    <span className="text-sm text-gray-500">{displayAge(patient)}</span>
                    {patient.blood_group && (
                      <span className={BLOOD_COLOR[patient.blood_group] || 'badge-gray'}>
                        <Droplets className="w-3 h-3 inline mr-1" />{patient.blood_group}
                      </span>
                    )}
                  </div>
                </div>
                {/* Action buttons */}
                <div className="flex gap-2 flex-wrap justify-end">
                  <Link href={`/opd/new?patient=${patient.id}`}
                    className="btn-primary flex items-center gap-2 text-xs">
                    <Stethoscope className="w-3.5 h-3.5" /> New Consultation
                  </Link>
                  <Link href={`/appointments?patientId=${patient.id}&patientName=${encodeURIComponent(patient.full_name)}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors">
                    <Calendar className="w-4 h-4"/> Book Appointment
                  </Link>
                  {bills.length === 0 && (
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 font-medium w-full">
                      <span>⚠️</span>
                      <span>No payment recorded yet</span>
                      <Link href={`/billing?patientId=${patient.id}&patientName=${encodeURIComponent(patient.full_name)}&mrn=${patient.mrn}`}
                        className="ml-auto text-amber-700 underline hover:text-amber-900" onClick={e=>e.stopPropagation()}>
                        Collect Payment
                      </Link>
                    </div>
                  )}
                  <Link href={`/patients/${patient.id}/discharge`}
                    className="btn-secondary flex items-center gap-2 text-xs bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100">
                    <FileText className="w-3.5 h-3.5" /> Discharge Summary
                  </Link>
                  <button
                    onClick={async () => {
                      setFhirExporting(true)
                      try {
                        const res = await fetch(`/api/fhir/patient/${patient.id}`)
                        const bundle = await res.json()
                        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `${patient.mrn}_FHIR_Bundle.json`
                        a.click()
                        URL.revokeObjectURL(url)
                      } catch {} finally { setFhirExporting(false) }
                    }}
                    disabled={fhirExporting}
                    className="btn-secondary flex items-center gap-2 text-xs bg-green-50 border-green-200 text-green-700 hover:bg-green-100 disabled:opacity-50"
                    title="Export patient record as HL7 FHIR R4 Bundle"
                  >
                    {fhirExporting
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Download className="w-3.5 h-3.5" />}
                    FHIR Export
                  </button>
                  <Link href={`/patients/${patient.id}/edit`}
                    className="btn-secondary flex items-center gap-2 text-xs">
                    <Edit className="w-3.5 h-3.5" /> Edit
                  </Link>
                </div>
              </div>

              {/* Detail row */}
              <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Mobile</div>
                  <div className="text-sm font-medium text-gray-700 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-gray-400" />{patient.mobile}
                  </div>
                </div>
                {patient.date_of_birth && (
                  <div>
                    <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Date of Birth</div>
                    <div className="text-sm font-medium text-gray-700 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-gray-400" />{formatDate(patient.date_of_birth)}
                    </div>
                  </div>
                )}
                {(patient as any).aadhaar_no && (
                  <div>
                    <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Aadhaar No</div>
                    <div className="text-sm font-mono font-medium text-gray-700">{(patient as any).aadhaar_no}</div>
                  </div>
                )}
                {patient.abha_id && (
                  <div>
                    <div className="text-xs text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                      <Shield className="w-3 h-3 text-green-500" /> ABHA ID
                    </div>
                    <div className="text-sm font-mono font-medium text-green-700">{patient.abha_id}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Registered</div>
                  <div className="text-sm font-medium text-gray-700">{formatDate(patient.created_at)}</div>
                </div>
              </div>

              {(patient as any).mediclaim && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-gray-400 w-28 flex-shrink-0">Insurance</span>
                  <span className="font-medium text-green-700">
                    Mediclaim ✓{(patient as any).cashless ? ' · Cashless' : ''}
                  </span>
                </div>
              )}
              {(patient as any).reference_source && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-gray-400 w-28 flex-shrink-0">Referred by</span>
                  <span className="font-medium text-gray-700">{(patient as any).reference_source}</span>
                </div>
              )}
              {patient.emergency_contact_name && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-sm text-gray-500">
                  <User className="w-3.5 h-3.5" />
                  Emergency: <strong className="text-gray-700">{patient.emergency_contact_name}</strong>
                  {patient.emergency_contact_phone && (
                    <span className="font-mono text-gray-600">· {patient.emergency_contact_phone}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══ CLINICAL RISK ALERT ═══════════════════════════════ */}
        {(() => {
          // Compute risk from latest encounter
          const latestEnc = encounters[0]
          if (!latestEnc) return null

          const hasOB = latestEnc.ob_data && Object.keys(latestEnc.ob_data as object).length > 0
          const ob = (latestEnc.ob_data || {}) as any

          // Run obstetric risk if patient has OB data
          let riskResult: RiskAssessment | null = null
          if (hasOB && ob.lmp) {
            riskResult = assessObstetricRisk({
              age: patient.age || undefined,
              bp_systolic: latestEnc.bp_systolic || undefined,
              bp_diastolic: latestEnc.bp_diastolic || undefined,
              ob_data: ob,
              haemoglobin: ob.haemoglobin,
            })
          }

          // Also check vital signs for all patients
          const vitalFlags = assessVitalRisk({
            bp_systolic: latestEnc.bp_systolic || undefined,
            bp_diastolic: latestEnc.bp_diastolic || undefined,
            pulse: latestEnc.pulse || undefined,
            temperature: latestEnc.temperature ? Number(latestEnc.temperature) : undefined,
            spo2: latestEnc.spo2 || undefined,
          })

          // Combine all flags
          const allFlags = [...(riskResult?.flags || []), ...vitalFlags]
          // Deduplicate by category (obstetric BP check may overlap with vital BP check)
          const seen = new Set<string>()
          const uniqueFlags = allFlags.filter(f => {
            if (seen.has(f.category)) return false
            seen.add(f.category)
            return true
          })

          if (uniqueFlags.length === 0) return null

          const hasCritical = uniqueFlags.some(f => f.level === 'critical')
          const hasHigh = uniqueFlags.some(f => f.level === 'high')
          const overallStyle = hasCritical
            ? riskLevelStyle('critical')
            : hasHigh
            ? riskLevelStyle('high')
            : riskLevelStyle('watch')

          return (
            <div className={`mb-5 rounded-xl border-2 ${overallStyle.border} ${overallStyle.bg} p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className={`w-5 h-5 ${overallStyle.text}`} />
                <h3 className={`font-bold text-sm ${overallStyle.text}`}>
                  {hasCritical ? '🚨 CRITICAL RISK ALERTS' : hasHigh ? '⚠️ HIGH RISK ALERTS' : '👁️ CLINICAL WATCH'}
                </h3>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${overallStyle.bg} ${overallStyle.text} border ${overallStyle.border}`}>
                  {uniqueFlags.length} flag{uniqueFlags.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-1.5">
                {uniqueFlags.map((flag, i) => {
                  const style = riskLevelStyle(flag.level)
                  return (
                    <div key={i} className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${style.bg} border ${style.border}`}>
                      <span className="flex-shrink-0 mt-0.5">{style.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <span className={`font-semibold ${style.text}`}>{flag.category}:</span>{' '}
                        <span className="text-gray-700">{flag.message}</span>
                        {flag.action && (
                          <div className="text-xs text-gray-500 mt-0.5 italic">→ {flag.action}</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Based on latest consultation ({formatDate(latestEnc.encounter_date)}). Auto-assessed from vitals and clinical data.
              </p>
            </div>
          )
        })()}

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4 mb-5">
          {[
            { icon: Stethoscope, color: 'blue',   val: encounters.length,    label: 'Total Visits' },
            { icon: Pill,        color: 'green',  val: prescriptions.length, label: 'Prescriptions' },
            { icon: FileText,    color: 'purple', val: discharges.length,    label: 'Discharge Summaries' },
            { icon: Calendar,    color: 'orange', val: null,                 label: 'Next Follow-up',
              extra: prescriptions[0]?.follow_up_date ? formatDate(prescriptions[0].follow_up_date) : '—' },
          ].map(({ icon: Icon, color, val, label, extra }) => (
            <div key={label} className="card p-4 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center
                ${color==='blue'?'bg-blue-50':color==='green'?'bg-green-50':color==='purple'?'bg-purple-50':'bg-orange-50'}`}>
                <Icon className={`w-5 h-5
                  ${color==='blue'?'text-blue-600':color==='green'?'text-green-600':color==='purple'?'text-purple-600':'text-orange-600'}`} />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{val !== null ? val : extra}</div>
                <div className="text-xs text-gray-400">{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="card overflow-hidden">
          <div className="flex border-b border-gray-100">
            {([
              { id:'overview',      label:'Overview' },
              { id:'visits',        label:`Visits (${encounters.length})` },
              { id:'prescriptions', label:`Prescriptions (${prescriptions.length})` },
              { id:'discharge',     label:`Discharge (${discharges.length})` },
              { id:'billing',       label:`Bills (${bills.length})` },
              { id:'labs',          label:`Labs (${labReports.length})` },
              { id:'files',         label:'Files & Photos' },
            ] as {id:Tab;label:string}[]).map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`px-5 py-3 text-sm font-medium capitalize transition-colors
                  ${activeTab === t.id
                    ? 'border-b-2 border-blue-600 text-blue-700 bg-blue-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">

            {/* ── OVERVIEW ── */}
            {activeTab === 'overview' && (
              <div className="space-y-5">

                {/* AI Summary Card */}
                <div className={`rounded-xl border p-5 transition-colors
                  ${summaryState === 'done'
                    ? 'bg-purple-50 border-purple-200'
                    : 'bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-600" />
                      <span className="font-semibold text-sm text-gray-900">AI Clinical Summary</span>
                    </div>
                    <button onClick={generateSummary}
                      disabled={summaryState === 'loading' || encounters.length === 0}
                      className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60">
                      {summaryState === 'loading'
                        ? <><Loader2 className="w-3 h-3 animate-spin" />Generating...</>
                        : summaryState === 'done'
                        ? <><Sparkles className="w-3 h-3" />Regenerate</>
                        : <><Sparkles className="w-3 h-3" />Generate Summary</>}
                    </button>
                  </div>

                  {summaryState === 'idle' && (
                    <p className="text-xs text-gray-500">
                      {encounters.length === 0
                        ? 'No consultations yet. Add an OPD consultation first to generate a summary.'
                        : `Click "Generate Summary" to get an AI clinical overview based on ${encounters.length} visit(s) and ${prescriptions.length} prescription(s).`}
                    </p>
                  )}

                  {summaryState === 'loading' && (
                    <div className="flex items-center gap-2 text-xs text-purple-700">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Reading all consultations and generating clinical summary...
                    </div>
                  )}

                  {summaryState === 'error' && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />{summaryError}
                    </p>
                  )}

                  {summaryState === 'done' && summary && (
                    <p className="text-sm text-gray-800 leading-relaxed">{summary}</p>
                  )}
                </div>

                {/* Latest Consultation */}
                {encounters.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    <Stethoscope className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium mb-1">No consultations yet</p>
                    <Link href={`/opd/new?patient=${patient.id}`}
                      className="btn-primary inline-flex items-center gap-2 text-xs mt-2">
                      <Plus className="w-3.5 h-3.5" /> Start Consultation
                    </Link>
                  </div>
                ) : (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Latest Consultation</h3>
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="font-semibold text-gray-900">{formatDate(encounters[0].encounter_date)}</div>
                          <div className="text-xs text-gray-500">Dr. {encounters[0].doctor_name}</div>
                        </div>
                        <span className="badge-blue">{encounters[0].encounter_type}</span>
                      </div>
                      {encounters[0].chief_complaint && (
                        <div className="mb-2">
                          <div className="text-xs text-gray-400 uppercase tracking-wide">Chief Complaint</div>
                          <div className="text-sm text-gray-700">{encounters[0].chief_complaint}</div>
                        </div>
                      )}
                      {encounters[0].diagnosis && (
                        <div className="mb-2">
                          <div className="text-xs text-gray-400 uppercase tracking-wide">Diagnosis</div>
                          <div className="text-sm font-semibold text-gray-800">{encounters[0].diagnosis}</div>
                        </div>
                      )}
                      <div className="flex gap-3 flex-wrap mt-3 pt-3 border-t border-blue-200">
                        {encounters[0].pulse       && <span className="text-xs bg-white px-2 py-1 rounded border border-blue-100">❤️ {encounters[0].pulse} bpm</span>}
                        {encounters[0].bp_systolic && <span className="text-xs bg-white px-2 py-1 rounded border border-blue-100">🩸 {encounters[0].bp_systolic}/{encounters[0].bp_diastolic} mmHg</span>}
                        {encounters[0].temperature && <span className="text-xs bg-white px-2 py-1 rounded border border-blue-100">🌡️ {encounters[0].temperature}°C</span>}
                        {encounters[0].spo2        && <span className="text-xs bg-white px-2 py-1 rounded border border-blue-100">💨 SpO₂ {encounters[0].spo2}%</span>}
                        {encounters[0].weight      && <span className="text-xs bg-white px-2 py-1 rounded border border-blue-100">⚖️ {encounters[0].weight} kg</span>}
                      </div>
                      <Link href={`/opd/${encounters[0].id}`}
                        className="mt-3 inline-flex items-center text-xs text-blue-600 hover:underline gap-1">
                        View full consultation →
                      </Link>
                    </div>
                  </div>
                )}

                {/* Vitals Trends */}
                {encounters.filter(e => e.bp_systolic || e.pulse || e.weight).length >= 2 && (
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue-600"/> Vitals Trend
                    </h3>
                    <VitalsChart encounters={encounters}/>
                  </div>
                )}

                {/* USG Trend Timeline */}
                {(() => {
                  // Collect all encounters with USG data, oldest first
                  const usgEncs = [...encounters]
                    .filter(e => {
                      const ob = (e.ob_data || {}) as any
                      return ob.bpd || ob.hc || ob.ac || ob.fl || ob.afi || ob.efw
                    })
                    .reverse()

                  if (usgEncs.length === 0) return null

                  return (
                    <div className="card p-5">
                      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        📊 USG Trend Across Visits
                      </h3>
                      <p className="text-xs text-gray-400 mb-3">
                        Structured ultrasound parameters tracked across {usgEncs.length} visit{usgEncs.length > 1 ? 's' : ''}
                      </p>

                      {/* Trend table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-2 px-2 text-gray-500 font-semibold">Parameter</th>
                              {usgEncs.map((e, i) => {
                                const ob = (e.ob_data || {}) as any
                                return (
                                  <th key={e.id} className="text-center py-2 px-2 text-gray-500 font-semibold min-w-[80px]">
                                    <div>{ob.usg_ga || formatDate(e.encounter_date)}</div>
                                    <div className="text-gray-400 font-normal">{formatDate(e.encounter_date)}</div>
                                  </th>
                                )
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { key: 'afi', label: 'AFI (cm)', unit: 'cm', warn: (v: number) => v < 5 ? '🚨' : v < 8 ? '⚠️' : v > 25 ? '⚠️' : '' },
                              { key: 'efw', label: 'EFW (g)', unit: 'g', warn: (v: number) => v > 4000 ? '⚠️' : '' },
                              { key: 'bpd', label: 'BPD (mm)', unit: 'mm', warn: () => '' },
                              { key: 'hc', label: 'HC (mm)', unit: 'mm', warn: () => '' },
                              { key: 'ac', label: 'AC (mm)', unit: 'mm', warn: () => '' },
                              { key: 'fl', label: 'FL (mm)', unit: 'mm', warn: () => '' },
                              { key: 'placenta', label: 'Placenta', unit: '', warn: (v: any) => v === 'Previa' ? '🚨' : v === 'Low-lying' ? '⚠️' : '' },
                            ].map(param => {
                              const hasAny = usgEncs.some(e => (e.ob_data as any)?.[param.key])
                              if (!hasAny) return null
                              return (
                                <tr key={param.key} className="border-b border-gray-50 hover:bg-gray-50">
                                  <td className="py-2 px-2 font-semibold text-gray-700">{param.label}</td>
                                  {usgEncs.map(e => {
                                    const val = (e.ob_data as any)?.[param.key]
                                    const warning = val ? param.warn(val) : ''
                                    return (
                                      <td key={e.id} className={`text-center py-2 px-2 font-mono ${warning ? 'font-bold text-red-700' : 'text-gray-800'}`}>
                                        {val ? `${warning} ${val}` : '—'}
                                      </td>
                                    )
                                  })}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* AFI trend line (if multiple readings) */}
                      {(() => {
                        const afiData = usgEncs
                          .map(e => ({ date: e.encounter_date, ga: (e.ob_data as any)?.usg_ga, afi: (e.ob_data as any)?.afi }))
                          .filter(d => d.afi)
                        if (afiData.length < 2) return null

                        return (
                          <div className="mt-4 pt-4 border-t border-gray-100">
                            <h4 className="text-xs font-semibold text-gray-600 mb-2">📉 AFI Trend</h4>
                            <div className="flex items-end gap-1 h-20">
                              {afiData.map((d, i) => {
                                const maxAfi = Math.max(...afiData.map(x => x.afi))
                                const height = Math.max(8, (d.afi / Math.max(maxAfi, 25)) * 100)
                                const isLow = d.afi < 8
                                const isCritical = d.afi < 5
                                return (
                                  <div key={i} className="flex flex-col items-center flex-1" title={`${d.ga || formatDate(d.date)}: AFI ${d.afi} cm`}>
                                    <div className="text-xs font-mono font-bold mb-1" style={{ color: isCritical ? '#dc2626' : isLow ? '#ea580c' : '#059669' }}>
                                      {d.afi}
                                    </div>
                                    <div
                                      className={`w-full max-w-[40px] rounded-t ${isCritical ? 'bg-red-500' : isLow ? 'bg-orange-400' : 'bg-green-500'}`}
                                      style={{ height: `${height}%` }}
                                    />
                                    <div className="text-xs text-gray-400 mt-1 truncate w-full text-center">
                                      {d.ga || formatDate(d.date).slice(0, 6)}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                            <div className="flex justify-between text-xs text-gray-400 mt-1">
                              <span>Normal AFI: 8–25 cm</span>
                              <span className="text-red-500">{'< 5 cm = Oligohydramnios'}</span>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ── VISITS ── */}
            {activeTab === 'visits' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-semibold text-gray-700">All Consultations</h3>
                  <Link href={`/opd/new?patient=${patient.id}`} className="btn-primary text-xs flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> New
                  </Link>
                </div>
                {encounters.length === 0
                  ? <p className="text-center text-gray-400 py-8 text-sm">No visits recorded yet.</p>
                  : (
                    <div className="space-y-3">
                      {encounters.map(enc => (
                        <Link key={enc.id} href={`/opd/${enc.id}`}
                          className="block border border-gray-100 rounded-lg p-4 hover:bg-gray-50 hover:border-blue-200 transition-all">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm text-gray-900">{formatDate(enc.encounter_date)}</span>
                                <span className="badge-blue text-xs">{enc.encounter_type}</span>
                              </div>
                              {enc.chief_complaint && <p className="text-sm text-gray-600">{enc.chief_complaint}</p>}
                              {enc.diagnosis && <p className="text-xs text-blue-700 font-medium mt-1">Dx: {enc.diagnosis}</p>}
                              {enc.procedures && (enc.procedures as any[]).length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {(enc.procedures as any[]).map((proc: any, i: number) => (
                                    <span key={i} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">
                                      🔪 {proc.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 ml-4">{formatDateTime(enc.created_at).split(',')[0]}</div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
              </div>
            )}

            {/* ── PRESCRIPTIONS ── */}
            {activeTab === 'prescriptions' && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Prescription History</h3>
                {prescriptions.length === 0
                  ? <p className="text-center text-gray-400 py-8 text-sm">No prescriptions yet.</p>
                  : (
                    <div className="space-y-3">
                      {prescriptions.map(rx => (
                        <Link key={rx.id} href={`/opd/${rx.encounter_id}/prescription`}
                          className="block border border-gray-100 rounded-lg p-4 hover:bg-gray-50 transition-all">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <Pill className="w-4 h-4 text-green-600" />
                              <span className="font-semibold text-sm text-gray-900">{formatDate(rx.created_at)}</span>
                            </div>
                            <div className="flex gap-2">
                              {rx.follow_up_date && <span className="badge-yellow text-xs">FU: {formatDate(rx.follow_up_date)}</span>}
                              <Printer className="w-4 h-4 text-gray-400 hover:text-blue-600" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            {Array.isArray(rx.medications) && rx.medications.slice(0,3).map((med:any,i:number)=>(
                              <div key={i} className="text-xs text-gray-600">
                                <span className="font-medium">{med.drug}</span> — {med.dose} · {med.frequency} · {med.duration}
                              </div>
                            ))}
                            {Array.isArray(rx.medications) && rx.medications.length > 3 && (
                              <div className="text-xs text-gray-400">+{rx.medications.length-3} more</div>
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
              </div>
            )}

            {/* ── BILLING ── */}
            {activeTab === 'billing' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-semibold text-gray-700">Payment History</h3>
                  <Link href="/billing" className="btn-primary text-xs flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5"/> New Bill
                  </Link>
                </div>
                {bills.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    <IndianRupee className="w-10 h-10 mx-auto mb-3 opacity-20"/>
                    <p className="font-medium mb-1">No bills yet</p>
                    <Link href="/billing" className="btn-primary inline-flex items-center gap-2 text-xs mt-2">
                      <Plus className="w-3.5 h-3.5"/> Create Bill
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {bills.map((bill: any) => (
                      <div key={bill.id} className="border border-gray-100 rounded-lg p-4 hover:bg-gray-50">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-gray-900">₹{Number(bill.net_amount).toLocaleString('en-IN')}</div>
                            <div className="text-xs text-gray-400">{formatDate(bill.created_at)} · {bill.payment_mode}</div>
                          </div>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            bill.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                          }`}>{bill.status}</span>
                        </div>
                        {Array.isArray(bill.items) && (
                          <div className="text-xs text-gray-500 mt-1 truncate">
                            {bill.items.map((i: any) => i.label).join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── FILES ── */}
            {activeTab === 'files' && (
              <ConsultationAttachments patientId={patient.id} />
            )}

            {/* ── DISCHARGE ── */}
            {activeTab === 'discharge' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-semibold text-gray-700">Discharge Summaries</h3>
                  <Link href={`/patients/${patient.id}/discharge`} className="btn-primary text-xs flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> New / Edit
                  </Link>
                </div>
                {discharges.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium mb-1">No discharge summary yet</p>
                    <p className="text-xs mb-4">AI can auto-generate one from consultation history.</p>
                    <Link href={`/patients/${patient.id}/discharge`}
                      className="btn-primary inline-flex items-center gap-2 text-xs">
                      <FileText className="w-3.5 h-3.5" /> Create Discharge Summary
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {discharges.map(ds => (
                      <Link key={ds.id} href={`/patients/${patient.id}/discharge`}
                        className="block border border-gray-100 rounded-lg p-4 hover:bg-purple-50 hover:border-purple-200 transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-purple-600" />
                            <span className="font-semibold text-sm text-gray-900">
                              Discharge: {ds.discharge_date ? formatDate(ds.discharge_date) : formatDate(ds.created_at)}
                            </span>
                            {ds.is_final && (
                              <span className="badge-green text-xs flex items-center gap-1">
                                <CheckCircle className="w-2.5 h-2.5" /> Finalised
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">v{ds.version}</span>
                        </div>
                        {ds.final_diagnosis && <p className="text-sm font-medium text-gray-800 mb-1">Dx: {ds.final_diagnosis}</p>}
                        {ds.clinical_summary && <p className="text-xs text-gray-500 line-clamp-2">{ds.clinical_summary}</p>}
                        {ds.signed_by && <p className="text-xs text-gray-400 mt-1">Signed by: {ds.signed_by}</p>}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </AppShell>
  )
}
