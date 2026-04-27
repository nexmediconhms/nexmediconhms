'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import FormScanner from '@/components/shared/FormScanner'
import type { OCRResult } from '@/lib/ocr'
import { getHospitalSettings, normalizePhone } from '@/lib/utils'
import type { HospitalSettings } from '@/lib/settings'
import {
  Printer, ScanLine, FileText, ExternalLink, CheckCircle,
  Download, Copy, Globe, Star, ChevronRight, ArrowRight,
  AlertCircle, Loader2, Upload, RefreshCw, Send, Phone, MessageSquare
} from 'lucide-react'

// ── Paper form definitions ───────────────────────────────────
const PAPER_FORMS = [
  {
    id: 'patient_registration', label: 'Patient Registration', icon: '📝', color: 'indigo',
    file: '/forms/patient-registration.html', formType: 'patient_registration' as const,
    desc: 'Full name, DOB, gender, blood group, mobile, address, Aadhaar, insurance, consent',
  },
  {
    id: 'vitals_complaints', label: 'Vitals & Complaints', icon: '🩺', color: 'blue',
    file: '/forms/vitals-complaints.html', formType: 'opd_consultation' as const,
    desc: 'Pulse, BP, temperature, SpO₂, weight, height, chief complaint, HPI',
  },
  {
    id: 'consultation_diagnosis', label: 'Consultation & Diagnosis', icon: '📋', color: 'green',
    file: '/forms/consultation-diagnosis.html', formType: 'opd_consultation' as const,
    desc: 'Diagnosis, clinical notes, prescription drugs, advice, follow-up date',
  },
  {
    id: 'gynecology_ob', label: 'Gynecology / OB Exam', icon: '🤰', color: 'pink',
    file: '/forms/gynecology-ob-exam.html', formType: 'anc_card' as const,
    desc: 'G/P/A/L, LMP, EDD, per abdomen, per speculum, per vaginum findings',
  },
]

type Method = 'digital' | 'fillable' | 'qr' | 'paper'

const BORDER: Record<string, string> = {
  indigo: 'border-indigo-200 bg-indigo-50',
  blue:   'border-blue-200 bg-blue-50',
  green:  'border-green-200 bg-green-50',
  pink:   'border-pink-200 bg-pink-50',
}
const BTN: Record<string, string> = {
  indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  blue:   'bg-blue-600 hover:bg-blue-700 text-white',
  green:  'bg-green-600 hover:bg-green-700 text-white',
  pink:   'bg-pink-600 hover:bg-pink-700 text-white',
}

// ── PDF upload widget (uses /api/parse-pdf, not FormScanner) ─
function PdfUploadWidget({ onParsed }: { onParsed: (data: any) => void }) {
  const [status,  setStatus]  = useState<'idle'|'loading'|'done'|'error'>('idle')
  const [msg,     setMsg]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (file.type !== 'application/pdf') {
      setStatus('error'); setMsg('Only PDF files. For photos, use Paper + Scan tab.'); return
    }
    if (file.size > 20 * 1024 * 1024) {
      setStatus('error'); setMsg('File too large. Max 20 MB.'); return
    }
    setStatus('loading'); setMsg('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('form_type', 'patient_registration')
    try {
      const res  = await fetch('/api/parse-pdf', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.error) { setStatus('error'); setMsg(data.error); return }
      setStatus('done')
      setMsg(data._provider?.includes('acroform')
        ? '✓ Form fields read directly — 100% accurate'
        : '✓ PDF text extracted and parsed by AI')
      onParsed(data)
    } catch (e: any) {
      setStatus('error'); setMsg(e.message || 'Upload failed')
    }
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="application/pdf" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}/>

      {status === 'idle' && (
        <button onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 text-sm font-semibold bg-purple-600 hover:bg-purple-700 text-white px-5 py-3 rounded-xl transition-colors">
          <Upload className="w-4 h-4"/> Upload Filled PDF
        </button>
      )}

      {status === 'loading' && (
        <div className="flex items-center gap-3 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
          <Loader2 className="w-5 h-5 text-purple-600 animate-spin flex-shrink-0"/>
          <div>
            <p className="text-sm font-semibold text-purple-800">Reading PDF…</p>
            <p className="text-xs text-purple-600">Extracting form fields</p>
          </div>
        </div>
      )}

      {status === 'done' && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0"/>
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-800">{msg}</p>
            <p className="text-xs text-green-600">Click below to open registration with pre-filled data</p>
          </div>
          <button onClick={() => { setStatus('idle'); setMsg('') }}
            className="text-xs text-gray-400 hover:text-gray-600"><RefreshCw className="w-3.5 h-3.5"/></button>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-2">
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"/>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-700">Could not read PDF</p>
              <p className="text-xs text-red-600 mt-0.5">{msg}</p>
            </div>
            <button onClick={() => { setStatus('idle'); setMsg('') }}
              className="text-xs font-semibold text-red-600 hover:underline whitespace-nowrap">Try again</button>
          </div>
          {(msg.includes('AI') || msg.includes('OPENAI') || msg.includes('ANTHROPIC') || msg.includes('key')) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              <p className="font-semibold mb-1">Fix: Add API key in Vercel</p>
              <p>Go to <strong>Vercel → Project → Settings → Environment Variables</strong> and add:</p>
              <code className="block bg-amber-100 rounded px-2 py-1 mt-1 font-mono">OPENAI_API_KEY = sk-your-key-here</code>
              <p className="mt-1">Then redeploy. <a href="/ai-setup" className="underline font-semibold">Check AI Status →</a></p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FormsContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const patientId    = searchParams.get('patient') || ''

  // Read tab from URL query param (e.g., /forms?tab=digital)
  const tabParam = searchParams.get('tab') as Method | null
  const [active,    setActive]   = useState<Method>(
    tabParam && ['digital', 'fillable', 'qr', 'paper'].includes(tabParam) ? tabParam : 'digital'
  )
  const [scanning,  setScanning] = useState<string | null>(null)
  const [done,      setDone]     = useState<Record<string, boolean>>({})
  const [copied,    setCopied]   = useState(false)
  const [siteUrl,   setSiteUrl]  = useState('')
  const [hs,        setHs]       = useState<HospitalSettings>({} as HospitalSettings)

  // Send-to-patient state
  const [sendPhone,   setSendPhone]   = useState('')
  const [sendSent,    setSendSent]    = useState(false)

  useEffect(() => {
    setSiteUrl(window.location.origin)
    setHs(getHospitalSettings())
  }, [])

  const name       = hs.hospitalName || 'NexMedicon Hospital'
  const addr       = hs.address      || ''
  const intakeUrl  = siteUrl ? `${siteUrl}/intake?h=${encodeURIComponent(name)}` : ''
  const pdfUrl     = siteUrl ? `/api/generate-pdf?h=${encodeURIComponent(name)}&a=${encodeURIComponent(addr)}` : ''
  const qrUrl      = intakeUrl ? `/api/generate-qr?url=${encodeURIComponent(intakeUrl)}&size=220` : ''
  const qrBig      = intakeUrl ? `/api/generate-qr?url=${encodeURIComponent(intakeUrl)}&size=600` : ''

  function copy() {
    if (!intakeUrl) return
    navigator.clipboard.writeText(intakeUrl)
    setCopied(true); setTimeout(() => setCopied(false), 2500)
  }

  function storeOCR(formId: string, result: OCRResult) {
    const key = (formId === 'patient_registration' || formId === 'fillable_pdf')
      ? 'ocr_prefill_generic'
      : `ocr_prefill_${patientId || 'generic'}`
    try {
      const ex: any = JSON.parse(sessionStorage.getItem(key) || '{}')
      if (result.vitals)       ex.vitals       = { ...(ex.vitals||{}),    ...result.vitals       }
      if (result.patient)      ex.patient      = { ...(ex.patient||{}),   ...result.patient      }
      if (result.ob_data)      ex.ob_data      = { ...(ex.ob_data||{}),   ...result.ob_data      }
      if (result.prescription) ex.prescription = result.prescription
      sessionStorage.setItem(key, JSON.stringify(ex))
    } catch { /* ignore */ }
    setDone(p => ({ ...p, [formId]: true }))
    setScanning(null)
  }

  function storeParsedPDF(data: any) {
    try {
      const ex: any = JSON.parse(sessionStorage.getItem('ocr_prefill_generic') || '{}')
      if (data.patient)  ex.patient  = { ...(ex.patient||{}),  ...data.patient  }
      if (data.vitals)   ex.vitals   = { ...(ex.vitals||{}),   ...data.vitals   }
      if (data.ob_data)  ex.ob_data  = { ...(ex.ob_data||{}),  ...data.ob_data  }
      if (data.insurance) {
        ex.patient = {
          ...(ex.patient||{}),
          mediclaim: data.insurance.mediclaim || 'No',
          cashless:  data.insurance.cashless  || 'No',
        }
      }
      sessionStorage.setItem('ocr_prefill_generic', JSON.stringify(ex))
    } catch { /* ignore */ }
    setDone(p => ({ ...p, fillable_pdf: true }))
  }

  const tabs: { id: Method; icon: string; label: string; badge: string; cls: string }[] = [
    { id: 'digital',  icon: '📱', label: 'Digital Form',  badge: '⭐ Best',        cls: 'bg-green-100 text-green-700'  },
    { id: 'fillable', icon: '📄', label: 'Fillable PDF',  badge: 'Very accurate', cls: 'bg-purple-100 text-purple-700'},
    { id: 'qr',       icon: '🔲', label: 'QR Code',       badge: 'Appointments',  cls: 'bg-blue-100 text-blue-700'   },
    { id: 'paper',    icon: '🖨️', label: 'Paper + Scan',  badge: 'Fallback',      cls: 'bg-gray-100 text-gray-600'   },
  ]

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">

        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600"/> Patient Intake Forms
          </h1>
          <p className="text-sm text-gray-500 mt-1">Four methods — use the best one available</p>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActive(t.id)}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                active === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-200'
              }`}>
              <span className="text-xl">{t.icon}</span>
              <span className={`text-xs font-bold ${active === t.id ? 'text-blue-700' : 'text-gray-700'}`}>{t.label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${t.cls}`}>{t.badge}</span>
            </button>
          ))}
        </div>

        {/* ── DIGITAL ─────────────────────────────────────────────── */}
        {active === 'digital' && (
          <div className="card p-6 border-2 border-green-300 bg-green-50">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-2xl">📱</span>
              <h2 className="text-xl font-bold text-gray-900">Digital Self-Registration</h2>
              <span className="flex items-center gap-1 text-xs font-bold text-green-700 bg-green-200 px-2 py-1 rounded-full">
                <Star className="w-3 h-3"/> Zero errors
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Patient fills the form on their own phone. Data goes directly into the system — no scanning, no errors.
              Works on any phone browser, no app install needed.
            </p>

            {intakeUrl ? (
              <div className="space-y-3">

                {/* ── Send to Patient via WhatsApp (PRIMARY ACTION) ── */}
                <div className="bg-white border-2 border-green-400 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                      <Send className="w-4 h-4 text-green-600"/>
                    </div>
                    <div>
                      <p className="font-bold text-sm text-gray-900">Send Registration Link to Patient</p>
                      <p className="text-xs text-gray-500">Enter patient's mobile → send via WhatsApp instantly</p>
                    </div>
                  </div>

                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-gray-600 mb-1">
                        <Phone className="w-3 h-3 inline mr-1"/>Patient's Mobile Number
                      </label>
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={14}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base font-mono focus:ring-2 focus:ring-green-500 focus:border-green-500 focus:outline-none"
                        placeholder="Enter 10-digit mobile number"
                        value={sendPhone}
                        onChange={e => {
                          setSendPhone(normalizePhone(e.target.value))
                          setSendSent(false)
                        }}
                      />
                    </div>
                    <a
                      href={sendPhone.length === 10
                        ? `https://wa.me/91${sendPhone}?text=${encodeURIComponent(
                            `Dear Patient,\n\nPlease fill your registration form before your visit to *${name}*:\n\n👉 ${intakeUrl}\n\nAfter filling, show your Patient ID at reception.\n\nThank you!\n${name}`
                          )}`
                        : '#'
                      }
                      target={sendPhone.length === 10 ? '_blank' : undefined}
                      rel="noreferrer"
                      onClick={e => {
                        if (sendPhone.length !== 10) {
                          e.preventDefault()
                          return
                        }
                        setSendSent(true)
                      }}
                      className={`flex items-center gap-2 font-semibold px-5 py-2.5 rounded-lg text-sm transition-all whitespace-nowrap ${
                        sendPhone.length === 10
                          ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                          : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4"/>
                      Send via WhatsApp
                    </a>
                  </div>

                  {sendSent && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0"/>
                      <span>WhatsApp opened for <strong>+91 {sendPhone}</strong>. Click send in WhatsApp to deliver the link.</span>
                    </div>
                  )}

                  {sendPhone.length > 0 && sendPhone.length < 10 && (
                    <p className="mt-1 text-xs text-amber-600">Enter a valid 10-digit mobile number</p>
                  )}
                </div>

                {/* ── Registration Link (for copy/share) ── */}
                <div className="bg-white border border-green-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Registration Link</p>
                  <code className="block text-xs text-gray-700 bg-gray-50 rounded-lg px-3 py-2 mb-3 break-all">{intakeUrl}</code>
                  <div className="flex gap-2 flex-wrap">
                    <a href={intakeUrl} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">
                      <Globe className="w-3.5 h-3.5"/> Open Form <ExternalLink className="w-3 h-3 opacity-70"/>
                    </a>
                    <button onClick={copy}
                      className="flex items-center gap-1.5 text-xs font-semibold border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg">
                      {copied ? <CheckCircle className="w-3.5 h-3.5 text-green-600"/> : <Copy className="w-3.5 h-3.5"/>}
                      {copied ? 'Copied!' : 'Copy Link'}
                    </button>
                    <a href={`https://wa.me/?text=${encodeURIComponent(`Dear Patient,\n\nPlease fill your registration form before your visit to ${name}:\n${intakeUrl}\n\nShow your Patient ID at reception. Thank you!`)}`}
                      target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs font-semibold bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg">
                      📲 WhatsApp (pick contact)
                    </a>
                  </div>
                </div>

                {/* ── QR Code ── */}
                <div className="bg-white border border-green-200 rounded-xl p-4 flex items-center gap-4">
                  <img src={qrUrl} alt="QR Code" className="w-28 h-28 flex-shrink-0 rounded-lg"/>
                  <div>
                    <p className="font-semibold text-sm text-gray-800 mb-1">Print QR at reception desk</p>
                    <p className="text-xs text-gray-500 mb-2">Patient scans with camera → form opens instantly</p>
                    <a href={qrBig} download="registration-qr.png"
                      className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                      <Download className="w-3.5 h-3.5"/> Download for printing
                    </a>
                  </div>
                </div>
              </div>
            ) : <div className="flex items-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>}
          </div>
        )}

        {/* ── FILLABLE PDF ─────────────────────────────────────────── */}
        {active === 'fillable' && (
          <div className="card p-6 border-2 border-purple-200 bg-purple-50">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-2xl">📄</span>
              <h2 className="text-xl font-bold text-gray-900">Fillable PDF Form</h2>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Patient downloads the PDF, fills it digitally (typed text — no handwriting), and sends it back.
              Upload below — fields are extracted directly with 100% accuracy.
            </p>

            <div className="space-y-4">
              {/* Step 1 */}
              <div className="bg-white border border-purple-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-7 h-7 bg-purple-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">1</span>
                  <p className="font-semibold text-gray-800">Download &amp; share with patient</p>
                </div>
                {pdfUrl
                  ? <a href={pdfUrl} className="flex items-center gap-2 text-sm font-semibold bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-xl w-fit">
                      <Download className="w-4 h-4"/> Download Fillable PDF
                    </a>
                  : <div className="text-sm text-gray-400">Loading…</div>
                }
                <p className="text-xs text-gray-400 mt-2">Share via WhatsApp. Patient opens in Adobe Reader, fills on phone, sends back.</p>
              </div>

              {/* Step 2 */}
              <div className="bg-white border border-purple-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-7 h-7 bg-purple-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">2</span>
                  <p className="font-semibold text-gray-800">Upload the filled PDF</p>
                </div>
                <PdfUploadWidget onParsed={data => storeParsedPDF(data)}/>
                {done['fillable_pdf'] && (
                  <button onClick={() => router.push('/patients/new?prefill=1')}
                    className="flex items-center gap-2 mt-3 text-sm font-semibold bg-purple-700 hover:bg-purple-800 text-white px-5 py-2.5 rounded-xl">
                    Open Registration with Pre-filled Data <ChevronRight className="w-4 h-4"/>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── QR CODE ─────────────────────────────────────────────── */}
        {active === 'qr' && (
          <div className="card p-6 border-2 border-blue-200 bg-blue-50">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-2xl">🔲</span>
              <h2 className="text-xl font-bold text-gray-900">QR Code for Appointments</h2>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Send with appointment confirmations. Patient scans at home and arrives pre-registered.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border border-blue-200 rounded-xl p-4 flex flex-col items-center gap-3">
                {qrUrl
                  ? <img src={qrUrl} alt="QR Code" className="w-44 h-44 rounded-xl"/>
                  : <div className="w-44 h-44 bg-gray-100 rounded-xl flex items-center justify-center"><Loader2 className="w-6 h-6 text-gray-400 animate-spin"/></div>
                }
                <p className="text-xs text-gray-500 text-center">Patient scans → form opens instantly</p>
                {qrBig && (
                  <a href={qrBig} download="appointment-qr.png"
                    className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                    <Download className="w-3.5 h-3.5"/> Download for printing
                  </a>
                )}
              </div>
              <div className="bg-white border border-blue-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">WhatsApp Template</p>
                <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 leading-relaxed mb-3">
                  Dear [Name],<br/><br/>
                  Your appointment at <b>{name}</b> is confirmed.<br/><br/>
                  Fill registration before visiting:<br/>
                  <span className="text-blue-600 break-all">{intakeUrl || '…'}</span><br/><br/>
                  Show your Patient ID at reception. Thank you!
                </div>
                <button onClick={copy}
                  className="flex items-center gap-2 text-xs font-semibold border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg">
                  {copied ? <CheckCircle className="w-3.5 h-3.5"/> : <Copy className="w-3.5 h-3.5"/>}
                  {copied ? 'Copied!' : 'Copy Registration Link'}
                </button>
              </div>
            </div>
            <div className="mt-4 bg-blue-100 rounded-xl p-3 text-xs text-blue-800">
              <span className="font-semibold">Flow: </span>
              {['Book appointment','Send WhatsApp with QR','Patient fills at home','Arrives with MRN','Staff finds by MRN'].map((s,i,a) => (
                <span key={s}>{s}{i < a.length-1 && <ArrowRight className="w-3 h-3 inline mx-1"/>}</span>
              ))}
            </div>
          </div>
        )}

        {/* ── PAPER + SCAN ─────────────────────────────────────────── */}
        {active === 'paper' && (
          <div className="card p-6 border-2 border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-2xl">🖨️</span>
              <h2 className="text-xl font-bold text-gray-900">Paper Forms + OCR Scan</h2>
              <span className="text-xs font-semibold text-gray-600 bg-gray-200 px-2 py-1 rounded-full">Fallback only</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-xl px-4 py-2.5 mb-4 flex-wrap">
              {['Print','Patient fills (BLOCK LETTERS)','Upload photo/PDF','Verify & Save'].map((s,i) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="w-4 h-4 bg-gray-700 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">{i+1}</span>
                  <span>{s}</span>
                  {i < 3 && <ArrowRight className="w-3 h-3 text-gray-400"/>}
                </span>
              ))}
            </div>
            <div className="space-y-3 mb-4">
              {PAPER_FORMS.map(f => (
                <div key={f.id} className={`rounded-xl border-2 p-4 ${BORDER[f.color]}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-xl flex-shrink-0">{f.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-semibold text-sm text-gray-900">{f.label}</h3>
                        {done[f.id] && <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full"><CheckCircle className="w-3 h-3"/> Scanned</span>}
                      </div>
                      <p className="text-xs text-gray-500 mb-3">{f.desc}</p>
                      <div className="flex gap-2 flex-wrap">
                        <a href={f.file} target="_blank" rel="noreferrer"
                          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg ${BTN[f.color]}`}>
                          <Printer className="w-3.5 h-3.5"/> Print <ExternalLink className="w-3 h-3 opacity-70"/>
                        </a>
                        {scanning === f.id
                          ? <button onClick={() => setScanning(null)} className="text-xs font-semibold border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-lg">Cancel</button>
                          : <button onClick={() => setScanning(f.id)} className="flex items-center gap-1.5 text-xs font-semibold border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg">
                              <ScanLine className="w-3.5 h-3.5"/> Upload Photo / PDF
                            </button>
                        }
                        {f.id === 'patient_registration' && done[f.id] && (
                          <button onClick={() => router.push('/patients/new?prefill=1')} className="flex items-center gap-1.5 text-xs font-semibold bg-gray-800 text-white px-3 py-2 rounded-lg hover:bg-gray-900">Open Registration <ChevronRight className="w-3 h-3"/></button>
                        )}
                        {patientId && done[f.id] && f.id !== 'patient_registration' && (
                          <button onClick={() => router.push(`/opd/new?patient=${patientId}&prefill=1`)} className="flex items-center gap-1.5 text-xs font-semibold bg-gray-800 text-white px-3 py-2 rounded-lg hover:bg-gray-900">Open OPD <ChevronRight className="w-3 h-3"/></button>
                        )}
                      </div>
                      {scanning === f.id && (
                        <div className="mt-3">
                          <FormScanner formType={f.formType} label={`Upload photo or PDF of ${f.label}`}
                            onExtracted={r => storeOCR(f.id, r)}/>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-xs text-gray-600 space-y-1">
              <p className="font-semibold text-gray-700">Tips for accurate OCR:</p>
              <p>• PDF upload uses direct field extraction (no AI key needed for fillable PDFs)</p>
              <p>• Photo upload: write in BLOCK CAPITAL LETTERS, good lighting, camera directly above</p>
              <p>• <a href="/ai-setup" className="text-blue-600 underline">Check AI Status</a> if reading fails</p>
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
