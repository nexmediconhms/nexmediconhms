'use client'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { CheckCircle, AlertCircle, User, Phone, Calendar, Droplets } from 'lucide-react'

const BLOOD_GROUPS = ['A+','A-','B+','B-','O+','O-','AB+','AB-']
const GENDERS      = ['Female','Male','Other']

interface IntakeForm {
  full_name:               string
  age:                     string
  date_of_birth:           string
  gender:                  string
  mobile:                  string
  blood_group:             string
  address:                 string
  emergency_contact_name:  string
  emergency_contact_phone: string
  chief_complaint:         string
  mediclaim:               string
  consent:                 boolean
}

const EMPTY: IntakeForm = {
  full_name: '', age: '', date_of_birth: '', gender: 'Female', mobile: '',
  blood_group: '', address: '', emergency_contact_name: '',
  emergency_contact_phone: '', chief_complaint: '', mediclaim: 'No', consent: false,
}

function IntakeContent() {
  const searchParams = useSearchParams()
  const hospitalName = searchParams.get('h') || 'NexMedicon Hospital'
  const appointmentId = searchParams.get('appt') || ''

  const [form,    setForm]    = useState<IntakeForm>(EMPTY)
  const [errors,  setErrors]  = useState<Partial<Record<keyof IntakeForm, string>>>({})
  const [saving,  setSaving]  = useState(false)
  const [done,    setDone]    = useState<{ mrn: string; name: string } | null>(null)
  const [apiError, setApiError] = useState('')

  function set(field: keyof IntakeForm, value: string | boolean) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }))
  }

  function validate(): boolean {
    const e: Partial<Record<keyof IntakeForm, string>> = {}
    if (!form.full_name.trim())  e.full_name = 'Name is required'
    if (!form.mobile.trim())     e.mobile    = 'Mobile number is required'
    else if (!/^\d{10}$/.test(form.mobile.trim().replace(/^(\+91|91)/, '')))
      e.mobile = 'Enter a valid 10-digit mobile number'
    if (!form.consent)           e.consent   = 'Please give your consent to proceed'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setSaving(true)
    setApiError('')

    // Use service role to allow public insert (anon key with RLS)
    const payload: Record<string, any> = {
      full_name:               form.full_name.trim(),
      mobile:                  form.mobile.trim().replace(/^(\+91|91)/, ''),
      gender:                  form.gender || null,
      age:                     form.age ? parseInt(form.age) : null,
      date_of_birth:           form.date_of_birth || null,
      blood_group:             form.blood_group   || null,
      address:                 form.address.trim() || null,
      emergency_contact_name:  form.emergency_contact_name.trim()  || null,
      emergency_contact_phone: form.emergency_contact_phone.trim() || null,
      mediclaim:               form.mediclaim === 'Yes',
      reference_source:        appointmentId ? 'Online Self-Registration' : 'Walk-in Self-Registration',
    }

    const { data, error } = await supabase
      .from('patients')
      .insert(payload)
      .select('id, mrn, full_name')
      .single()

    setSaving(false)

    if (error) {
      setApiError(
        error.message.includes('mobile')
          ? 'A patient with this mobile number may already be registered. Please visit the reception desk.'
          : `Could not save your information: ${error.message}`
      )
      return
    }

    // If there was a chief complaint, create a draft encounter note
    if (form.chief_complaint.trim() && data?.id) {
      await supabase.from('encounters').insert({
        patient_id:      data.id,
        encounter_type:  'OPD',
        encounter_date:  new Date().toISOString().split('T')[0],
        chief_complaint: form.chief_complaint.trim(),
      })
    }

    setDone({ mrn: data.mrn, name: data.full_name })
  }

  // ── Success screen ─────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-9 h-9 text-green-600"/>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Registration Complete!</h2>
          <p className="text-gray-500 mb-5">Thank you, {done.name}.</p>
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-6 py-4 mb-6">
            <div className="text-xs text-blue-500 font-bold uppercase tracking-wide mb-1">Your Patient ID</div>
            <div className="text-3xl font-black text-blue-700 font-mono tracking-widest">{done.mrn}</div>
            <p className="text-xs text-blue-500 mt-1">Please show this to the receptionist</p>
          </div>
          <p className="text-sm text-gray-500">
            Please proceed to the reception desk. Your information has been registered in our system.
          </p>
        </div>
      </div>
    )
  }

  // ── Form ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <div className="bg-blue-600 text-white px-4 py-5 text-center">
        <div className="text-xl font-bold">{hospitalName}</div>
        <div className="text-sm text-blue-200 mt-1">Patient Registration Form</div>
      </div>

      <div className="max-w-lg mx-auto p-4 pb-10">
        <p className="text-xs text-gray-500 text-center mt-3 mb-5">
          Please fill this form before your visit. All fields marked * are required.
        </p>

        {apiError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5"/>
            <span>{apiError}</span>
          </div>
        )}

        {/* Personal Details */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
          <h2 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
            <User className="w-4 h-4 text-blue-600"/> Personal Details
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
              <input
                className={`w-full border rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none ${errors.full_name ? 'border-red-400' : 'border-gray-200'}`}
                placeholder="As on Aadhaar card"
                value={form.full_name}
                onChange={e => set('full_name', e.target.value)}
              />
              {errors.full_name && <p className="text-xs text-red-500 mt-1">{errors.full_name}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
                <input
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="Years"
                  type="number" min="0" max="120"
                  value={form.age}
                  onChange={e => set('age', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                <select
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={form.gender}
                  onChange={e => set('gender', e.target.value)}
                >
                  {GENDERS.map(g => <option key={g}>{g}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5"/> Date of Birth
              </label>
              <input
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none"
                type="date"
                max={new Date().toISOString().split('T')[0]}
                value={form.date_of_birth}
                onChange={e => {
                  set('date_of_birth', e.target.value)
                  if (e.target.value) {
                    const age = Math.floor((Date.now() - new Date(e.target.value).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                    set('age', String(age))
                  }
                }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                <Droplets className="w-3.5 h-3.5"/> Blood Group
              </label>
              <div className="flex flex-wrap gap-2">
                {BLOOD_GROUPS.map(bg => (
                  <button
                    key={bg} type="button"
                    onClick={() => set('blood_group', form.blood_group === bg ? '' : bg)}
                    className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-all ${
                      form.blood_group === bg
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-red-400'
                    }`}
                  >
                    {bg}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
          <h2 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
            <Phone className="w-4 h-4 text-blue-600"/> Contact Details
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number *</label>
              <input
                className={`w-full border rounded-xl px-4 py-3 text-base font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none ${errors.mobile ? 'border-red-400' : 'border-gray-200'}`}
                placeholder="10-digit mobile number"
                type="tel" maxLength={10}
                value={form.mobile}
                onChange={e => set('mobile', e.target.value.replace(/\D/g, ''))}
              />
              {errors.mobile && <p className="text-xs text-red-500 mt-1">{errors.mobile}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <textarea
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                placeholder="House no, Street, Area, City"
                rows={2}
                value={form.address}
                onChange={e => set('address', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Today's complaint */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
          <h2 className="font-bold text-gray-800 mb-4">Today's Problem / Complaint</h2>
          <textarea
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
            placeholder="Briefly describe your main complaint or reason for visit…"
            rows={3}
            value={form.chief_complaint}
            onChange={e => set('chief_complaint', e.target.value)}
          />
        </div>

        {/* Emergency contact */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
          <h2 className="font-bold text-gray-800 mb-4">Emergency Contact</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="Husband / Father / Relative name"
                value={form.emergency_contact_name}
                onChange={e => set('emergency_contact_name', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Mobile</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="10-digit mobile"
                type="tel" maxLength={10}
                value={form.emergency_contact_phone}
                onChange={e => set('emergency_contact_phone', e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>
        </div>

        {/* Insurance */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
          <h2 className="font-bold text-gray-800 mb-3">Do you have Health Insurance / Mediclaim?</h2>
          <div className="flex gap-3">
            {['Yes', 'No'].map(opt => (
              <button
                key={opt} type="button"
                onClick={() => set('mediclaim', opt)}
                className={`flex-1 py-3 rounded-xl font-semibold border transition-all ${
                  form.mediclaim === opt
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Consent */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
          <label className="flex items-start gap-3 cursor-pointer">
            <div className="mt-0.5">
              <input
                type="checkbox"
                className="w-5 h-5 accent-blue-600"
                checked={form.consent}
                onChange={e => set('consent', e.target.checked)}
              />
            </div>
            <span className="text-sm text-gray-600">
              I consent to {hospitalName} recording and storing my personal and medical information
              for healthcare purposes. I confirm the information provided is accurate.
            </span>
          </label>
          {errors.consent && <p className="text-xs text-red-500 mt-2">{errors.consent}</p>}
        </div>

        <button
          onClick={handleSubmit}
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl text-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
              Submitting…
            </>
          ) : (
            'Submit Registration'
          )}
        </button>

        <p className="text-xs text-gray-400 text-center mt-4">
          Your information is securely stored and will only be used for your medical care.
        </p>
      </div>
    </div>
  )
}

export default function IntakePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-blue-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"/>
      </div>
    }>
      <IntakeContent />
    </Suspense>
  )
}
