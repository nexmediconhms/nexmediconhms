'use client'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { normalizePhone, normalizeDigits, indicDigitsToAscii } from '@/lib/utils'
import { CheckCircle, AlertCircle, User, Phone, Calendar, Droplets, Globe } from 'lucide-react'

const BLOOD_GROUPS = ['A+','A-','B+','B-','O+','O-','AB+','AB-']
const GENDERS      = ['Female','Male','Other']

// Bilingual labels for the intake form
type Lang = 'en' | 'gu'
const L: Record<string, Record<Lang, string>> = {
  title:              { en: 'Patient Registration Form', gu: 'દર્દી નોંધણી ફોર્મ' },
  subtitle:           { en: 'Please fill this form before your visit. All fields marked * are required.', gu: 'કૃપા કરીને તમારી મુલાકાત પહેલાં આ ફોર્મ ભરો. * ચિહ્નિત ફીલ્ડ ફરજિયાત છે.' },
  personal:           { en: 'Personal Details', gu: 'વ્યક્તિગત વિગતો' },
  full_name:          { en: 'Full Name *', gu: 'પૂરું નામ *' },
  full_name_ph:       { en: 'As on Aadhaar card', gu: 'આધાર કાર્ડ મુજબ' },
  age:                { en: 'Age', gu: 'ઉંમર' },
  age_ph:             { en: 'Years', gu: 'વર્ષ' },
  gender:             { en: 'Gender', gu: 'લિંગ' },
  gender_female:      { en: 'Female', gu: 'સ્ત્રી' },
  gender_male:        { en: 'Male', gu: 'પુરૂષ' },
  gender_other:       { en: 'Other', gu: 'અન્ય' },
  dob:                { en: 'Date of Birth', gu: 'જન્મ તારીખ' },
  blood_group:        { en: 'Blood Group', gu: 'લોહી જૂથ' },
  contact:            { en: 'Contact Details', gu: 'સંપર્ક વિગતો' },
  mobile:             { en: 'Mobile Number *', gu: 'મોબાઈલ નંબર *' },
  mobile_ph:          { en: '10-digit mobile number', gu: '૧૦ અંકનો મોબાઈલ નંબર' },
  address:            { en: 'Address', gu: 'સરનામું' },
  address_ph:         { en: 'House no, Street, Area, City', gu: 'ઘર નં., શેરી, વિસ્તાર, શહેર' },
  complaint:          { en: "Today's Problem / Complaint", gu: 'આજની તકલીફ / ફરિયાદ' },
  complaint_ph:       { en: 'Briefly describe your main complaint or reason for visit…', gu: 'તમારી મુખ્ય ફરિયાદ અથવા મુલાકાતનું કારણ ટૂંકમાં જણાવો…' },
  emergency:          { en: 'Emergency Contact', gu: 'કટોકટી સંપર્ક' },
  emergency_name:     { en: 'Contact Name', gu: 'સંપર્ક નામ' },
  emergency_name_ph:  { en: 'Husband / Father / Relative name', gu: 'પતિ / પિતા / સંબંધીનું નામ' },
  emergency_phone:    { en: 'Contact Mobile', gu: 'સંપર્ક મોબાઈલ' },
  emergency_phone_ph: { en: '10-digit mobile', gu: '૧૦ અંકનો મોબાઈલ' },
  insurance:          { en: 'Do you have Health Insurance / Mediclaim?', gu: 'શું તમારી પાસે હેલ્થ ઈન્સ્યોરન્સ / મેડિક્લેમ છે?' },
  yes:                { en: 'Yes', gu: 'હા' },
  no:                 { en: 'No', gu: 'ના' },
  consent_text:       { en: 'I consent to {hospital} recording and storing my personal and medical information for healthcare purposes. I confirm the information provided is accurate.', gu: 'હું {hospital} ને મારી વ્યક્તિગત અને તબીબી માહિતી આરોગ્ય સેવાના હેતુ માટે રેકોર્ડ કરવા અને સંગ્રહ કરવાની સંમતિ આપું છું. હું ખાતરી આપું છું કે આપેલી માહિતી સચોટ છે.' },
  submit:             { en: 'Submit Registration', gu: 'નોંધણી સબમિટ કરો' },
  submitting:         { en: 'Submitting…', gu: 'સબમિટ થઈ રહ્યું છે…' },
  success_title:      { en: 'Registration Complete!', gu: 'નોંધણી પૂર્ણ!' },
  success_thanks:     { en: 'Thank you', gu: 'આભાર' },
  success_id:         { en: 'Your Patient ID', gu: 'તમારો દર્દી આઈડી' },
  success_show:       { en: 'Please show this to the receptionist', gu: 'કૃપા કરીને આ રિસેપ્શનિસ્ટને બતાવો' },
  success_proceed:    { en: 'Please proceed to the reception desk. Your information has been registered in our system.', gu: 'કૃપા કરીને રિસેપ્શન ડેસ્ક પર જાઓ. તમારી માહિતી અમારી સિસ્ટમમાં નોંધાઈ ગઈ છે.' },
  secure_note:        { en: 'Your information is securely stored and will only be used for your medical care.', gu: 'તમારી માહિતી સુરક્ષિત રીતે સંગ્રહિત છે અને ફક્ત તમારી તબીબી સંભાળ માટે જ ઉપયોગ થશે.' },
  err_name:           { en: 'Name is required', gu: 'નામ જરૂરી છે' },
  err_mobile:         { en: 'Mobile number is required', gu: 'મોબાઈલ નંબર જરૂરી છે' },
  err_mobile_invalid: { en: 'Enter a valid 10-digit mobile number', gu: 'માન્ય ૧૦ અંકનો મોબાઈલ નંબર દાખલ કરો' },
  err_consent:        { en: 'Please give your consent to proceed', gu: 'કૃપા કરીને આગળ વધવા માટે સંમતિ આપો' },
  err_duplicate:      { en: 'A patient with this mobile number is already registered. Please visit the reception desk.', gu: 'આ મોબાઈલ નંબર સાથે દર્દી પહેલેથી નોંધાયેલ છે. કૃપા કરીને રિસેપ્શન ડેસ્ક પર જાઓ.' },
  lang_switch:        { en: 'ગુજરાતી', gu: 'English' },
}

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
  const langParam = searchParams.get('lang')

  const [lang,    setLang]    = useState<Lang>(langParam === 'gu' ? 'gu' : 'en')
  const [form,    setForm]    = useState<IntakeForm>(EMPTY)
  const [errors,  setErrors]  = useState<Partial<Record<keyof IntakeForm, string>>>({})
  const [saving,  setSaving]  = useState(false)
  const [done,    setDone]    = useState<{ mrn: string; name: string } | null>(null)
  const [apiError, setApiError] = useState('')

  // Bilingual label helper
  const t = (key: string) => L[key]?.[lang] || L[key]?.en || key

  function set(field: keyof IntakeForm, value: string | boolean) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }))
  }

  // Handle mobile input: accept Gujarati/Hindi digits, convert to ASCII
  function handleMobileChange(raw: string) {
    const normalized = normalizePhone(raw)
    set('mobile', normalized)
  }

  // Handle age input: accept Gujarati/Hindi digits
  function handleAgeChange(raw: string) {
    const normalized = normalizeDigits(raw)
    if (normalized.length <= 3) set('age', normalized)
  }

  // Handle emergency phone: accept Gujarati/Hindi digits
  function handleEmergencyPhoneChange(raw: string) {
    const normalized = normalizePhone(raw)
    set('emergency_contact_phone', normalized)
  }

  function validate(): boolean {
    const e: Partial<Record<keyof IntakeForm, string>> = {}
    if (!form.full_name.trim())  e.full_name = t('err_name')
    if (!form.mobile.trim())     e.mobile    = t('err_mobile')
    else {
      // Normalize any Gujarati/Hindi digits before validation
      const normalizedMobile = normalizePhone(form.mobile)
      if (!/^\d{10}$/.test(normalizedMobile.replace(/^(\+91|91)/, '')))
        e.mobile = t('err_mobile_invalid')
    }
    if (!form.consent)           e.consent   = t('err_consent')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setSaving(true)
    setApiError('')

    // ── Normalize mobile (Gujarati digits → ASCII) before DB operations ──
    const mobile = normalizePhone(form.mobile).replace(/^(\+91|91)/, '')

    // ── Check for duplicate mobile before inserting ──────────────
    const { data: existing } = await supabase
      .from('patients')
      .select('id, mrn, full_name')
      .eq('mobile', mobile)
      .limit(1)
    if (existing && existing.length > 0) {
      setSaving(false)
      setApiError(
        lang === 'gu'
          ? `મોબાઈલ ${mobile} સાથે દર્દી પહેલેથી નોંધાયેલ છે (${existing[0].full_name}, MRN: ${existing[0].mrn}). કૃપા કરીને રિસેપ્શન ડેસ્ક પર જાઓ.`
          : `A patient with mobile ${mobile} is already registered (${existing[0].full_name}, MRN: ${existing[0].mrn}). Please visit the reception desk if you need to update your details.`
      )
      return
    }

    // Normalize age (Gujarati digits → ASCII)
    const ageNormalized = form.age ? parseInt(normalizeDigits(form.age)) : null

    // Use service role to allow public insert (anon key with RLS)
    const payload: Record<string, any> = {
      full_name:               form.full_name.trim(),
      mobile:                  mobile,
      gender:                  form.gender || null,
      age:                     ageNormalized && !isNaN(ageNormalized) ? ageNormalized : null,
      date_of_birth:           form.date_of_birth || null,
      blood_group:             form.blood_group   || null,
      address:                 form.address.trim() || null,
      emergency_contact_name:  form.emergency_contact_name.trim()  || null,
      emergency_contact_phone: normalizePhone(form.emergency_contact_phone) || null,
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
          ? t('err_duplicate')
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

  // Gender display label based on language
  const genderLabel = (g: string) => {
    if (lang === 'gu') {
      if (g === 'Female') return 'સ્ત્રી (Female)'
      if (g === 'Male')   return 'પુરૂષ (Male)'
      if (g === 'Other')  return 'અન્ય (Other)'
    }
    return g
  }

  // ── Success screen ─────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-9 h-9 text-green-600"/>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">{t('success_title')}</h2>
          <p className="text-gray-500 mb-5">{t('success_thanks')}, {done.name}.</p>
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-6 py-4 mb-6">
            <div className="text-xs text-blue-500 font-bold uppercase tracking-wide mb-1">{t('success_id')}</div>
            <div className="text-3xl font-black text-blue-700 font-mono tracking-widest">{done.mrn}</div>
            <p className="text-xs text-blue-500 mt-1">{t('success_show')}</p>
          </div>
          <p className="text-sm text-gray-500">
            {t('success_proceed')}
          </p>
        </div>
      </div>
    )
  }

  // ── Form ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <div className="bg-blue-600 text-white px-4 py-5 text-center relative">
        <div className="text-xl font-bold">{hospitalName}</div>
        <div className="text-sm text-blue-200 mt-1">{t('title')}</div>
        {/* Language toggle button */}
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'gu' : 'en')}
          className="absolute top-3 right-3 flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
        >
          <Globe className="w-3.5 h-3.5"/>
          {t('lang_switch')}
        </button>
      </div>

      <div className="max-w-lg mx-auto p-4 pb-10">
        <p className="text-xs text-gray-500 text-center mt-3 mb-5">
          {t('subtitle')}
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
            <User className="w-4 h-4 text-blue-600"/> {t('personal')}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('full_name')}</label>
              <input
                className={`w-full border rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none ${errors.full_name ? 'border-red-400' : 'border-gray-200'}`}
                placeholder={t('full_name_ph')}
                value={form.full_name}
                onChange={e => set('full_name', e.target.value)}
                autoComplete="name"
                lang={lang === 'gu' ? 'gu' : undefined}
              />
              {errors.full_name && <p className="text-xs text-red-500 mt-1">{errors.full_name}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('age')}</label>
                <input
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder={t('age_ph')}
                  inputMode="numeric"
                  maxLength={3}
                  value={form.age}
                  onChange={e => handleAgeChange(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('gender')}</label>
                <select
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={form.gender}
                  onChange={e => set('gender', e.target.value)}
                >
                  {GENDERS.map(g => <option key={g} value={g}>{genderLabel(g)}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5"/> {t('dob')}
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
                <Droplets className="w-3.5 h-3.5"/> {t('blood_group')}
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
            <Phone className="w-4 h-4 text-blue-600"/> {t('contact')}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('mobile')}</label>
              <input
                className={`w-full border rounded-xl px-4 py-3 text-base font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none ${errors.mobile ? 'border-red-400' : 'border-gray-200'}`}
                placeholder={t('mobile_ph')}
                type="tel" inputMode="numeric" maxLength={14}
                value={form.mobile}
                onChange={e => handleMobileChange(e.target.value)}
              />
              {errors.mobile && <p className="text-xs text-red-500 mt-1">{errors.mobile}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('address')}</label>
              <textarea
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                placeholder={t('address_ph')}
                rows={2}
                value={form.address}
                onChange={e => set('address', e.target.value)}
                lang={lang === 'gu' ? 'gu' : undefined}
              />
            </div>
          </div>
        </div>

        {/* Today's complaint */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
          <h2 className="font-bold text-gray-800 mb-4">{t('complaint')}</h2>
          <textarea
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
            placeholder={t('complaint_ph')}
            rows={3}
            value={form.chief_complaint}
            onChange={e => set('chief_complaint', e.target.value)}
            lang={lang === 'gu' ? 'gu' : undefined}
          />
        </div>

        {/* Emergency contact */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
          <h2 className="font-bold text-gray-800 mb-4">{t('emergency')}</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('emergency_name')}</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder={t('emergency_name_ph')}
                value={form.emergency_contact_name}
                onChange={e => set('emergency_contact_name', e.target.value)}
                lang={lang === 'gu' ? 'gu' : undefined}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('emergency_phone')}</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder={t('emergency_phone_ph')}
                type="tel" inputMode="numeric" maxLength={14}
                value={form.emergency_contact_phone}
                onChange={e => handleEmergencyPhoneChange(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Insurance */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
          <h2 className="font-bold text-gray-800 mb-3">{t('insurance')}</h2>
          <div className="flex gap-3">
            {(['Yes', 'No'] as const).map(opt => (
              <button
                key={opt} type="button"
                onClick={() => set('mediclaim', opt)}
                className={`flex-1 py-3 rounded-xl font-semibold border transition-all ${
                  form.mediclaim === opt
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300'
                }`}
              >
                {opt === 'Yes' ? t('yes') : t('no')}
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
              {t('consent_text').replace('{hospital}', hospitalName)}
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
              {t('submitting')}
            </>
          ) : (
            t('submit')
          )}
        </button>

        <p className="text-xs text-gray-400 text-center mt-4">
          {t('secure_note')}
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
