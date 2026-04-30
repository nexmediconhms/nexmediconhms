'use client'
/**
 * src/app/opd/[id]/edit/page.tsx  — UPDATED
 *
 * Critical Changes vs original:
 *  1. Critical vitals alerts WIRED IN — checkCriticalValues() is called
 *     on every vitals change (blur) and on Save. If a critical value is
 *     detected (e.g. BP 180/120, SpO2 < 90, Hb < 6), a red alert banner
 *     appears immediately. Saving is NOT blocked (doctor can still save)
 *     but the alert is logged to audit_log as 'critical_alert'.
 *  2. Real-time vitals indicator — each vital field turns red/amber when
 *     the entered value is outside the safe range.
 *  3. All original OPD edit logic preserved unchanged.
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import FormScanner from '@/components/shared/FormScanner'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings } from '@/lib/utils'
import { checkCriticalValues } from '@/lib/critical-alerts'
import { audit, auditSafetyOverride } from '@/lib/audit'
import type { OCRResult } from '@/lib/ocr'
import {
  Save, ArrowLeft, CheckCircle, AlertTriangle, X,
  Activity, Heart, Thermometer, Wind, Weight
} from 'lucide-react'

// ── Vital field ranges for inline color coding ─────────────────
const VITAL_RANGES: Record<string, { warn: [number, number]; critical: [number, number] }> = {
  bp_systolic:  { warn: [100, 160], critical: [80, 180] },
  bp_diastolic: { warn: [60,  100], critical: [50,  110] },
  pulse:        { warn: [60,  100], critical: [40,  140] },
  spo2:         { warn: [94,  100], critical: [90,  100] },
  temperature:  { warn: [36.1, 37.5], critical: [35, 38.5] },
}

function vitalClass(field: string, value: string): string {
  const num = parseFloat(value)
  if (!value || isNaN(num)) return 'input'
  const range = VITAL_RANGES[field]
  if (!range) return 'input'
  if (num < range.critical[0] || num > range.critical[1]) return 'input border-red-500 bg-red-50 text-red-900 focus:ring-red-300'
  if (num < range.warn[0]     || num > range.warn[1])     return 'input border-amber-400 bg-amber-50 text-amber-900 focus:ring-amber-300'
  return 'input border-green-400'
}

export default function OPDEditPage() {
  const { id: encounterId } = useParams<{ id: string }>()
  const router = useRouter()

  const [encounter, setEncounter] = useState<any>(null)
  const [patient,   setPatient]   = useState<any>(null)
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [error,     setError]     = useState('')

  // Vitals
  const [pulse,       setPulse]       = useState('')
  const [bpSys,       setBpSys]       = useState('')
  const [bpDia,       setBpDia]       = useState('')
  const [temperature, setTemperature] = useState('')
  const [spo2,        setSpo2]        = useState('')
  const [weight,      setWeight]      = useState('')
  const [height,      setHeight]      = useState('')
  const [painScale,   setPainScale]   = useState('')

  // Clinical
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [hpi,            setHpi]            = useState('')
  const [diagnosis,      setDiagnosis]      = useState('')
  const [clinicalNotes,  setClinicalNotes]  = useState('')
  const [encounterType,  setEncounterType]  = useState('OPD Consultation')
  const [obData,         setObData]         = useState<any>({})

  // Critical alert state
  const [criticalAlerts, setCriticalAlerts] = useState<string[]>([])
  const [alertDismissed, setAlertDismissed] = useState(false)

  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  // ── Load ───────────────────────────────────────────────────
  useEffect(() => {
    if (encounterId) loadData()
  }, [encounterId])

  async function loadData() {
    const { data: enc } = await supabase
      .from('encounters')
      .select('*, patients(*)')
      .eq('id', encounterId)
      .single()

    if (!enc) { setLoading(false); return }

    setEncounter(enc)
    setPatient(enc.patients)

    // Populate form fields
    setPulse(enc.pulse?.toString() ?? '')
    setBpSys(enc.bp_systolic?.toString() ?? '')
    setBpDia(enc.bp_diastolic?.toString() ?? '')
    setTemperature(enc.temperature?.toString() ?? '')
    setSpo2(enc.spo2?.toString() ?? '')
    setWeight(enc.weight?.toString() ?? '')
    setHeight(enc.height?.toString() ?? '')
    setPainScale(enc.pain_scale?.toString() ?? '')
    setChiefComplaint(enc.chief_complaint ?? '')
    setHpi(enc.hpi ?? '')
    setDiagnosis(enc.diagnosis ?? '')
    setClinicalNotes(enc.clinical_notes ?? '')
    setEncounterType(enc.encounter_type ?? 'OPD Consultation')
    setObData(enc.ob_data ?? {})

    setLoading(false)
  }

  // ── Critical vitals check ──────────────────────────────────
  const runCriticalCheck = useCallback(() => {
    const vitals = {
      bp_systolic:  parseFloat(bpSys)       || undefined,
      bp_diastolic: parseFloat(bpDia)       || undefined,
      pulse:        parseFloat(pulse)        || undefined,
      spo2:         parseFloat(spo2)         || undefined,
      temperature:  parseFloat(temperature) || undefined,
      weight:       parseFloat(weight)       || undefined,
    }

    const result = checkCriticalValues(vitals, { patientAge: patient?.age })

    if (result.hasCritical) {
      setCriticalAlerts(result.alerts.map(a => a.message))
      setAlertDismissed(false)
    } else {
      setCriticalAlerts([])
    }

    return result
  }, [bpSys, bpDia, pulse, spo2, temperature, weight, patient])

  // Run on any vital field blur
  function handleVitalBlur() {
    runCriticalCheck()
  }

  // ── OCR handler ────────────────────────────────────────────
  function handleOCR(result: OCRResult) {
    if (result.vitals) {
      const v = result.vitals
      if (v.pulse)            setPulse(v.pulse.toString())
      if (v.bp_systolic)      setBpSys(v.bp_systolic.toString())
      if (v.bp_diastolic)     setBpDia(v.bp_diastolic.toString())
      if (v.temperature)      setTemperature(v.temperature.toString())
      if (v.spo2)             setSpo2(v.spo2.toString())
      if (v.weight)           setWeight(v.weight.toString())
    }
    if (result.clinical) {
      const c = result.clinical
      if (c.chief_complaint)  setChiefComplaint(c.chief_complaint)
      if (c.diagnosis)        setDiagnosis(c.diagnosis)
      if (c.clinical_notes)   setClinicalNotes(c.clinical_notes)
    }
  }

  // ── Save ───────────────────────────────────────────────────
  async function handleSave() {
    if (!encounterId || !patient) return
    setSaving(true)
    setError('')

    // Run critical check before save
    const critResult = runCriticalCheck()

    const payload = {
      pulse:           pulse        ? parseInt(pulse)       : null,
      bp_systolic:     bpSys        ? parseInt(bpSys)       : null,
      bp_diastolic:    bpDia        ? parseInt(bpDia)       : null,
      temperature:     temperature  ? parseFloat(temperature) : null,
      spo2:            spo2         ? parseFloat(spo2)      : null,
      weight:          weight       ? parseFloat(weight)    : null,
      height:          height       ? parseFloat(height)    : null,
      pain_scale:      painScale    ? parseInt(painScale)   : null,
      chief_complaint: chiefComplaint.trim() || null,
      hpi:             hpi.trim()            || null,
      diagnosis:       diagnosis.trim()      || null,
      clinical_notes:  clinicalNotes.trim()  || null,
      encounter_type:  encounterType,
      ob_data:         Object.keys(obData).length ? obData : null,
      updated_at:      new Date().toISOString(),
    }

    const { error: saveError } = await supabase
      .from('encounters')
      .update(payload)
      .eq('id', encounterId)

    if (saveError) {
      setError(saveError.message)
      setSaving(false)
      return
    }

    // Audit: encounter update
    await audit('update', 'encounter', encounterId, patient.full_name)

    // Audit: critical vitals if any were detected
    if (critResult.hasCritical) {
      await auditSafetyOverride(
        'critical_alert',
        encounterId,
        patient.full_name,
        {
          alerts: critResult.alerts.map(a => ({ level: a.level, message: a.message, value: a.value })),
          vitals: { bpSys, bpDia, pulse, spo2, temperature },
        }
      )
    }

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) {
    return (
      <AppShell>
        <div className="p-6 flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    )
  }

  if (!encounter || !patient) {
    return (
      <AppShell>
        <div className="p-6 text-center text-gray-500">
          <p>Encounter not found.</p>
          <button onClick={() => router.back()} className="btn-secondary mt-4">Go Back</button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">Edit Vitals & Diagnosis</h1>
            <p className="text-sm text-gray-500">
              {patient.full_name} · {patient.mrn} · {formatDate(encounter.encounter_date)}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/opd/${encounterId}/prescription`}
              className="btn-secondary flex items-center gap-1.5 text-xs">
              💊 Prescription
            </Link>
            <button onClick={handleSave} disabled={saving}
              className={`flex items-center gap-2 text-xs px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-60
                ${saved ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
              {saving
                ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : saved ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* ── CRITICAL VITALS ALERT BANNER ─────────────────── */}
        {criticalAlerts.length > 0 && !alertDismissed && (
          <div className="mb-5 bg-red-50 border-2 border-red-400 rounded-xl p-4 flex items-start gap-3 shadow-sm">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div className="flex-1">
              <div className="font-bold text-red-800 text-sm mb-1 flex items-center gap-2">
                🚨 Critical Vitals Detected
                <span className="text-xs font-normal text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                  Logged to audit trail
                </span>
              </div>
              <ul className="space-y-0.5">
                {criticalAlerts.map((a, i) => (
                  <li key={i} className="text-sm text-red-700 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                    {a}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-red-600 mt-2 font-medium">
                ⚠️ Please verify these values and take appropriate clinical action.
                This alert will be recorded in the patient's audit log.
              </p>
            </div>
            <button onClick={() => setAlertDismissed(true)}
              className="text-red-400 hover:text-red-600 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* OCR Scanner */}
        <FormScanner
          formType="vitals"
          onExtracted={handleOCR}
          label="Scan Vitals Form — auto-fills readings"
          className="mb-5"
        />

        {/* Visit Type */}
        <div className="card p-5 mb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Visit Type</label>
              <select className="input" value={encounterType} onChange={e => setEncounterType(e.target.value)}>
                {['OPD Consultation', 'ANC Visit', 'Post-op Review', 'Emergency', 'Follow-up', 'Procedure', 'Discharge Review'].map(t => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Pain Scale (0–10)</label>
              <input className="input" type="number" min="0" max="10" placeholder="0–10"
                value={painScale} onChange={e => setPainScale(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Vitals */}
        <div className="card p-5 mb-4">
          <h2 className="section-title flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-500" /> Vitals
            <span className="text-xs font-normal text-gray-400 ml-auto">
              Fields turn amber (warning) or red (critical) based on value
            </span>
          </h2>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="label flex items-center gap-1">
                <Heart className="w-3 h-3 text-red-400" /> Pulse (bpm)
              </label>
              <input className={vitalClass('pulse', pulse)}
                type="number" placeholder="72"
                value={pulse}
                onChange={e => setPulse(e.target.value)}
                onBlur={handleVitalBlur} />
            </div>
            <div>
              <label className="label">Systolic BP (mmHg)</label>
              <input className={vitalClass('bp_systolic', bpSys)}
                type="number" placeholder="120"
                value={bpSys}
                onChange={e => setBpSys(e.target.value)}
                onBlur={handleVitalBlur} />
            </div>
            <div>
              <label className="label">Diastolic BP (mmHg)</label>
              <input className={vitalClass('bp_diastolic', bpDia)}
                type="number" placeholder="80"
                value={bpDia}
                onChange={e => setBpDia(e.target.value)}
                onBlur={handleVitalBlur} />
            </div>
            <div>
              <label className="label flex items-center gap-1">
                <Wind className="w-3 h-3 text-blue-400" /> SpO₂ (%)
              </label>
              <input className={vitalClass('spo2', spo2)}
                type="number" placeholder="98"
                value={spo2}
                onChange={e => setSpo2(e.target.value)}
                onBlur={handleVitalBlur} />
            </div>
            <div>
              <label className="label flex items-center gap-1">
                <Thermometer className="w-3 h-3 text-orange-400" /> Temperature (°C)
              </label>
              <input className={vitalClass('temperature', temperature)}
                type="number" step="0.1" placeholder="36.8"
                value={temperature}
                onChange={e => setTemperature(e.target.value)}
                onBlur={handleVitalBlur} />
            </div>
            <div>
              <label className="label flex items-center gap-1">
                <Weight className="w-3 h-3 text-purple-400" /> Weight (kg)
              </label>
              <input className="input" type="number" step="0.1" placeholder="60"
                value={weight}
                onChange={e => setWeight(e.target.value)} />
            </div>
            <div>
              <label className="label">Height (cm)</label>
              <input className="input" type="number" placeholder="160"
                value={height}
                onChange={e => setHeight(e.target.value)} />
            </div>
          </div>

          {/* Vital status legend */}
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-green-400 inline-block" /> Normal
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-400 inline-block" /> Warning
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-red-500 inline-block" /> Critical — alert logged
            </span>
          </div>
        </div>

        {/* Clinical Notes */}
        <div className="card p-5 mb-4">
          <h2 className="section-title">Clinical Notes</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Chief Complaint</label>
              <textarea className="input resize-none" rows={3}
                placeholder="e.g. Vaginal bleeding since 3 days…"
                value={chiefComplaint} onChange={e => setChiefComplaint(e.target.value)} />
            </div>
            <div>
              <label className="label">History of Present Illness</label>
              <textarea className="input resize-none" rows={3}
                placeholder="HPI details…"
                value={hpi} onChange={e => setHpi(e.target.value)} />
            </div>
            <div>
              <label className="label">Diagnosis / Impression</label>
              <textarea className="input resize-none" rows={3}
                placeholder="e.g. Threatened abortion at 8 weeks…"
                value={diagnosis} onChange={e => setDiagnosis(e.target.value)} />
            </div>
            <div>
              <label className="label">Clinical Notes / Findings</label>
              <textarea className="input resize-none" rows={3}
                placeholder="Examination findings, clinical observations…"
                value={clinicalNotes} onChange={e => setClinicalNotes(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Bottom save */}
        <div className="flex justify-end gap-3">
          <button onClick={() => router.back()} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="btn-primary flex items-center gap-2 disabled:opacity-60">
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : saved ? <CheckCircle className="w-4 h-4" />
              : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>
    </AppShell>
  )
}