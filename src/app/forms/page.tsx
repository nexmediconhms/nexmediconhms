'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import FormScanner from '@/components/shared/FormScanner'
import type { OCRResult } from '@/lib/ocr'
import { getHospitalSettings } from '@/lib/utils'
import {
  Printer, ScanLine, FileText, ExternalLink,
  CheckCircle, QrCode, Download, Copy, Globe,
  Star, ChevronRight, ArrowRight, AlertCircle, Loader2
} from 'lucide-react'

const PAPER_FORMS = [
  {
    id: 'patient_registration', label: 'Patient Registration', icon: '📝', color: 'indigo',
    file: '/forms/patient-registration.html',
    desc: 'Full name, DOB, gender, blood group, mobile, address, Aadhaar, insurance, consent',
    formType: 'patient_registration' as const,
  },
  {
    id: 'vitals_complaints', label: 'Vitals & Complaints', icon: '🩺', color: 'blue',
    file: '/forms/vitals-complaints.html',
    desc: 'Pulse, BP, temperature, SpO₂, weight, height, chief complaint, HPI',
    formType: 'opd_consultation' as const,
  },
  {
    id: 'consultation_diagnosis', label: 'Consultation & Diagnosis', icon: '📋', color: 'green',
    file: '/forms/consultation-diagnosis.html',
    desc: 'Diagnosis, clinical notes, prescription drugs, advice, follow-up date',
    formType: 'opd_consultation' as const,
  },
  {
    id: 'gynecology_ob', label: 'Gynecology / OB Exam', icon: '🤰', color: 'pink',
    file: '/forms/gynecology-ob-exam.html',
    desc: 'G/P/A/L, LMP, EDD, per abdomen, per speculum, per vaginum findings',
    formType: 'anc_card' as const,
  },
]

type Method = 'digital' | 'fillable' | 'qr' | 'paper'

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

  const [activeMethod, setActiveMethod] = useState<Method>('digital')
  const [scanning,     setScanning]     = useState<string | null>(null)
  const [scanDone,     setScanDone]     = useState<Record<string, boolean>>({})
  const [copied,       setCopied]       = useState(false)
  const [siteUrl,      setSiteUrl]      = useState('')
  const [hs,           setHs]           = useState<Record<string, string>>({})

  useEffect(() => {
    setSiteUrl(window.location.origin)
    setHs(getHospitalSettings())
  }, [])

  const hospitalName   = hs.hospitalName || 'NexMedicon Hospital'
  const hospitalAddr   = hs.address || ''
  const intakeUrl      = siteUrl ? `${siteUrl}/intake?h=${encodeURIComponent(hospitalName)}` : ''
  const fillablePdfUrl = siteUrl
    ? `/api/generate-pdf?h=${encodeURIComponent(hospitalName)}&a=${encodeURIComponent(hospitalAddr)}`
    : ''
  const qrUrl = intakeUrl
    ? `/api/generate-qr?url=${encodeURIComponent(intakeUrl)}&size=240`
    : ''

  function copyLink() {
    if (!intakeUrl) return
    navigator.clipboard.writeText(intakeUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  function handleExtracted(formId: string, result: OCRResult) {
    const key = (formId === 'patient_registration' || formId === 'fillable_pdf')
      ? 'ocr_prefill_generic'
      : `ocr_prefill_${patientId || 'generic'}`
    try {
      const existing = JSON.parse(sessionStorage.getItem(key) || '{}')
      const merged: any = { ...existing }
      if (result.vitals)       merged.vitals       = { ...(merged.vitals       || {}), ...result.vitals       }
      if (result.patient)      merged.patient      = { ...(merged.patient      || {}), ...result.patient      }
      if (result.ob_data)      merged.ob_data      = { ...(merged.ob_data      || {}), ...result.ob_data      }
      if (result.prescription) merged.prescription = result.prescription
      sessionStorage.setItem(key, JSON.stringify(merged))
    } catch { /* ignore */ }
    setScanDone(prev => ({ ...prev, [formId]: true }))
    setScanning(null)
  }

  const tabs: { id: Method; icon: string; label: string; badge: string; cls: string }[] = [
    { id: 'digital',  icon: '📱', label: 'Digital Form',  badge: '⭐ Best',          cls: 'bg-green-100 text-green-700'  },
    { id: 'fillable', icon: '📄', label: 'Fillable PDF',  badge: 'Accurate',         cls: 'bg-purple-100 text-purple-700'},
    { id: 'qr',       icon: '🔲', label: 'QR Code',       badge: 'Appointments',     cls: 'bg-blue-100 text-blue-700'   },
    { id: 'paper',    icon: '🖨️', label: 'Paper + Scan',  badge: 'Fallback',         cls: 'bg-gray-100 text-gray-600'   },
  ]

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">

        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600"/> Patient Intake Forms
          </h1>
          <p className="text-sm text-gray-500 mt-1">Four methods to collect patient information — choose the best one</p>
        </div>

        {/* Method tabs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveMethod(t.id)}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                activeMethod === t.id ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-blue-200'
              }`}>
              <span className="text-xl">{t.icon}</span>
              <span className={`text-xs font-bold ${activeMethod === t.id ? 'text-blue-700' : 'text-gray-700'}`}>{t.label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${t.cls}`}>{t.badge}</span>
            </button>
          ))}
        </div>

        {/* ── DIGITAL ─────────────────────────────────────────────── */}
        {activeMethod === 'digital' && (
          <div className="card p-6 border-2 border-green-300 bg-green-50">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-2xl">📱</span>
              <h2 className="text-xl font-bold text-gray-900">Digital Self-Registration</h2>
              <span className="flex items-center gap-1 text-xs font-bold text-green-700 bg-green-200 px-2 py-1 rounded-full">
                <Star className="w-3 h-3"/> 100% accurate — no OCR errors
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Patient fills the form on their own phone. Data goes directly into the system. No scanning needed.
              Works on any phone browser — no app install required.
            </p>

            {intakeUrl ? (
              <div className="space-y-4">
                {/* Link box */}
                <div className="bg-white border border-green-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Patient Registration Link</p>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
                    <code className="text-xs text-gray-700 flex-1 break-all">{intakeUrl}</code>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <a href={intakeUrl} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">
                      <Globe className="w-3.5 h-3.5"/> Open Form <ExternalLink className="w-3 h-3 opacity-70"/>
                    </a>
                    <button onClick={copyLink}
                      className="flex items-center gap-2 text-xs font-semibold border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg">
                      {copied ? <CheckCircle className="w-3.5 h-3.5 text-green-600"/> : <Copy className="w-3.5 h-3.5"/>}
                      {copied ? 'Copied!' : 'Copy Link'}
                    </button>
                    <a href={`https://wa.me/?text=${encodeURIComponent(`Dear Patient,\n\nPlease fill your registration form before your visit to ${hospitalName}:\n${intakeUrl}\n\nShow your Patient ID at reception. Thank you!`)}`}
                      target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 text-xs font-semibold bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg">
                      📲 Send via WhatsApp
                    </a>
                  </div>
                </div>

                {/* QR code */}
                <div className="bg-white border border-green-200 rounded-xl p-4 flex items-center gap-4 flex-wrap">
                  <div className="bg-white border border-gray-100 rounded-xl p-1.5 flex-shrink-0">
                    <img src={qrUrl} alt="Registration QR Code" className="w-28 h-28"/>
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-800 mb-1">Print &amp; display at reception desk</p>
                    <p className="text-xs text-gray-500 mb-2">Patient scans with camera → form opens instantly</p>
                    <a href={`/api/generate-qr?url=${encodeURIComponent(intakeUrl)}&size=600`}
                      download="patient-registration-qr.png"
                      className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline">
                      <Download className="w-3.5 h-3.5"/> Download QR for printing
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin"/> Loading…
              </div>
            )}
          </div>
        )}

        {/* ── FILLABLE PDF ─────────────────────────────────────────── */}
        {activeMethod === 'fillable' && (
          <div className="card p-6 border-2 border-purple-200 bg-purple-50">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-2xl">📄</span>
              <h2 className="text-xl font-bold text-gray-900">Fillable PDF Form</h2>
              <span className="text-xs font-semibold text-purple-700 bg-purple-100 px-2 py-1 rounded-full">
                Patient fills digitally → upload → auto-populate
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Patient downloads the PDF, fills it on their phone or computer, and sends it back.
              Upload below — fields populate automatically with 100% accuracy (typed text, no handwriting).
            </p>

            {/* Step 1 */}
            <div className="bg-white border border-purple-200 rounded-xl p-4 mb-3">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                <p className="text-sm font-semibold text-gray-800">Download &amp; share with patient</p>
              </div>
              {fillablePdfUrl && (
                <a href={fillablePdfUrl}
                  className="flex items-center gap-2 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-lg w-fit">
                  <Download className="w-3.5 h-3.5"/> Download Fillable PDF
                </a>
              )}
              <p className="text-xs text-gray-400 mt-2">Send via WhatsApp or email. Patient fills in Adobe Reader, Preview, or any PDF app.</p>
            </div>

            {/* Step 2 */}
            <div className="bg-white border border-purple-200 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                <p className="text-sm font-semibold text-gray-800">Upload the filled PDF</p>
              </div>
              {scanning === 'fillable_pdf' ? (
                <div>
                  <FormScanner
                    formType="patient_registration"
                    label="Upload the filled PDF"
                    onExtracted={result => handleExtracted('fillable_pdf', result)}
                  />
                  <button onClick={() => setScanning(null)}
                    className="mt-2 text-xs text-gray-500 hover:text-gray-700 underline">Cancel</button>
                </div>
              ) : scanDone['fillable_pdf'] ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1 text-sm font-semibold text-green-700">
                    <CheckCircle className="w-4 h-4"/> PDF read — fields populated
                  </span>
                  <button onClick={() => router.push('/patients/new?prefill=1')}
                    className="flex items-center gap-2 text-xs font-semibold bg-purple-700 text-white px-4 py-2 rounded-lg hover:bg-purple-800">
                    Open Registration with Pre-filled Data <ChevronRight className="w-3 h-3"/>
                  </button>
                </div>
              ) : (
                <button onClick={() => setScanning('fillable_pdf')}
                  className="flex items-center gap-2 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-lg">
                  <ScanLine className="w-3.5 h-3.5"/> Upload Filled PDF
                </button>
              )}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/>
              <div>
                <p className="font-semibold">PDF parsing requires an AI key</p>
                <p className="mt-0.5">Add <code className="bg-amber-100 px-1 rounded">OPENAI_API_KEY</code> or{' '}
                  <code className="bg-amber-100 px-1 rounded">ANTHROPIC_API_KEY</code> in Vercel → Settings → Environment Variables.
                  Then <a href="/ai-setup" className="underline font-semibold">check AI Status →</a></p>
              </div>
            </div>
          </div>
        )}

        {/* ── QR CODE ─────────────────────────────────────────────── */}
        {activeMethod === 'qr' && (
          <div className="card p-6 border-2 border-blue-200 bg-blue-50">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-2xl">🔲</span>
              <h2 className="text-xl font-bold text-gray-900">QR Code on Appointment Card</h2>
              <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-1 rounded-full">
                Best for pre-booked appointments
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Send the QR with the appointment confirmation. Patient scans at home and arrives pre-registered.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="bg-white border border-blue-200 rounded-xl p-4 flex flex-col items-center gap-3">
                {qrUrl
                  ? <img src={qrUrl} alt="Registration QR Code" className="w-44 h-44"/>
                  : <div className="w-44 h-44 bg-gray-100 rounded-xl flex items-center justify-center"><Loader2 className="w-6 h-6 text-gray-400 animate-spin"/></div>
                }
                <p className="text-xs text-gray-500 text-center">Patient scans → form opens instantly</p>
                {qrUrl && (
                  <a href={`/api/generate-qr?url=${encodeURIComponent(intakeUrl)}&size=600`}
                    download="appointment-qr.png"
                    className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline">
                    <Download className="w-3.5 h-3.5"/> Download for printing
                  </a>
                )}
              </div>

              <div className="bg-white border border-blue-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">WhatsApp Template</p>
                <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 leading-relaxed mb-3">
                  Dear [Name],<br/><br/>
                  Your appointment at <b>{hospitalName}</b> is confirmed.<br/><br/>
                  Please fill your form before visiting:<br/>
                  <span className="text-blue-600 break-all">{intakeUrl || '[link loading…]'}</span><br/><br/>
                  Show your Patient ID at reception. Thank you!
                </div>
                <button onClick={copyLink}
                  className="flex items-center gap-2 text-xs font-semibold border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg">
                  {copied ? <CheckCircle className="w-3.5 h-3.5"/> : <Copy className="w-3.5 h-3.5"/>}
                  {copied ? 'Link Copied!' : 'Copy Registration Link'}
                </button>
              </div>
            </div>

            <div className="bg-blue-100 rounded-xl p-3 text-xs text-blue-800">
              <p className="font-semibold mb-1">End-to-end flow:</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span>Book appointment</span><ArrowRight className="w-3 h-3"/>
                <span>Send WhatsApp with link/QR</span><ArrowRight className="w-3 h-3"/>
                <span>Patient fills at home</span><ArrowRight className="w-3 h-3"/>
                <span>Patient arrives with MRN</span><ArrowRight className="w-3 h-3"/>
                <span>Staff looks up by MRN</span>
              </div>
            </div>
          </div>
        )}

        {/* ── PAPER + SCAN ─────────────────────────────────────────── */}
        {activeMethod === 'paper' && (
          <div className="card p-6 border-2 border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-2xl">🖨️</span>
              <h2 className="text-xl font-bold text-gray-900">Paper Forms + OCR Scan</h2>
              <span className="text-xs font-semibold text-gray-600 bg-gray-200 px-2 py-1 rounded-full">Fallback only</span>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-xl px-4 py-2.5 mb-4 flex-wrap">
              {['Print form','Patient fills (BLOCK LETTERS)','Upload photo or PDF','Verify & Save'].map((s, i) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="w-4 h-4 bg-gray-700 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">{i+1}</span>
                  <span className="font-medium">{s}</span>
                  {i < 3 && <ArrowRight className="w-3 h-3 text-gray-400"/>}
                </span>
              ))}
            </div>

            <div className="space-y-3 mb-4">
              {PAPER_FORMS.map(form => (
                <div key={form.id} className={`rounded-xl border-2 p-4 ${COLOR_BORDER[form.color]}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-xl flex-shrink-0">{form.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-semibold text-sm text-gray-900">{form.label}</h3>
                        {scanDone[form.id] && (
                          <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                            <CheckCircle className="w-3 h-3"/> Scanned
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mb-3">{form.desc}</p>
                      <div className="flex gap-2 flex-wrap">
                        <a href={form.file} target="_blank" rel="noreferrer"
                          className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg ${COLOR_BTN[form.color]}`}>
                          <Printer className="w-3.5 h-3.5"/> Print <ExternalLink className="w-3 h-3 opacity-70"/>
                        </a>
                        {scanning === form.id ? (
                          <button onClick={() => setScanning(null)}
                            className="text-xs font-semibold border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-lg">
                            Cancel
                          </button>
                        ) : (
                          <button onClick={() => setScanning(form.id)}
                            className="flex items-center gap-2 text-xs font-semibold border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg">
                            <ScanLine className="w-3.5 h-3.5"/> Upload Photo / PDF
                          </button>
                        )}
                        {form.id === 'patient_registration' && scanDone[form.id] && (
                          <button onClick={() => router.push('/patients/new?prefill=1')}
                            className="flex items-center gap-2 text-xs font-semibold bg-gray-800 text-white px-3 py-2 rounded-lg hover:bg-gray-900">
                            Open Registration <ChevronRight className="w-3 h-3"/>
                          </button>
                        )}
                        {patientId && scanDone[form.id] && form.id !== 'patient_registration' && (
                          <button onClick={() => router.push(`/opd/new?patient=${patientId}&prefill=1`)}
                            className="flex items-center gap-2 text-xs font-semibold bg-gray-800 text-white px-3 py-2 rounded-lg hover:bg-gray-900">
                            Open OPD <ChevronRight className="w-3 h-3"/>
                          </button>
                        )}
                      </div>
                      {scanning === form.id && (
                        <div className="mt-3">
                          <FormScanner
                            formType={form.formType}
                            label={`Upload photo or PDF of ${form.label}`}
                            onExtracted={result => handleExtracted(form.id, result)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4 text-xs text-gray-600 space-y-1">
              <p className="font-semibold text-gray-700">Tips:</p>
              <p>• <strong>PDF upload requires AI key</strong> — add OPENAI_API_KEY or ANTHROPIC_API_KEY in Vercel env vars</p>
              <p>• Photo upload: free Tesseract or AI mode — write in BLOCK CAPITAL LETTERS only</p>
              <p>• Good lighting, camera directly above, no shadows or angles</p>
              <p>• <a href="/ai-setup" className="text-blue-600 underline">Check AI Status page</a> if reading fails</p>
            </div>
          </div>
        )}

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
