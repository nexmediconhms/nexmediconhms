'use client'
/**
 * src/components/ipd/DischargeModal.tsx
 *
 * Enhanced Discharge Modal — proper workflow:
 *  1. Shows patient + admission details
 *  2. Collects discharge info (condition, diagnosis, advice, follow-up)
 *  3. Calls /api/ipd/discharge
 *  4. Shows success notification with summary
 *  5. Redirects to patient profile
 *
 * Replaces the simple "markDischarged" confirmation in IPD Census.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LogOut, X, CheckCircle, Loader2, AlertCircle,
  Calendar, FileText, Heart, Pill, User, BedDouble,
} from 'lucide-react'

interface Admission {
  id: string
  patient_id: string
  patient_name: string
  mrn: string
  mobile: string
  bed_id: string
  bed_number: string
  ward: string
  admission_date: string
  admitting_doctor: string
  diagnosis_on_admission: string
  chief_complaint: string
  insurance_details: string
}

interface DischargeModalProps {
  admission: Admission
  onClose: () => void
  onDischarged: () => void
  currentDoctor?: string
}

export default function DischargeModal({
  admission,
  onClose,
  onDischarged,
  currentDoctor = '',
}: DischargeModalProps) {
  const router = useRouter()
  const [step, setStep] = useState<'form' | 'processing' | 'success' | 'error'>('form')
  const [result, setResult] = useState<any>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const [form, setForm] = useState({
    discharge_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    discharge_time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }),
    condition_at_discharge: 'Satisfactory',
    final_diagnosis: admission.diagnosis_on_admission || '',
    discharge_advice: '',
    medications_at_discharge: '',
    follow_up_date: '',
    follow_up_note: '',
    discharged_by: currentDoctor || admission.admitting_doctor || '',
  })

  function setField(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleDischarge() {
    if (!form.condition_at_discharge) {
      setErrorMsg('Please select condition at discharge')
      return
    }

    setStep('processing')
    setErrorMsg('')

    try {
      const res = await fetch('/api/ipd/discharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admission_id: admission.id,
          ...form,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setStep('error')
        setErrorMsg(data.error || 'Discharge failed')
        return
      }

      setResult(data)
      setStep('success')
      onDischarged()

      // Auto-redirect to patient profile after 3 seconds
      setTimeout(() => {
        router.push(data.redirect || `/patients/${admission.patient_id}`)
      }, 3000)
    } catch (err: any) {
      setStep('error')
      setErrorMsg(err.message || 'Network error')
    }
  }

  const daysSince = Math.floor(
    (Date.now() - new Date(admission.admission_date).getTime()) / (1000 * 60 * 60 * 24)
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={e => { if (e.target === e.currentTarget && step === 'form') onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* ═══ FORM STEP ═══ */}
        {step === 'form' && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <LogOut className="w-5 h-5 text-red-500" />
                Discharge Patient
              </h2>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Patient Summary */}
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-red-600" />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-gray-900">{admission.patient_name}</div>
                  <div className="text-xs text-gray-500">
                    {admission.mrn} · Bed {admission.bed_number} · {admission.ward}
                  </div>
                  <div className="text-xs text-gray-400">
                    Admitted: {admission.admission_date} ({daysSince} days) · Dr. {admission.admitting_doctor}
                  </div>
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl p-3 text-sm mb-4">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {errorMsg}
              </div>
            )}

            {/* Discharge Form */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Discharge Date</label>
                  <input type="date" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                    value={form.discharge_date} onChange={e => setField('discharge_date', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Discharge Time</label>
                  <input type="time" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                    value={form.discharge_time} onChange={e => setField('discharge_time', e.target.value)} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Condition at Discharge *</label>
                <select className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                  value={form.condition_at_discharge} onChange={e => setField('condition_at_discharge', e.target.value)}>
                  {['Satisfactory', 'Stable', 'Fair', 'Improving', 'Poor', 'Critical', 'Against Medical Advice (LAMA)'].map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Final Diagnosis</label>
                <input type="text" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                  placeholder="Final diagnosis at discharge"
                  value={form.final_diagnosis} onChange={e => setField('final_diagnosis', e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Discharge Advice</label>
                <textarea className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none" rows={3}
                  placeholder="Diet, activity, wound care, warning signs, etc."
                  value={form.discharge_advice} onChange={e => setField('discharge_advice', e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Medications at Discharge</label>
                <textarea className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none" rows={2}
                  placeholder="e.g. Tab Augmentin 625mg BD x 5d, Tab Zerodol-SP TDS x 3d"
                  value={form.medications_at_discharge} onChange={e => setField('medications_at_discharge', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Follow-up Date</label>
                  <input type="date" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                    min={form.discharge_date}
                    value={form.follow_up_date} onChange={e => setField('follow_up_date', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Follow-up Note</label>
                  <input type="text" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                    placeholder="e.g. Suture removal"
                    value={form.follow_up_note} onChange={e => setField('follow_up_note', e.target.value)} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Discharged By</label>
                <input type="text" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                  value={form.discharged_by} onChange={e => setField('discharged_by', e.target.value)} />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-6">
              <button onClick={onClose} className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleDischarge}
                className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center justify-center gap-2">
                <LogOut className="w-4 h-4" /> Confirm Discharge
              </button>
            </div>
          </div>
        )}

        {/* ═══ PROCESSING STEP ═══ */}
        {step === 'processing' && (
          <div className="p-8 text-center">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <h3 className="text-lg font-bold text-gray-900 mb-2">Processing Discharge...</h3>
            <p className="text-sm text-gray-500">
              Updating records, freeing bed, creating notifications...
            </p>
          </div>
        )}

        {/* ═══ SUCCESS STEP ═══ */}
        {step === 'success' && result && (
          <div className="p-8">
            <div className="text-center mb-5">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="text-lg font-bold text-green-700 mb-2">Patient Discharged Successfully!</h3>
              <p className="text-sm text-gray-600">{result.message}</p>
            </div>

            {/* Summary */}
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2 mb-5">
              <div className="flex items-center gap-2 text-sm">
                <BedDouble className="w-4 h-4 text-green-500" />
                <span className="text-gray-700">Bed {admission.bed_number} marked for cleaning</span>
              </div>
              {result.notifications?.patient_whatsapp === 'queued' && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-gray-700">WhatsApp notification queued for patient</span>
                </div>
              )}
              {result.notifications?.follow_up_appointment === 'created' && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-green-500" />
                  <span className="text-gray-700">Follow-up appointment created</span>
                </div>
              )}
              {result.notifications?.insurance_reminder === 'scheduled_3_days' && (
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="w-4 h-4 text-green-500" />
                  <span className="text-gray-700">Insurance document reminder scheduled (3 days)</span>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-400 text-center mb-4">
              Redirecting to patient profile in 3 seconds...
            </p>

            <button
              onClick={() => router.push(result.redirect || `/patients/${admission.patient_id}`)}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm flex items-center justify-center gap-2"
            >
              <User className="w-4 h-4" /> Go to Patient Profile Now
            </button>
          </div>
        )}

        {/* ═══ ERROR STEP ═══ */}
        {step === 'error' && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-red-700 mb-2">Discharge Failed</h3>
            <p className="text-sm text-gray-600 mb-5">{errorMsg}</p>
            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm">
                Close
              </button>
              <button onClick={() => setStep('form')}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm">
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}