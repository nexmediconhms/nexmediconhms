'use client'
import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import FormScanner from '@/components/shared/FormScanner'
import { supabase } from '@/lib/supabase'
import type { OCRResult } from '@/lib/ocr'
import { UserPlus, CheckCircle, AlertCircle, ArrowLeft, ScanLine } from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────
const BLOOD_GROUPS = ['A+','A-','B+','B-','O+','O-','AB+','AB-']
const GENDERS      = ['Female','Male','Other']

// ─── Form state type ──────────────────────────────────────────
interface FormData {
  full_name:               string
  age:                     string
  date_of_birth:           string
  gender:                  string
  mobile:                  string
  blood_group:             string
  address:                 string
  abha_id:                 string
  aadhaar_no:              string
  emergency_contact_name:  string
  emergency_contact_phone: string
  mediclaim:               string   // 'Yes'|'No'
  cashless:                string   // 'Yes'|'No'
  reference_source:        string   // referral source
  reference_detail:        string   // specific name (doctor name, etc.)
}

const EMPTY: FormData = {
  full_name: '', age: '', date_of_birth: '', gender: 'Female',
  mobile: '', blood_group: '', address: '', abha_id: '', aadhaar_no: '',
  emergency_contact_name: '', emergency_contact_phone: '',
  mediclaim: 'No', cashless: 'No', reference_source: '', reference_detail: '',
}

// ─── Tracks which fields were filled by OCR so we can highlight them ──
type HighlightedFields = Partial<Record<keyof FormData, boolean>>

export default function NewPatientPage() {
  const router = useRouter()

  const [form,       setForm]       = useState<FormData>(EMPTY)
  const [errors,     setErrors]     = useState<Partial<FormData>>({})
  const [saving,     setSaving]     = useState(false)
  const [success,    setSuccess]    = useState<{ mrn: string; name: string } | null>(null)
  const [successId,     setSuccessId]     = useState<string>('')
  const [successMobile, setSuccessMobile] = useState<string>('')
  const [payLink,       setPayLink]       = useState<{url?:string;whatsappText:string;type:string}|null>(null)
  const [payLinkLoading,setPayLinkLoading]= useState(false)
  const [highlighted,   setHighlighted]   = useState<HighlightedFields>({})

  // ── Load OCR prefill from forms page scanner ─────────────────
  useEffect(() => {
    try {
      const prefillParam = new URLSearchParams(window.location.search).get('prefill')
      const key    = 'ocr_prefill_generic'
      const stored = sessionStorage.getItem(key)
      if (!stored || !prefillParam) return
      const ocr    = JSON.parse(stored)
      const p      = ocr.patient ?? {}
      const hl: HighlightedFields = {}
      const apply = (field: keyof typeof EMPTY, val: string | undefined) => {
        if (!val) return
        setForm(prev => ({ ...prev, [field]: val }))
        hl[field] = true
      }
      apply('full_name',               p.full_name)
      apply('mobile',                  p.mobile)
      apply('age',                     p.age)
      apply('date_of_birth',           p.date_of_birth)
      apply('gender',                  p.gender)
      apply('blood_group',             p.blood_group)
      apply('address',                 p.address)
      apply('abha_id',                 p.abha_id)
      apply('aadhaar_no',              p.aadhaar_no)
      apply('emergency_contact_name',  p.emergency_contact_name)
      apply('emergency_contact_phone', p.emergency_contact_phone)
      // Mediclaim / Cashless
      if (p.mediclaim) {
        const v = p.mediclaim.trim().toLowerCase()
        if (v === 'yes' || v === 'true') apply('mediclaim', 'Yes')
        else if (v === 'no' || v === 'false') apply('mediclaim', 'No')
      }
      if (p.cashless) {
        const v = p.cashless.trim().toLowerCase()
        if (v === 'yes' || v === 'true') apply('cashless', 'Yes')
        else if (v === 'no' || v === 'false') apply('cashless', 'No')
      }
      // Reference source
      apply('reference_source',  p.reference_source)
      apply('reference_detail',  p.reference_detail)
      if (Object.keys(hl).length > 0) setHighlighted(hl)
      sessionStorage.removeItem(key)
    } catch { /* ignore */ }
  }, [])

  // ── Field setter ──────────────────────────────────────────────
  function set(field: keyof FormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }))
  }

  // ── Auto-calc age from DOB ────────────────────────────────────
  function handleDOB(dob: string) {
    set('date_of_birth', dob)
    if (dob) {
      const age = Math.floor(
        (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      )
      if (age >= 0 && age < 150) set('age', String(age))
    }
  }

  // ── OCR callback ─────────────────────────────────────────────
  // Called automatically when FormScanner finishes reading the image.
  // Maps OCRResult → FormData fields, then highlights which ones were filled.
  const handleOCRResult = useCallback((result: OCRResult) => {
    const p = result.patient
    if (!p) return

    const newFields: Partial<FormData>    = {}
    const newHighlight: HighlightedFields = {}

    function maybeSet(field: keyof FormData, value: string | undefined) {
      if (value && value.trim()) {
        newFields[field]    = value.trim()
        newHighlight[field] = true
      }
    }

    maybeSet('full_name',               p.full_name)
    maybeSet('age',                     p.age)
    maybeSet('date_of_birth',           p.date_of_birth)
    maybeSet('mobile',                  p.mobile)
    maybeSet('address',                 p.address)
    maybeSet('abha_id',                 p.abha_id)
    maybeSet('aadhaar_no',              p.aadhaar_no)
    maybeSet('emergency_contact_name',  p.emergency_contact_name)
    maybeSet('emergency_contact_phone', p.emergency_contact_phone)

    // Gender: normalise to one of the allowed values
    if (p.gender && GENDERS.includes(p.gender)) {
      newFields.gender    = p.gender
      newHighlight.gender = true
    }

    // Blood group: normalise to one of the allowed values
    if (p.blood_group && BLOOD_GROUPS.includes(p.blood_group)) {
      newFields.blood_group    = p.blood_group
      newHighlight.blood_group = true
    }

    // Mediclaim: normalise to "Yes" or "No"
    if (p.mediclaim) {
      const val = p.mediclaim.trim().toLowerCase()
      if (val === 'yes' || val === 'true' || val === '1') {
        newFields.mediclaim    = 'Yes'
        newHighlight.mediclaim = true
      } else if (val === 'no' || val === 'false' || val === '0') {
        newFields.mediclaim    = 'No'
        newHighlight.mediclaim = true
      }
    }

    // Cashless: normalise to "Yes" or "No"
    if (p.cashless) {
      const val = p.cashless.trim().toLowerCase()
      if (val === 'yes' || val === 'true' || val === '1') {
        newFields.cashless    = 'Yes'
        newHighlight.cashless = true
      } else if (val === 'no' || val === 'false' || val === '0') {
        newFields.cashless    = 'No'
        newHighlight.cashless = true
      }
    }

    // Reference source
    const REF_OPTIONS = ['Doctor Referral', 'Patient Referral', 'Advertisement', 'Google / Internet', 'Social Media', 'Walk-in', 'Camp / Outreach', 'Other']
    if (p.reference_source) {
      const matched = REF_OPTIONS.find(opt => opt.toLowerCase() === p.reference_source!.trim().toLowerCase())
      if (matched) {
        newFields.reference_source    = matched
        newHighlight.reference_source = true
      }
    }
    maybeSet('reference_detail', p.reference_detail)

    // Apply to form state
    setForm(prev => ({ ...prev, ...newFields }))

    // Apply highlights then remove them after 2 s (yellow flash effect)
    setHighlighted(newHighlight)
    setTimeout(() => setHighlighted({}), 2000)
  }, [])

  // ── Validation ────────────────────────────────────────────────
  function validate(): boolean {
    const e: Partial<FormData> = {}
    if (!form.full_name.trim())
      e.full_name = 'Patient name is required'
    if (!form.mobile.trim())
      e.mobile = 'Mobile number is required'
    else if (!/^\d{10}$/.test(form.mobile.trim().replace(/^\+?91/, '')))
      e.mobile = 'Enter a valid 10-digit mobile number (without country code)'
    else if (!/^\d{10}$/.test(form.mobile.trim()))
      e.mobile = 'Enter a valid 10-digit mobile number'
    if (form.abha_id && !/^\d{14}$/.test(form.abha_id.replace(/-/g, '')))
      e.abha_id = 'ABHA ID must be 14 digits'
    if (form.aadhaar_no && !/^\d{12}$/.test(form.aadhaar_no.replace(/\s/g, '')))
      e.aadhaar_no = 'Aadhaar number must be 12 digits'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // ── Generate payment link / WhatsApp message ──────────────────
  async function generatePayLink(patientId: string, name: string, mobile: string) {
    setPayLinkLoading(true)
    try {
      const res = await fetch('/api/payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: name,
          mobile,
          amount:      50000,  // ₹500 default registration fee in paise — adjust as needed
          description: 'OPD Registration Fee',
          notes:       { patient_id: patientId },
        }),
      })
      const data = await res.json()
      setPayLink(data)
    } catch {
      setPayLink({ type:'manual', whatsappText:`Hello ${name},\n\nYour registration is complete. Please visit reception to complete payment before your consultation.\n\nThank you!` })
    }
    setPayLinkLoading(false)
  }

  // ── Submit ────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)

    const { data, error } = await supabase
      .from('patients')
      .insert({
        full_name:               form.full_name.trim(),
        age:                     form.age      ? parseInt(form.age)          : null,
        date_of_birth:           form.date_of_birth                          || null,
        gender:                  form.gender                                  || null,
        mobile:                  form.mobile.trim(),
        blood_group:             form.blood_group                             || null,
        address:                 form.address.trim()                         || null,
        abha_id:                 form.abha_id.trim()                         || null,
        aadhaar_no:              form.aadhaar_no.replace(/\s/g, '').trim()   || null,
        emergency_contact_name:  form.emergency_contact_name.trim()          || null,
        emergency_contact_phone: form.emergency_contact_phone.trim()         || null,
        mediclaim:               form.mediclaim === 'Yes',
        cashless:                form.cashless  === 'Yes',
        reference_source:        form.reference_source
                                   ? (form.reference_detail.trim()
                                       ? `${form.reference_source} — ${form.reference_detail.trim()}`
                                       : form.reference_source)
                                   : null,
      })
      .select('id, mrn, full_name')
      .single()

    setSaving(false)

    if (error) {
      setErrors({ full_name: `Save failed: ${error.message}` })
      return
    }

    setSuccess({ mrn: data.mrn, name: data.full_name })
    setSuccessId(data.id)
    setSuccessMobile(form.mobile.trim())
    // Auto-generate WhatsApp payment message
    generatePayLink(data.id, data.full_name, form.mobile.trim())
  }

  // ── Helper: input class with OCR highlight ────────────────────
  function inputClass(field: keyof FormData, extra = '') {
    const base  = 'input'
    const err   = errors[field] ? 'border-red-400 focus:ring-red-400' : ''
    const hl    = highlighted[field] ? 'ocr-filled' : ''
    return [base, err, hl, extra].filter(Boolean).join(' ')
  }

  // ── Success screen ────────────────────────────────────────────
  if (success) {
    return (
      <AppShell>
        <div className="p-6 max-w-lg mx-auto mt-16 text-center">
          <div className="card p-10">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-9 h-9 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Patient Registered!</h2>
            <p className="text-gray-500 mb-4">{success.name} has been successfully registered.</p>
            <div className="inline-block bg-blue-50 border border-blue-200 rounded-lg px-6 py-3 mb-6">
              <div className="text-xs text-blue-500 font-semibold uppercase tracking-wide mb-1">Medical Record Number</div>
              <div className="text-3xl font-bold text-blue-700 font-mono">{success.mrn}</div>
            </div>

            {/* Step 1: Payment — shown prominently first */}
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-left">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-2">
                💳 Step 1 — Collect Payment First
              </p>
              <p className="text-xs text-amber-700 mb-3">
                Collect the registration/consultation fee before starting the consultation.
              </p>
              <div className="flex flex-col gap-2">
                <Link href={`/billing?patientId=${successId}&patientName=${encodeURIComponent(success.name)}&mrn=${success.mrn}`}
                  className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors">
                  💳 Collect Payment at Counter
                </Link>
                {/* WhatsApp payment link */}
                {payLinkLoading ? (
                  <div className="text-xs text-center text-gray-400 py-2">Generating payment link...</div>
                ) : payLink ? (
                  <div className="bg-white rounded-lg border border-green-200 p-3">
                    <p className="text-xs font-semibold text-green-800 mb-1.5">📱 Send Payment Link to Patient</p>
                    {payLink.url && (
                      <div className="bg-gray-50 rounded px-2 py-1.5 text-xs font-mono text-gray-600 mb-2 break-all select-all">
                        {payLink.url}
                      </div>
                    )}
                    <div className="flex gap-2">
                      {successMobile && (
                        <a href={`https://wa.me/91${successMobile.replace(/\D/g,'')}?text=${encodeURIComponent(payLink.whatsappText)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex-1 flex items-center justify-center gap-1 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                          📲 Send via WhatsApp
                        </a>
                      )}
                      <button onClick={() => { navigator.clipboard.writeText(payLink.whatsappText) }}
                        className="flex-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium px-3 py-2 rounded-lg transition-colors">
                        📋 Copy Message
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">
                      Patient can pay directly via UPI/card from their phone
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Step 2: Consultation */}
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
              🩺 Step 2 — After Payment
            </p>
            <div className="grid grid-cols-1 gap-2 mb-5">
              <Link href={`/opd/new?patient=${successId}`}
                className="flex items-center gap-3 px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors">
                <span className="text-xl">🩺</span>
                <div className="text-left">
                  <div className="font-semibold">Start OPD Consultation</div>
                  <div className="text-xs text-blue-200">Record vitals, diagnosis, prescription</div>
                </div>
              </Link>
              <Link href={`/patients/${successId}`}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-semibold transition-colors">
                <span className="text-xl">👤</span>
                <div className="text-left">
                  <div className="font-semibold">View Patient Profile</div>
                  <div className="text-xs text-gray-400">Full details and history</div>
                </div>
              </Link>
            </div>

            <button onClick={() => { setForm(EMPTY); setErrors({}); setSuccess(null); setSuccessId('') }}
              className="text-sm text-gray-400 hover:text-gray-600 underline">
              Register another patient
            </button>
          </div>
        </div>
      </AppShell>
    )
  }

  // ── Main form ─────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/patients" className="text-gray-400 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Register New Patient</h1>
            <p className="text-sm text-gray-500">Fields marked * are required.</p>
          </div>
        </div>

        {/* ══ OCR SCANNER ═════════════════════════════════════════ */}
        <div className="mb-5">
          {/* Quick access to all intake methods */}
          <div className="flex items-center gap-2 mb-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
            <span className="text-sm">💡</span>
            <p className="text-xs text-blue-800 flex-1">
              <strong>Better ways to collect this data:</strong> Use digital form, fillable PDF, or QR code for zero errors.
            </p>
            <a href="/forms" className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap">
              Open Intake Forms →
            </a>
          </div>
          <FormScanner
            formType="patient_registration"
            onExtracted={handleOCRResult}
            label="Scan Registration Paper Form (Photo or PDF)"
          />
          <p className="text-xs text-gray-400 mt-2 ml-1">
            📷 Upload a photo or PDF of the patient's existing paper registration form (Gujarati or English).
            The app will read it and fill the fields below automatically.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>

          {/* ── Personal Details ────────────────────────────────── */}
          <div className="card p-6 mb-5">
            <h2 className="section-title flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-600" /> Personal Details
            </h2>
            <div className="grid grid-cols-2 gap-5">

              {/* Full Name */}
              <div className="col-span-2">
                <label className="label">Full Name *</label>
                <input className={inputClass('full_name')}
                  placeholder="e.g. Priya Sharma"
                  value={form.full_name}
                  onChange={e => set('full_name', e.target.value)}
                />
                {errors.full_name && (
                  <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{errors.full_name}
                  </p>
                )}
              </div>

              {/* Age */}
              <div>
                <label className="label">Age (years)</label>
                <input className={inputClass('age')} type="number" min="0" max="150"
                  placeholder="28"
                  value={form.age}
                  onChange={e => set('age', e.target.value)}
                />
              </div>

              {/* Date of Birth */}
              <div>
                <label className="label">Date of Birth</label>
                <input className={inputClass('date_of_birth')} type="date"
                  max={new Date().toISOString().split('T')[0]}
                  value={form.date_of_birth}
                  onChange={e => handleDOB(e.target.value)}
                />
                <p className="text-xs text-gray-400 mt-1">Entering DOB auto-fills Age</p>
              </div>

              {/* Gender */}
              <div>
                <label className="label">Gender</label>
                <select className={inputClass('gender')}
                  value={form.gender}
                  onChange={e => set('gender', e.target.value)}>
                  <option value="">Select gender</option>
                  {GENDERS.map(g => <option key={g}>{g}</option>)}
                </select>
              </div>

              {/* Blood Group */}
              <div>
                <label className="label">Blood Group</label>
                <select className={inputClass('blood_group')}
                  value={form.blood_group}
                  onChange={e => set('blood_group', e.target.value)}>
                  <option value="">Select blood group</option>
                  {BLOOD_GROUPS.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>

              {/* Mobile */}
              <div>
                <label className="label">Mobile Number *</label>
                <input className={inputClass('mobile', 'font-mono')}
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  value={form.mobile}
                  onChange={e => set('mobile', e.target.value.replace(/\D/g, ''))}
                />
                {errors.mobile && (
                  <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{errors.mobile}
                  </p>
                )}
              </div>

              {/* Aadhaar Card No */}
              <div>
                <label className="label">
                  Aadhaar Card No
                  <span className="text-gray-400 font-normal normal-case ml-1">(optional, 12 digits)</span>
                </label>
                <input className={inputClass('aadhaar_no', 'font-mono')}
                  placeholder="e.g. 1234 5678 9012"
                  maxLength={14}
                  value={form.aadhaar_no}
                  onChange={e => set('aadhaar_no', e.target.value.replace(/[^\d\s]/g, ''))}
                />
                {errors.aadhaar_no && (
                  <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{errors.aadhaar_no}
                  </p>
                )}
              </div>

              {/* ABHA ID */}
              <div>
                <label className="label">
                  ABHA ID
                  <span className="text-gray-400 font-normal normal-case ml-1">(optional, 14 digits)</span>
                </label>
                <input className={inputClass('abha_id', 'font-mono')}
                  placeholder="e.g. 12-3456-7890-1234"
                  value={form.abha_id}
                  onChange={e => set('abha_id', e.target.value)}
                />
                {errors.abha_id && (
                  <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{errors.abha_id}
                  </p>
                )}
              </div>

              {/* Address */}
              <div className="col-span-2">
                <label className="label">Address</label>
                <textarea className={inputClass('address', 'resize-none')} rows={2}
                  placeholder="House/flat number, street, city, PIN code"
                  value={form.address}
                  onChange={e => set('address', e.target.value)}
                />
              </div>

            </div>
          </div>

          {/* ── Mediclaim & Referral ───────────────────────────────── */}
          <div className="card p-5 mb-5">
            <h2 className="section-title">Insurance & Referral</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Mediclaim / Insurance</label>
                <select className="input" value={form.mediclaim} onChange={e=>set('mediclaim',e.target.value)}>
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </div>
              <div>
                <label className="label">Cashless Option</label>
                <select className="input" value={form.cashless}
                  disabled={form.mediclaim !== 'Yes'}
                  onChange={e=>set('cashless',e.target.value)}>
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
                {form.mediclaim !== 'Yes' && (
                  <p className="text-xs text-gray-400 mt-1">Enable Mediclaim first</p>
                )}
              </div>
              <div>
                <label className="label">Patient Referred By / Source</label>
                <select className="input" value={form.reference_source} onChange={e=>set('reference_source',e.target.value)}>
                  <option value="">Select (optional)</option>
                  <option>Doctor Referral</option>
                  <option>Patient Referral</option>
                  <option>Advertisement</option>
                  <option>Social Media</option>
                  <option>Google / Internet</option>
                  <option>Walk-in</option>
                  <option>Camp / Outreach</option>
                  <option>Other</option>
                </select>
                {(form.reference_source === 'Doctor Referral' || form.reference_source === 'Patient Referral') && (
                  <input className="input mt-2 text-sm"
                    placeholder={form.reference_source === 'Doctor Referral' ? 'Enter referring doctor name…' : 'Enter referred by patient name…'}
                    value={form.reference_detail}
                    onChange={e => set('reference_detail', e.target.value)}/>
                )}
              </div>
            </div>
            {/* Mediclaim action guidance */}
            {form.mediclaim === 'Yes' && (
              <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-bold text-blue-800 mb-1.5">
                  📋 Mediclaim Patient — Required Steps
                </p>
                <div className="space-y-1 text-xs text-blue-700">
                  <p>✓ Collect insurance card / policy document</p>
                  <p>✓ Note Policy Number and TPA name in consultation notes</p>
                  <p>✓ Get pre-authorisation letter if IPD admission</p>
                  {form.cashless === 'Yes' ? (
                    <>
                      <p className="font-semibold text-blue-900 mt-2">💳 Cashless Process:</p>
                      <p>1. Contact TPA/insurance company for pre-auth approval</p>
                      <p>2. Fill TPA cashless request form (from insurance company)</p>
                      <p>3. Attach patient's ID proof + insurance card</p>
                      <p>4. Submit to hospital billing — patient pays only non-covered amount</p>
                      <p>5. Mark billing as "Cashless" — do NOT collect full amount from patient</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-blue-900 mt-2">🧾 Reimbursement Process:</p>
                      <p>1. Collect full payment from patient at discharge</p>
                      <p>2. Provide detailed itemised bill + all receipts</p>
                      <p>3. Give originals of all lab reports, prescriptions</p>
                      <p>4. Doctor's discharge summary on letterhead (for IPD)</p>
                      <p>5. Patient submits to insurance for reimbursement</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Emergency Contact ───────────────────────────────── */}
          <div className="card p-6 mb-6">
            <h2 className="section-title">Emergency Contact</h2>
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="label">Contact Name</label>
                <input className={inputClass('emergency_contact_name')}
                  placeholder="Name of emergency contact"
                  value={form.emergency_contact_name}
                  onChange={e => set('emergency_contact_name', e.target.value)}
                />
              </div>
              <div>
                <label className="label">Contact Phone</label>
                <input className={inputClass('emergency_contact_phone', 'font-mono')}
                  placeholder="10-digit mobile"
                  maxLength={10}
                  value={form.emergency_contact_phone}
                  onChange={e => set('emergency_contact_phone', e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>
          </div>

          {/* ── OCR highlight legend ────────────────────────────── */}
          {Object.values(highlighted).some(Boolean) && (
            <div className="mb-4 flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
              <ScanLine className="w-3.5 h-3.5 flex-shrink-0" />
              Fields highlighted in yellow were filled automatically from the scanned form.
              Please verify them before saving.
            </div>
          )}

          {/* ── Actions ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <Link href="/patients" className="btn-secondary">Cancel</Link>
            <button type="submit" disabled={saving}
              className="btn-primary px-8 disabled:opacity-60 flex items-center gap-2">
              {saving
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Registering...</>
                : <><UserPlus className="w-4 h-4" /> Register Patient</>}
            </button>
          </div>

        </form>
      </div>
    </AppShell>
  )
}
