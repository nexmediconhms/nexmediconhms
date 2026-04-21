'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import FormScanner from '@/components/shared/FormScanner'
import { supabase } from '@/lib/supabase'
import type { OCRResult } from '@/lib/ocr'
import {
  UserPlus, CheckCircle, AlertCircle, ArrowLeft,
  AlertTriangle, ExternalLink, User, Phone, MapPin,
  Heart, Shield, Stethoscope, FileText, QrCode, Globe, ScanLine
} from 'lucide-react'

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
  mediclaim:               string
  cashless:                string
  reference_source:        string
  reference_detail:        string
}

const EMPTY: FormData = {
  full_name: '', age: '', date_of_birth: '', gender: 'Female',
  mobile: '', blood_group: '', address: '', abha_id: '', aadhaar_no: '',
  emergency_contact_name: '', emergency_contact_phone: '',
  mediclaim: 'No', cashless: 'No', reference_source: '', reference_detail: '',
}

// ─── Duplicate match type ─────────────────────────────────────
interface DuplicateMatch {
  id: string; mrn: string; full_name: string; mobile: string
  age?: number; gender?: string; aadhaar_no?: string
  matchReasons: string[]
}

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

  // Duplicate detection
  const [duplicates,       setDuplicates]       = useState<DuplicateMatch[]>([])
  const [showDuplicateWarn,setShowDuplicateWarn] = useState(false)
  const [checkingDups,     setCheckingDups]      = useState(false)


  // ── Load prefill from URL params (from forms page) ──────────
  useEffect(() => {
    try {
      const prefillParam = new URLSearchParams(window.location.search).get('prefill')
      const key    = 'ocr_prefill_generic'
      const stored = sessionStorage.getItem(key)
      if (!stored || !prefillParam) return
      const ocr    = JSON.parse(stored)
      const p      = ocr.patient ?? {}
      const apply = (field: keyof typeof EMPTY, val: string | undefined) => {
        if (!val) return
        setForm(prev => ({ ...prev, [field]: val }))
      }
      apply('full_name', p.full_name)
      apply('mobile', p.mobile)
      apply('age', p.age)
      apply('date_of_birth', p.date_of_birth)
      apply('gender', p.gender)
      apply('blood_group', p.blood_group)
      apply('address', p.address)
      apply('abha_id', p.abha_id)
      apply('aadhaar_no', p.aadhaar_no)
      apply('emergency_contact_name', p.emergency_contact_name)
      apply('emergency_contact_phone', p.emergency_contact_phone)
      if (p.mediclaim) {
        const v = p.mediclaim.trim().toLowerCase()
        if (v === 'yes' || v === 'true') apply('mediclaim', 'Yes')
      }
      if (p.cashless) {
        const v = p.cashless.trim().toLowerCase()
        if (v === 'yes' || v === 'true') apply('cashless', 'Yes')
      }
      apply('reference_source', p.reference_source)
      apply('reference_detail', p.reference_detail)
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

  // ── OCR callback (auto-fill form from scanned image) ──────────
  const handleOCRResult = useCallback((result: OCRResult) => {
    const p = result.patient
    if (!p) return

    const newFields: Partial<FormData> = {}

    function maybeSet(field: keyof FormData, value: string | undefined) {
      if (value && value.trim()) {
        newFields[field] = value.trim()
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

    if (p.gender && GENDERS.includes(p.gender)) newFields.gender = p.gender
    if (p.blood_group && BLOOD_GROUPS.includes(p.blood_group)) newFields.blood_group = p.blood_group

    if (p.mediclaim) {
      const val = p.mediclaim.trim().toLowerCase()
      if (val === 'yes' || val === 'true' || val === '1') newFields.mediclaim = 'Yes'
      else if (val === 'no' || val === 'false' || val === '0') newFields.mediclaim = 'No'
    }
    if (p.cashless) {
      const val = p.cashless.trim().toLowerCase()
      if (val === 'yes' || val === 'true' || val === '1') newFields.cashless = 'Yes'
      else if (val === 'no' || val === 'false' || val === '0') newFields.cashless = 'No'
    }

    const REF_OPTIONS = ['Doctor Referral', 'Patient Referral', 'Advertisement', 'Google / Internet', 'Social Media', 'Walk-in', 'Camp / Outreach', 'Other']
    if (p.reference_source) {
      const matched = REF_OPTIONS.find(opt => opt.toLowerCase() === p.reference_source!.trim().toLowerCase())
      if (matched) newFields.reference_source = matched
    }
    maybeSet('reference_detail', p.reference_detail)

    setForm(prev => ({ ...prev, ...newFields }))
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
    const fallbackMsg = `Hello ${name},\n\nYour registration is complete. Please visit reception to complete payment before your consultation.\n\nThank you!`
    try {
      const res = await fetch('/api/payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: name, mobile,
          amount: 50000, description: 'OPD Registration Fee',
          notes: { patient_id: patientId },
        }),
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Payment link API error')
      const data = await res.json()
      if (data.error || !data.whatsappText) {
        // API returned error or missing whatsappText — use fallback
        setPayLink({
          type: data.type || 'manual',
          url: data.url,
          whatsappText: data.whatsappText || fallbackMsg,
        })
      } else {
        setPayLink(data)
      }
    } catch {
      setPayLink({ type:'manual', whatsappText: fallbackMsg })
    }
    setPayLinkLoading(false)
  }

  // ── Duplicate check ────────────────────────────────────────────
  async function checkDuplicates(): Promise<DuplicateMatch[]> {
    const mobile   = form.mobile.trim()
    const aadhaar  = form.aadhaar_no.replace(/\s/g, '').trim()
    const name     = form.full_name.trim().toLowerCase()

    const orFilters: string[] = []
    if (mobile)  orFilters.push(`mobile.eq.${mobile}`)
    if (aadhaar) orFilters.push(`aadhaar_no.eq.${aadhaar}`)

    if (orFilters.length === 0 && !name) return []

    let matches: DuplicateMatch[] = []
    if (orFilters.length > 0) {
      const { data } = await supabase
        .from('patients')
        .select('id, mrn, full_name, mobile, age, gender, aadhaar_no')
        .or(orFilters.join(','))
        .limit(10)
      if (data) {
        matches = data.map(p => {
          const reasons: string[] = []
          if (mobile && p.mobile === mobile) reasons.push('Same mobile number')
          if (aadhaar && p.aadhaar_no === aadhaar) reasons.push('Same Aadhaar number')
          return { ...p, matchReasons: reasons } as DuplicateMatch
        })
      }
    }

    if (name.length >= 3) {
      const { data: nameMatches } = await supabase
        .from('patients')
        .select('id, mrn, full_name, mobile, age, gender, aadhaar_no')
        .ilike('full_name', name)
        .limit(10)
      if (nameMatches) {
        for (const p of nameMatches) {
          const existing = matches.find(m => m.id === p.id)
          if (existing) {
            if (!existing.matchReasons.includes('Same name')) existing.matchReasons.push('Same name')
          } else {
            const formAge = form.age ? parseInt(form.age) : null
            const ageMatch = formAge && p.age && Math.abs(formAge - p.age) <= 1
            const dobMatch = form.date_of_birth && p.age
            if (ageMatch || dobMatch) {
              const reasons = ['Same name']
              if (ageMatch) reasons.push('Similar age')
              matches.push({ ...p, matchReasons: reasons } as DuplicateMatch)
            }
          }
        }
      }
    }

    return matches
  }

  // ── Submit (with duplicate check) ──────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    if (!showDuplicateWarn) {
      setCheckingDups(true)
      const dups = await checkDuplicates()
      setCheckingDups(false)
      if (dups.length > 0) {
        setDuplicates(dups)
        setShowDuplicateWarn(true)
        return
      }
    }

    setShowDuplicateWarn(false)
    setDuplicates([])
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
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        setErrors({ mobile: 'A patient with this mobile number already exists' })
      } else {
        setErrors({ full_name: `Save failed: ${error.message}` })
      }
      return
    }

    setSuccess({ mrn: data.mrn, name: data.full_name })
    setSuccessId(data.id)
    setSuccessMobile(form.mobile.trim())
    generatePayLink(data.id, data.full_name, form.mobile.trim())
  }

  // ── Helper: input class ────────────────────────────────────────
  function inputClass(field: keyof FormData, extra = '') {
    const base = 'w-full rounded-xl border bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
    const err  = errors[field] ? 'border-red-300 bg-red-50 focus:ring-red-400' : 'border-gray-200 hover:border-gray-300'
    return [base, err, extra].filter(Boolean).join(' ')
  }

  // ── Error display helper ───────────────────────────────────────
  function FieldError({ field }: { field: keyof FormData }) {
    if (!errors[field]) return null
    return (
      <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1 animate-in fade-in">
        <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors[field]}
      </p>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // SUCCESS SCREEN
  // ══════════════════════════════════════════════════════════════
  if (success) {
    return (
      <AppShell>
        <div className="p-6 max-w-lg mx-auto mt-12 text-center">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
            <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg shadow-green-200">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Patient Registered!</h2>
            <p className="text-gray-500 mb-5">{success.name} has been successfully registered.</p>
            <div className="inline-block bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl px-8 py-4 mb-6">
              <div className="text-xs text-blue-500 font-semibold uppercase tracking-wider mb-1">Medical Record Number</div>
              <div className="text-4xl font-bold text-blue-700 font-mono tracking-wide">{success.mrn}</div>
            </div>

            {/* Step 1: Payment */}
            <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl p-5 text-left">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-2">
                💳 Step 1 — Collect Payment First
              </p>
              <p className="text-xs text-amber-700 mb-3">
                Collect the registration/consultation fee before starting the consultation.
              </p>
              <div className="flex flex-col gap-2">
                <Link href={`/billing?patientId=${successId}&patientName=${encodeURIComponent(success.name)}&mrn=${success.mrn}`}
                  className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-3 rounded-xl transition-colors shadow-sm">
                  💳 Collect Payment at Counter
                </Link>
                {payLinkLoading ? (
                  <div className="text-xs text-center text-gray-400 py-2">Generating payment link...</div>
                ) : payLink ? (
                  <div className="bg-white rounded-xl border border-green-200 p-3">
                    <p className="text-xs font-semibold text-green-800 mb-1.5">📱 Send Payment Link to Patient</p>
                    {payLink.url && (
                      <div className="bg-gray-50 rounded-lg px-2 py-1.5 text-xs font-mono text-gray-600 mb-2 break-all select-all">
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
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-semibold transition-all shadow-sm">
                <Stethoscope className="w-5 h-5" />
                <div className="text-left">
                  <div className="font-semibold">Start OPD Consultation</div>
                  <div className="text-xs text-blue-200">Record vitals, diagnosis, prescription</div>
                </div>
              </Link>
              <Link href={`/patients/${successId}`}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-semibold transition-colors">
                <User className="w-5 h-5 text-gray-400" />
                <div className="text-left">
                  <div className="font-semibold">View Patient Profile</div>
                  <div className="text-xs text-gray-400">Full details and history</div>
                </div>
              </Link>
            </div>

            <button onClick={() => { setForm(EMPTY); setErrors({}); setSuccess(null); setSuccessId(''); setDuplicates([]); setShowDuplicateWarn(false) }}
              className="text-sm text-gray-400 hover:text-gray-600 underline">
              Register another patient
            </button>
          </div>
        </div>
      </AppShell>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // MAIN FORM
  // ══════════════════════════════════════════════════════════════
  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/patients" className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <UserPlus className="w-6 h-6 text-blue-600" />
              Register New Patient
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Fill in the patient details below. Fields marked <span className="text-red-500 font-bold">*</span> are required.</p>
          </div>
        </div>

        {/* ═══ 4 INTAKE METHODS ═══════════════════════════════════ */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick Registration Methods</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <a href="/intake" target="_blank" rel="noopener noreferrer"
              className="group flex flex-col items-center gap-2 p-4 bg-white rounded-2xl border-2 border-gray-100 hover:border-indigo-300 hover:bg-indigo-50 transition-all duration-200 shadow-sm hover:shadow-md">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 group-hover:bg-indigo-200 flex items-center justify-center transition-colors">
                <Globe className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-gray-800">Digital Form</div>
                <div className="text-xs text-gray-400">Patient self-fills on tablet</div>
              </div>
            </a>

            <a href="/forms" target="_blank" rel="noopener noreferrer"
              className="group flex flex-col items-center gap-2 p-4 bg-white rounded-2xl border-2 border-gray-100 hover:border-purple-300 hover:bg-purple-50 transition-all duration-200 shadow-sm hover:shadow-md">
              <div className="w-10 h-10 rounded-xl bg-purple-100 group-hover:bg-purple-200 flex items-center justify-center transition-colors">
                <FileText className="w-5 h-5 text-purple-600" />
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-gray-800">Fillable PDF</div>
                <div className="text-xs text-gray-400">Print & fill, upload back</div>
              </div>
            </a>

            <a href="/forms" target="_blank" rel="noopener noreferrer"
              className="group flex flex-col items-center gap-2 p-4 bg-white rounded-2xl border-2 border-gray-100 hover:border-green-300 hover:bg-green-50 transition-all duration-200 shadow-sm hover:shadow-md">
              <div className="w-10 h-10 rounded-xl bg-green-100 group-hover:bg-green-200 flex items-center justify-center transition-colors">
                <QrCode className="w-5 h-5 text-green-600" />
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-gray-800">QR Code</div>
                <div className="text-xs text-gray-400">Patient scans & fills on phone</div>
              </div>
            </a>

            <a href="/forms" target="_blank" rel="noopener noreferrer"
              className="group flex flex-col items-center gap-2 p-4 bg-white rounded-2xl border-2 border-gray-100 hover:border-amber-300 hover:bg-amber-50 transition-all duration-200 shadow-sm hover:shadow-md">
              <div className="w-10 h-10 rounded-xl bg-amber-100 group-hover:bg-amber-200 flex items-center justify-center transition-colors">
                <ScanLine className="w-5 h-5 text-amber-600" />
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-gray-800">Paper Form</div>
                <div className="text-xs text-gray-400">Scan handwritten form</div>
              </div>
            </a>
          </div>
        </div>

        {/* ═══ PHOTO UPLOAD / FORM SCANNER ═══════════════════════ */}
        <div className="mb-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-blue-500" />
            Upload Photo of Registration Form
          </h3>
          <FormScanner
            formType="patient_registration"
            onExtracted={handleOCRResult}
            label="Upload photo or PDF of paper form"
          />
          <p className="text-xs text-gray-400 mt-2">
            📷 Upload a photo or PDF of the patient's paper registration form. The app will read it and auto-fill the fields below.
          </p>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-gray-200"></div>
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Or fill manually below</span>
          <div className="flex-1 h-px bg-gray-200"></div>
        </div>

        <form onSubmit={handleSubmit} noValidate>

          {/* ═══ SECTION 1: Personal Details ═══════════════════════ */}
          <div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-5">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <User className="w-4 h-4 text-blue-600" />
                </div>
                Personal Details
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Full Name */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input className={inputClass('full_name')}
                    placeholder="Enter patient's full name"
                    value={form.full_name}
                    onChange={e => set('full_name', e.target.value)}
                    autoFocus
                  />
                  <FieldError field="full_name" />
                </div>

                {/* Gender */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Gender</label>
                  <div className="flex gap-2">
                    {GENDERS.map(g => (
                      <button key={g} type="button"
                        onClick={() => set('gender', g)}
                        className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium border-2 transition-all duration-200 ${
                          form.gender === g
                            ? g === 'Female' ? 'border-pink-400 bg-pink-50 text-pink-700'
                              : g === 'Male' ? 'border-blue-400 bg-blue-50 text-blue-700'
                              : 'border-purple-400 bg-purple-50 text-purple-700'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                        }`}>
                        {g === 'Female' ? '♀ ' : g === 'Male' ? '♂ ' : '⚧ '}{g}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Blood Group */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Blood Group</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {BLOOD_GROUPS.map(b => (
                      <button key={b} type="button"
                        onClick={() => set('blood_group', form.blood_group === b ? '' : b)}
                        className={`py-2 rounded-lg text-xs font-bold border-2 transition-all duration-200 ${
                          form.blood_group === b
                            ? 'border-red-400 bg-red-50 text-red-700'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                        }`}>
                        {b}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date of Birth */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Date of Birth</label>
                  <input className={inputClass('date_of_birth')} type="date"
                    max={new Date().toISOString().split('T')[0]}
                    value={form.date_of_birth}
                    onChange={e => handleDOB(e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1">Auto-calculates age</p>
                </div>

                {/* Age */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Age (years)</label>
                  <input className={inputClass('age')} type="number" min="0" max="150"
                    placeholder="e.g. 28"
                    value={form.age}
                    onChange={e => set('age', e.target.value)}
                  />
                </div>
              </div>

            </div>
          </div>

          {/* ═══ SECTION 2: Contact & ID ══════════════════════════ */}
          <div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-5">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-5">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                  <Phone className="w-4 h-4 text-green-600" />
                </div>
                Contact & Identification
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Mobile */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Mobile Number <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-mono">+91</span>
                    <input className={inputClass('mobile', 'font-mono pl-12')}
                      placeholder="10-digit number"
                      maxLength={10}
                      value={form.mobile}
                      onChange={e => set('mobile', e.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                  <FieldError field="mobile" />
                </div>

                {/* Aadhaar Card No */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Aadhaar Card No
                    <span className="text-gray-400 font-normal ml-1">(12 digits)</span>
                  </label>
                  <input className={inputClass('aadhaar_no', 'font-mono')}
                    placeholder="e.g. 1234 5678 9012"
                    maxLength={14}
                    value={form.aadhaar_no}
                    onChange={e => set('aadhaar_no', e.target.value.replace(/[^\d\s]/g, ''))}
                  />
                  <FieldError field="aadhaar_no" />
                </div>

                {/* ABHA ID */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    ABHA Health ID
                    <span className="text-gray-400 font-normal ml-1">(14 digits)</span>
                  </label>
                  <input className={inputClass('abha_id', 'font-mono')}
                    placeholder="e.g. 12-3456-7890-1234"
                    value={form.abha_id}
                    onChange={e => set('abha_id', e.target.value)}
                  />
                  <FieldError field="abha_id" />
                </div>

                {/* Address */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <MapPin className="w-3.5 h-3.5 inline mr-1 text-gray-400" />
                    Address
                  </label>
                  <textarea className={inputClass('address', 'resize-none')} rows={2}
                    placeholder="House/flat number, street, city, PIN code"
                    value={form.address}
                    onChange={e => set('address', e.target.value)}
                  />
                </div>

                {/* Emergency Contact */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <Heart className="w-3.5 h-3.5 inline mr-1 text-red-400" />
                    Emergency Contact Name
                  </label>
                  <input className={inputClass('emergency_contact_name')}
                    placeholder="Name of emergency contact"
                    value={form.emergency_contact_name}
                    onChange={e => set('emergency_contact_name', e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <Heart className="w-3.5 h-3.5 inline mr-1 text-red-400" />
                    Emergency Contact Phone
                  </label>
                  <input className={inputClass('emergency_contact_phone', 'font-mono')}
                    placeholder="10-digit mobile"
                    maxLength={10}
                    value={form.emergency_contact_phone}
                    onChange={e => set('emergency_contact_phone', e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </div>

            </div>
          </div>

          {/* ═══ SECTION 3: Insurance & Referral ══════════════════ */}
          <div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-5">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-5">
                <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-purple-600" />
                </div>
                Insurance & Referral
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                {/* Mediclaim */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Mediclaim / Insurance</label>
                  <div className="flex gap-2">
                    {['No', 'Yes'].map(v => (
                      <button key={v} type="button"
                        onClick={() => { set('mediclaim', v); if (v === 'No') set('cashless', 'No') }}
                        className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium border-2 transition-all duration-200 ${
                          form.mediclaim === v
                            ? v === 'Yes' ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-300 bg-gray-50 text-gray-700'
                            : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
                        }`}>
                        {v === 'Yes' ? '✓ Yes' : '✗ No'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cashless */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Cashless Option</label>
                  <div className="flex gap-2">
                    {['No', 'Yes'].map(v => (
                      <button key={v} type="button"
                        disabled={form.mediclaim !== 'Yes'}
                        onClick={() => set('cashless', v)}
                        className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium border-2 transition-all duration-200 ${
                          form.mediclaim !== 'Yes' ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed' :
                          form.cashless === v
                            ? v === 'Yes' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 bg-gray-50 text-gray-700'
                            : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
                        }`}>
                        {v === 'Yes' ? '✓ Yes' : '✗ No'}
                      </button>
                    ))}
                  </div>
                  {form.mediclaim !== 'Yes' && (
                    <p className="text-xs text-gray-400 mt-1">Enable Mediclaim first</p>
                  )}
                </div>

                {/* Referral Source */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Referred By / Source</label>
                  <select className={inputClass('reference_source')}
                    value={form.reference_source}
                    onChange={e => set('reference_source', e.target.value)}>
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
                    <input className={inputClass('reference_detail', 'mt-2')}
                      placeholder={form.reference_source === 'Doctor Referral' ? 'Enter referring doctor name…' : 'Enter referred by patient name…'}
                      value={form.reference_detail}
                      onChange={e => set('reference_detail', e.target.value)} />
                  )}
                </div>
              </div>

              {/* Mediclaim guidance */}
              {form.mediclaim === 'Yes' && (
                <div className="mt-5 bg-blue-50 border border-blue-200 rounded-xl p-4">
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
                        <p>2. Fill TPA cashless request form</p>
                        <p>3. Attach patient's ID proof + insurance card</p>
                        <p>4. Submit to hospital billing — patient pays only non-covered amount</p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold text-blue-900 mt-2">🧾 Reimbursement Process:</p>
                        <p>1. Collect full payment from patient at discharge</p>
                        <p>2. Provide detailed itemised bill + all receipts</p>
                        <p>3. Give originals of all lab reports, prescriptions</p>
                        <p>4. Patient submits to insurance for reimbursement</p>
                      </>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* ═══ DUPLICATE WARNING ════════════════════════════════ */}
          {showDuplicateWarn && duplicates.length > 0 && (
            <div className="mb-5 bg-amber-50 border-2 border-amber-400 rounded-2xl p-5 animate-in fade-in">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-amber-900">
                    ⚠️ Possible Duplicate Patient{duplicates.length > 1 ? 's' : ''} Found!
                  </h3>
                  <p className="text-sm text-amber-700 mt-1">
                    The following existing patient{duplicates.length > 1 ? 's match' : ' matches'} the data you entered.
                    Please verify before creating a new record.
                  </p>
                </div>
              </div>

              <div className="space-y-3 mb-4">
                {duplicates.map(dup => (
                  <div key={dup.id} className="bg-white border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-gray-900">{dup.full_name}</span>
                        <span className="text-xs font-mono bg-blue-100 text-blue-700 px-2 py-0.5 rounded-lg">{dup.mrn}</span>
                      </div>
                      <div className="text-xs text-gray-500 space-x-3">
                        <span>📱 {dup.mobile}</span>
                        {dup.age && <span>Age: {dup.age}</span>}
                        {dup.gender && <span>{dup.gender}</span>}
                        {dup.aadhaar_no && <span>Aadhaar: {dup.aadhaar_no}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {dup.matchReasons.map((reason, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-700 px-2.5 py-1 rounded-full">
                            ⚠️ {reason}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <Link href={`/patients/${dup.id}`}
                        className="flex items-center gap-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl transition-colors shadow-sm">
                        <ExternalLink className="w-3 h-3" /> View Patient
                      </Link>
                      <Link href={`/opd/new?patient=${dup.id}`}
                        className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl transition-colors shadow-sm">
                        🩺 Start OPD
                      </Link>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-amber-200 pt-4">
                <button type="button"
                  onClick={() => { setShowDuplicateWarn(false); setDuplicates([]) }}
                  className="text-sm text-gray-500 hover:text-gray-700 font-medium px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
                  ← Go back and edit
                </button>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-60">
                  {saving
                    ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Registering...</>
                    : <><AlertTriangle className="w-4 h-4" /> Register Anyway (Not a Duplicate)</>}
                </button>
              </div>
            </div>
          )}

          {/* ═══ FORM SUMMARY & SUBMIT ═══════════════════════════ */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            {/* Quick summary of filled fields */}
            <div className="flex flex-wrap gap-2 mb-4">
              {form.full_name && (
                <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full">
                  <CheckCircle className="w-3 h-3" /> {form.full_name}
                </span>
              )}
              {form.mobile && (
                <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full">
                  <Phone className="w-3 h-3" /> {form.mobile}
                </span>
              )}
              {form.gender && (
                <span className="inline-flex items-center gap-1 text-xs bg-gray-50 text-gray-600 border border-gray-200 px-2.5 py-1 rounded-full">
                  {form.gender}
                </span>
              )}
              {form.age && (
                <span className="inline-flex items-center gap-1 text-xs bg-gray-50 text-gray-600 border border-gray-200 px-2.5 py-1 rounded-full">
                  Age: {form.age}
                </span>
              )}
              {form.blood_group && (
                <span className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-600 border border-red-200 px-2.5 py-1 rounded-full">
                  🩸 {form.blood_group}
                </span>
              )}
              {form.aadhaar_no && (
                <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2.5 py-1 rounded-full">
                  Aadhaar ✓
                </span>
              )}
              {form.mediclaim === 'Yes' && (
                <span className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-600 border border-purple-200 px-2.5 py-1 rounded-full">
                  🏥 Mediclaim
                </span>
              )}
              {!form.full_name && !form.mobile && (
                <span className="text-xs text-gray-400">Fill in the form above to see a summary here</span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between">
              <Link href="/patients"
                className="text-sm text-gray-500 hover:text-gray-700 font-medium px-5 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
                Cancel
              </Link>
              <button type="submit" disabled={saving || checkingDups}
                className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-semibold px-8 py-3 rounded-xl transition-all shadow-md shadow-blue-200 disabled:opacity-60 disabled:shadow-none">
                {checkingDups
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Checking for duplicates...</>
                  : saving
                    ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Registering...</>
                    : <><UserPlus className="w-4 h-4" /> Register Patient</>}
              </button>
            </div>
          </div>

        </form>
      </div>
    </AppShell>
  )
}
