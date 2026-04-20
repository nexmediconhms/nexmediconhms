'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import FormScanner from '@/components/shared/FormScanner'
import type { OCRResult } from '@/lib/ocr'
import { getHospitalSettings } from '@/lib/utils'
import {
  Printer, ScanLine, FileText, ExternalLink,
  CheckCircle, ArrowRight, QrCode,
  Download, Copy, Globe, Star
} from 'lucide-react'

const PAPER_FORMS = [
  {
    id:       'patient_registration',
    label:    'Patient Registration',
    icon:     '📝',
    color:    'indigo',
    file:     '/forms/patient-registration.html',
    desc:     'Full name, DOB, gender, blood group, mobile, address, Aadhaar, insurance, consent',
    formType: 'patient_registration' as const,
  },
  {
    id:       'vitals_complaints',
    label:    'Vitals & Complaints',
    icon:     '🩺',
    color:    'blue',
    file:     '/forms/vitals-complaints.html',
    desc:     'Pulse, BP, temperature, SpO₂, weight, height, chief complaint, HPI',
    formType: 'opd_consultation' as const,
  },
  {
    id:       'consultation_diagnosis',
    label:    'Consultation & Diagnosis',
    icon:     '📋',
    color:    'green',
    file:     '/forms/consultation-diagnosis.html',
    desc:     'Diagnosis, clinical notes, prescription drugs, advice, follow-up date',
    formType: 'opd_consultation' as const,
  },
  {
    id:       'gynecology_ob',
    label:    'Gynecology / OB Exam',
    icon:     '🤰',
    color:    'pink',
    file:     '/forms/gynecology-ob-exam.html',
    desc:     'G/P/A/L, LMP, EDD, per abdomen, per speculum, per vaginum findings',
    formType: 'anc_card' as const,
  },
]

const COLOR_BORDER: Record<string, string> = {
  indigo: 'border-indigo-200 bg-indigo-50',
  blue:   'border-blue-200 bg-blue-50',
  green:  'border-green-200 bg-green-50',
  pink:   'border-pink-200 bg-pink-50',
}
const COLOR_BTN: Record<string, string> = {
  indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  blue:   'bg-blue-600 hover:bg-blue-700 text-white',
  green:  'bg-green-600 hover:bg-green-700 text-white',
  pink:   'bg-pink-600 hover:bg-pink-700 text-white',
}

function FormsContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const patientId    = searchParams.get('patient') || ''

  const [scanning,  setScanning]  = useState<string | null>(null)
  const [scanDone,  setScanDone]  = useState<Record<string, boolean>>({})
  const [copied,    setCopied]    = useState(false)
  const [qrVisible, setQrVisible] = useState(false)
  const [siteUrl,   setSiteUrl]   = useState('')
  const [hs,        setHs]        = useState<Record<string, string>>({})

  useEffect(() => {
    setSiteUrl(window.location.origin)
    setHs(getHospitalSettings())
  }, [])

  const hospitalName = hs.hospitalName || 'NexMedicon Hospital'
  const hospitalAddr = hs.address || ''

  const intakeUrl     = siteUrl ? `${siteUrl}/intake?h=${encodeURIComponent(hospitalName)}` : ''
  const fillablePdfUrl = siteUrl
    ? `/api/generate-pdf?h=${encodeURIComponent(hospitalName)}&a=${encodeURIComponent(hospitalAddr)}`
    : ''

  function copyLink() {
    if (!intakeUrl) return
    navigator.clipboard.writeText(intakeUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  function handleExtracted(formId: string, result: OCRResult) {
    const key = formId === 'patient_registration' || formId === 'fillable_pdf'
      ? 'ocr_prefill_generic'
      : `ocr_prefill_${patientId || 'generic'}`

    try {
      const existing = JSON.parse(sessionStorage.getItem(key) || '{}')
      const merged   = { ...existing }
      if (result.vitals)      merged.vitals      = { ...(merged.vitals      || {}), ...result.vitals      }
      if (result.patient)     merged.patient     = { ...(merged.patient     || {}), ...result.patient     }
      if (result.ob_data)     merged.ob_data     = { ...(merged.ob_data     || {}), ...result.ob_data     }
      if (result.prescription)merged.prescription = result.prescription
      sessionStorage.setItem(key, JSON.stringify(merged))
    } catch { /* ignore storage errors */ }

    setScanDone(prev => ({ ...prev, [formId]: true }))
    setScanning(null)
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600"/> Patient Intake Forms
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Four ways to collect patient information — prioritised best to fallback
          </p>
        </div>

        {/* ── METHOD 1: DIGITAL SELF-REGISTRATION ───────────────── */}
        <div className="card p-5 mb-4 border-2 border-green-300 bg-green-50">
          <div className="flex items-start gap-4">
            <div className="text-3xl flex-shrink-0">📱</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="font-bold text-gray-900 text-lg">Digital Self-Registration</h2>
                <span className="flex items-center gap-1 text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                  <Star className="w-3 h-3"/> Best — Zero errors
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-1">
                Patient fills the form on their own phone. Data goes directly to the system.
                No scanning, no OCR — 100% accurate.
              </p>
              <p className="text-xs text-gray-500 mb-4">
                Works on any phone browser. No app needed. Send via WhatsApp or show QR at reception.
              </p>

              <div className="flex flex-wrap gap-2 mb-4">
                {intakeUrl && (
                  <a href={intakeUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors">
                    <Globe className="w-3.5 h-3.5"/> Open Form
                    <ExternalLink className="w-3 h-3 opacity-70"/>
                  </a>
                )}
                <button onClick={copyLink}
                  className="flex items-center gap-2 text-xs font-semibold border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors">
                  {copied ? <CheckCircle className="w-3.5 h-3.5 text-green-600"/> : <Copy className="w-3.5 h-3.5"/>}
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
                <button onClick={() => setQrVisible(!qrVisible)}
                  className="flex items-center gap-2 text-xs font-semibold border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors">
                  <QrCode className="w-3.5 h-3.5"/>
                  {qrVisible ? 'Hide QR' : 'Show QR Code'}
                </button>
              </div>

              {qrVisible && intakeUrl && (
                <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
                  <img
                    src={`/api/generate-qr?url=${encodeURIComponent(intakeUrl)}&size=200`}
                    alt="Registration QR Code"
                    className="w-32 h-32 flex-shrink-0 rounded-lg"
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-gray-900 mb-1">Print this at reception</p>
                    <p className="text-xs text-gray-500 mb-2">
                      Patient scans with phone camera → registration form opens instantly.
                    </p>
                    <a
                      href={`/api/generate-qr?url=${encodeURIComponent(intakeUrl)}&size=600`}
                      download="registration-qr.png"
                      className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                      <Download className="w-3.5 h-3.5"/> Download QR (PNG for printing)
                    </a>
                  </div>
                </div>
              )}

              {intakeUrl && (
                <p className="text-xs text-gray-400 mt-2 truncate">
                  Link: <span className="font-mono">{intakeUrl}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── METHOD 2: FILLABLE PDF ─────────────────────────────── */}
        <div className="card p-5 mb-4 border-2 border-purple-200 bg-purple-50">
          <div className="flex items-start gap-4">
            <div className="text-3xl flex-shrink-0">📄</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="font-bold text-gray-900 text-lg">Fillable PDF Form</h2>
                <span className="text-xs font-semibold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                  Good for patients who prefer PDF
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-1">
                Patient downloads, fills digitally on their device, sends the PDF back.
                Upload it below — fields are extracted automatically, 100% accurate.
              </p>
              <p className="text-xs text-gray-500 mb-4">
                Works in any PDF viewer. Better than handwriting — no OCR errors on typed text.
              </p>

              <div className="flex flex-wrap gap-2 mb-3">
                {fillablePdfUrl && (
                  <a href={fillablePdfUrl}
                    className="flex items-center gap-2 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition-colors">
                    <Download className="w-3.5 h-3.5"/> Download Fillable PDF
                  </a>
                )}
                {scanning === 'fillable_pdf' ? (
                  <button onClick={() => setScanning(null)}
                    className="text-xs font-semibold border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors">
                    Cancel
                  </button>
                ) : (
                  <button onClick={() => setScanning('fillable_pdf')}
                    className="flex items-center gap-2 text-xs font-semibold border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors">
                    <ScanLine className="w-3.5 h-3.5"/> Upload Filled PDF
                  </button>
                )}
              </div>

              {scanning === 'fillable_pdf' && (
                <FormScanner
                  formType="patient_registration"
                  label="Upload the filled PDF form"
                  onExtracted={result => handleExtracted('fillable_pdf', result)}
                />
              )}

              {scanDone['fillable_pdf'] && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1 text-xs text-green-700">
                    <CheckCircle className="w-3.5 h-3.5"/> PDF read successfully
                  </span>
                  <button onClick={() => router.push('/patients/new?prefill=1')}
                    className="text-xs font-semibold bg-purple-700 text-white px-3 py-1.5 rounded-lg hover:bg-purple-800 transition-colors">
                    Open Registration with Pre-filled Data →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── METHOD 3: QR ON APPOINTMENT CARD ─────────────────── */}
        <div className="card p-5 mb-4 border-2 border-blue-200 bg-blue-50">
          <div className="flex items-start gap-4">
            <div className="text-3xl flex-shrink-0">🔲</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="font-bold text-gray-900 text-lg">QR Code on Appointment Card</h2>
                <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                  Best for pre-booked patients
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-2">
                Print the QR code on the appointment reminder. Patient scans it at home and arrives pre-registered.
              </p>
              <div className="bg-white border border-blue-200 rounded-lg p-3 text-xs">
                <p className="font-semibold text-gray-700 mb-1">WhatsApp message template:</p>
                <p className="text-gray-600 italic">
                  "Dear [Patient], your appointment at {hospitalName} is confirmed.
                  Please fill your registration form before visiting:{' '}
                  {intakeUrl ? intakeUrl.slice(0, 55) + '…' : '[link]'}
                  Show your Patient ID at reception. Thank you!"
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── METHOD 4: PAPER FORMS + SCAN (FALLBACK) ──────────── */}
        <div className="card p-5 border-2 border-gray-200 bg-gray-50">
          <div className="flex items-start gap-4">
            <div className="text-3xl flex-shrink-0">🖨️</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="font-bold text-gray-900 text-lg">Paper Forms + OCR Scan</h2>
                <span className="text-xs font-semibold text-gray-600 bg-gray-200 px-2 py-0.5 rounded-full">
                  Fallback — use when other methods aren't possible
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-1">
                Print the form → patient fills by hand in BLOCK LETTERS → photograph or scan → AI populates fields.
              </p>
              <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap bg-white border border-gray-200 rounded-lg px-3 py-2 mb-3">
                <span className="font-semibold">1 Print</span>
                <ArrowRight className="w-3 h-3 text-gray-400"/>
                <span className="font-semibold">2 Fill (BLOCK LETTERS)</span>
                <ArrowRight className="w-3 h-3 text-gray-400"/>
                <span className="font-semibold">3 Upload Photo or PDF</span>
                <ArrowRight className="w-3 h-3 text-gray-400"/>
                <span className="font-semibold">4 Verify & Save</span>
              </div>

              <div className="space-y-3">
                {PAPER_FORMS.map(form => (
                  <div key={form.id} className={`rounded-xl border p-4 ${COLOR_BORDER[form.color]}`}>
                    <div className="flex items-start gap-3">
                      <span className="text-2xl flex-shrink-0">{form.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold text-gray-900">{form.label}</h3>
                          {scanDone[form.id] && (
                            <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                              <CheckCircle className="w-3 h-3"/> Scanned
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mb-3">{form.desc}</p>

                        <div className="flex gap-2 flex-wrap">
                          <a href={form.file} target="_blank" rel="noreferrer"
                            className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg transition-colors ${COLOR_BTN[form.color]}`}>
                            <Printer className="w-3.5 h-3.5"/> Print Form
                            <ExternalLink className="w-3 h-3 opacity-70"/>
                          </a>

                          {scanning === form.id ? (
                            <button onClick={() => setScanning(null)}
                              className="text-xs font-semibold border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors">
                              Cancel
                            </button>
                          ) : (
                            <button onClick={() => setScanning(form.id)}
                              className="flex items-center gap-2 text-xs font-semibold border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors">
                              <ScanLine className="w-3.5 h-3.5"/> Upload PDF / Photo
                            </button>
                          )}

                          {form.id === 'patient_registration' && scanDone[form.id] && (
                            <button onClick={() => router.push('/patients/new?prefill=1')}
                              className="flex items-center gap-2 text-xs font-semibold bg-gray-800 text-white px-3 py-2 rounded-lg hover:bg-gray-900 transition-colors">
                              Open Registration →
                            </button>
                          )}
                          {patientId && scanDone[form.id] && form.id !== 'patient_registration' && (
                            <button onClick={() => router.push(`/opd/new?patient=${patientId}&prefill=1`)}
                              className="flex items-center gap-2 text-xs font-semibold bg-gray-800 text-white px-3 py-2 rounded-lg hover:bg-gray-900 transition-colors">
                              Open OPD →
                            </button>
                          )}
                        </div>

                        {scanning === form.id && (
                          <div className="mt-3">
                            <FormScanner
                              formType={form.formType}
                              label={`Upload PDF or photo of ${form.label}`}
                              onExtracted={result => handleExtracted(form.id, result)}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-gray-700">Tips for best OCR results:</p>
                <p>• Write in BLOCK CAPITAL LETTERS — no cursive or joined writing</p>
                <p>• Good lighting, flat surface, camera held directly above the form</p>
                <p>• For PDF: fill digitally on phone (much more accurate than handwriting)</p>
                <p>• Always verify auto-filled fields before saving</p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </AppShell>
  )
}

export default function FormsPage() {
  return (
    <Suspense fallback={
      <div className="p-6 flex items-center justify-center h-40">
        <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
      </div>
    }>
      <FormsContent />
    </Suspense>
  )
}
