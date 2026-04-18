'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import FormScanner from '@/components/shared/FormScanner'
import type { OCRResult } from '@/lib/ocr'
import { Printer, ScanLine, FileText, ExternalLink, CheckCircle, ArrowRight } from 'lucide-react'

const FORMS = [
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
    desc:     'Diagnosis, clinical notes, prescription, advice, follow-up date',
    formType: 'opd_consultation' as const,
  },
  {
    id:       'gynecology_ob',
    label:    'Gynecology / OB Exam',
    icon:     '🤰',
    color:    'pink',
    file:     '/forms/gynecology-ob-exam.html',
    desc:     'G/P/A/L, LMP, EDD, per abdomen, per speculum, per vaginum',
    formType: 'anc_card' as const,
  },
]

export default function FormsPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const patientId    = searchParams.get('patient') || ''

  const [scanning, setScanning]   = useState<string | null>(null)
  const [scanDone, setScanDone]   = useState<Record<string, boolean>>({})

  function handleExtracted(formId: string, result: OCRResult) {
    // Store scan result in sessionStorage so OPD new page can pick it up
    const key = `ocr_prefill_${patientId || 'generic'}`
    const existing = JSON.parse(sessionStorage.getItem(key) || '{}')
    const merged = { ...existing }

    // Merge vitals
    if (result.vitals) {
      merged.vitals = { ...(merged.vitals || {}), ...result.vitals }
    }
    // Merge patient data
    if (result.patient) {
      merged.patient = { ...(merged.patient || {}), ...result.patient }
    }
    // Merge OB data
    if (result.ob_data) {
      merged.ob_data = { ...(merged.ob_data || {}), ...result.ob_data }
    }
    // Merge prescription / consultation fields
    if (result.prescription) {
      merged.prescription = result.prescription
    }

    sessionStorage.setItem(key, JSON.stringify(merged))
    setScanDone(prev => ({ ...prev, [formId]: true }))
    setScanning(null)
  }

  const colorMap: Record<string, string> = {
    blue:  'border-blue-200 bg-blue-50',
    green: 'border-green-200 bg-green-50',
    pink:  'border-pink-200 bg-pink-50',
  }
  const btnMap: Record<string, string> = {
    blue:  'bg-blue-600 hover:bg-blue-700 text-white',
    green: 'bg-green-600 hover:bg-green-700 text-white',
    pink:  'bg-pink-600 hover:bg-pink-700 text-white',
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600"/> Paper Forms &amp; Scanning
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Print physical forms → fill by hand → scan to auto-populate the digital record
          </p>
        </div>

        {/* Workflow strip */}
        <div className="card p-4 mb-6 bg-blue-50 border-blue-200">
          <div className="flex items-center gap-3 text-sm text-blue-800 flex-wrap">
            <div className="flex items-center gap-2 font-semibold">
              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">1</span>
              Print form
            </div>
            <ArrowRight className="w-4 h-4 text-blue-400"/>
            <div className="flex items-center gap-2 font-semibold">
              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">2</span>
              Patient fills it
            </div>
            <ArrowRight className="w-4 h-4 text-blue-400"/>
            <div className="flex items-center gap-2 font-semibold">
              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">3</span>
              Receptionist scans filled form
            </div>
            <ArrowRight className="w-4 h-4 text-blue-400"/>
            <div className="flex items-center gap-2 font-semibold">
              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">4</span>
              Fields auto-populate in OPD
            </div>
          </div>
        </div>

        {/* Form cards */}
        <div className="space-y-4">
          {FORMS.map(form => (
            <div key={form.id} className={`card p-5 border-2 ${colorMap[form.color]}`}>
              <div className="flex items-start gap-4">
                <div className="text-3xl flex-shrink-0">{form.icon}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="font-bold text-gray-900 text-lg">{form.label}</h2>
                    {scanDone[form.id] && (
                      <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                        <CheckCircle className="w-3 h-3"/> Scanned &amp; stored
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{form.desc}</p>

                  <div className="flex gap-3 mt-4 flex-wrap">
                    {/* Print button */}
                    <a href={form.file} target="_blank" rel="noreferrer"
                      className={`flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg transition-colors ${btnMap[form.color]}`}>
                      <Printer className="w-3.5 h-3.5"/> Print Form
                      <ExternalLink className="w-3 h-3 opacity-70"/>
                    </a>

                    {/* Scan toggle */}
                    {scanning === form.id ? (
                      <button onClick={() => setScanning(null)}
                        className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
                        Cancel Scan
                      </button>
                    ) : (
                      <button onClick={() => setScanning(form.id)}
                        className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors">
                        <ScanLine className="w-3.5 h-3.5"/> Scan Filled Form
                      </button>
                    )}

                    {/* Go to OPD with prefill if patient selected */}
                    {patientId && scanDone[form.id] && (
                      <button onClick={() => router.push(`/opd/new?patient=${patientId}&prefill=1`)}
                        className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors">
                        Open OPD with Pre-filled Data →
                      </button>
                    )}
                  </div>

                  {/* FormScanner inline */}
                  {scanning === form.id && (
                    <div className="mt-4">
                      <FormScanner
                        formType={form.formType}
                        label={`Scan ${form.label} form`}
                        onExtracted={result => handleExtracted(form.id, result)}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Instruction note */}
        <div className="mt-6 card p-4 bg-amber-50 border-amber-200 text-sm text-amber-800">
          <p className="font-semibold mb-1">📸 Tips for accurate scanning</p>
          <ul className="space-y-1 text-xs list-disc list-inside">
            <li>Place the filled form on a flat, well-lit surface</li>
            <li>Hold the camera directly above the form — not at an angle</li>
            <li>Ensure all text is in focus and within the camera frame</li>
            <li>Write in BLOCK LETTERS — avoid cursive</li>
            <li>After scanning, verify the auto-populated fields in the OPD form before saving</li>
          </ul>
        </div>

        {/* AI key warning */}
        <div className="mt-3 card p-3 bg-gray-50 border-gray-200 text-xs text-gray-500 flex items-start gap-2">
          <ScanLine className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/>
          <span>
            Form scanning requires an AI key (Anthropic or OpenAI). Check{' '}
            <a href="/ai-setup" className="text-blue-600 underline">AI Status</a>{' '}
            if scanning fails.
          </span>
        </div>
      </div>
    </AppShell>
  )
}
