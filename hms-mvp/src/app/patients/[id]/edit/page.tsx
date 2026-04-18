'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import FormScanner from '@/components/shared/FormScanner'
import { supabase } from '@/lib/supabase'
import type { OCRResult } from '@/lib/ocr'
import { ArrowLeft, Save, CheckCircle, AlertCircle } from 'lucide-react'

const BLOOD_GROUPS = ['A+','A-','B+','B-','O+','O-','AB+','AB-']
const GENDERS      = ['Female','Male','Other']

interface FormData {
  full_name: string; age: string; date_of_birth: string; gender: string
  mobile: string; blood_group: string; address: string; abha_id: string
  emergency_contact_name: string; emergency_contact_phone: string
  mediclaim: string; cashless: string; reference_source: string
}

function Err({ msg }: { msg: string }) {
  return <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{msg}</p>
}

export default function EditPatientPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [form, setForm]     = useState<FormData>({ full_name:'', age:'', date_of_birth:'', gender:'Female', mobile:'', blood_group:'', address:'', abha_id:'', emergency_contact_name:'', emergency_contact_phone:'', mediclaim:'No', cashless:'No', reference_source:'' })
  const [errors, setErrors] = useState<Partial<FormData>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [loading, setLoading] = useState(true)
  const [ocrFields, setOcrFields] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!id) return
    supabase.from('patients').select('*').eq('id', id).single().then(({ data }) => {
      if (data) {
        setForm({
          full_name:               data.full_name || '',
          age:                     data.age ? String(data.age) : '',
          date_of_birth:           data.date_of_birth || '',
          gender:                  data.gender || 'Female',
          mobile:                  data.mobile || '',
          blood_group:             data.blood_group || '',
          address:                 data.address || '',
          abha_id:                 data.abha_id || '',
          emergency_contact_name:  data.emergency_contact_name || '',
          emergency_contact_phone: data.emergency_contact_phone || '',
          mediclaim:               data.mediclaim ? 'Yes' : 'No',
          cashless:                data.cashless  ? 'Yes' : 'No',
          reference_source:        data.reference_source || '',
        })
      }
      setLoading(false)
    })
  }, [id])

  function set(field: keyof FormData, value: string, fromOCR = false) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }))
    if (fromOCR) setOcrFields(prev => new Set(Array.from(prev).concat(field)))
    else setOcrFields(prev => { const n = new Set(Array.from(prev)); n.delete(field); return n })
  }

  function handleDOB(dob: string, fromOCR = false) {
    set('date_of_birth', dob, fromOCR)
    if (dob) {
      const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      if (age >= 0 && age < 150) set('age', String(age), fromOCR)
    }
  }

  function handleOCR(result: OCRResult) {
    const p = result.patient
    if (!p) return
    if (p.full_name) set('full_name', p.full_name, true)
    if (p.age) set('age', p.age, true)
    if (p.date_of_birth) handleDOB(p.date_of_birth, true)
    if (p.gender && GENDERS.includes(p.gender)) set('gender', p.gender, true)
    if (p.mobile) set('mobile', p.mobile.replace(/\D/g,'').slice(-10), true)
    if (p.blood_group && BLOOD_GROUPS.includes(p.blood_group)) set('blood_group', p.blood_group, true)
    if (p.address) set('address', p.address, true)
    if (p.abha_id) set('abha_id', p.abha_id, true)
    if (p.emergency_contact_name) set('emergency_contact_name', p.emergency_contact_name, true)
    if (p.emergency_contact_phone) set('emergency_contact_phone', p.emergency_contact_phone.replace(/\D/g,'').slice(-10), true)
  }

  function validate(): boolean {
    const e: Partial<FormData> = {}
    if (!form.full_name.trim()) e.full_name = 'Patient name is required'
    if (!form.mobile.trim())    e.mobile    = 'Mobile number is required'
    else if (!/^\d{10}$/.test(form.mobile.trim())) e.mobile = 'Enter a valid 10-digit mobile number'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)

    const { error } = await supabase.from('patients').update({
      full_name:               form.full_name.trim(),
      age:                     form.age ? parseInt(form.age) : null,
      date_of_birth:           form.date_of_birth || null,
      gender:                  form.gender || null,
      mobile:                  form.mobile.trim(),
      blood_group:             form.blood_group || null,
      address:                 form.address.trim() || null,
      abha_id:                 form.abha_id.trim() || null,
      emergency_contact_name:  form.emergency_contact_name.trim() || null,
      emergency_contact_phone: form.emergency_contact_phone.trim() || null,
      mediclaim:               form.mediclaim === 'Yes',
      cashless:                form.cashless  === 'Yes',
      reference_source:        form.reference_source.trim() || null,
      updated_at:              new Date().toISOString(),
    }).eq('id', id)

    setSaving(false)
    if (error) { setErrors({ full_name: `Update failed: ${error.message}` }); return }
    setSaved(true)
    setTimeout(() => router.push(`/patients/${id}`), 1200)
  }

  function inputCls(field: keyof FormData) {
    return 'input' +
      (errors[field] ? ' border-red-400 focus:ring-red-400' : '') +
      (ocrFields.has(field) ? ' !border-green-400 !bg-green-50' : '')
  }

  if (loading) return (
    <AppShell><div className="p-6 flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div></AppShell>
  )

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-5">
          <Link href={`/patients/${id}`} className="text-gray-400 hover:text-gray-600"><ArrowLeft className="w-5 h-5" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Edit Patient Details</h1>
            <p className="text-sm text-gray-500">
              Update information below. <span className="text-green-700 text-xs font-medium">● Green = filled by scanner</span>
            </p>
          </div>
        </div>

        {saved && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
            <CheckCircle className="w-4 h-4" /> Patient details updated successfully. Redirecting...
          </div>
        )}

        <FormScanner formType="patient_registration" onExtracted={handleOCR}
          label="Scan updated registration form to auto-fill changes"
          className="mb-5" />

        <form onSubmit={handleSave} noValidate>
          <div className="card p-6 mb-5">
            <h2 className="section-title">Personal Details</h2>
            <div className="grid grid-cols-2 gap-5">
              <div className="col-span-2">
                <label className="label">Full Name *</label>
                <input className={inputCls('full_name')} value={form.full_name} onChange={e => set('full_name', e.target.value)} />
                {errors.full_name && <Err msg={errors.full_name} />}
              </div>
              <div>
                <label className="label">Age (years)</label>
                <input className={inputCls('age')} type="number" min="0" max="150" value={form.age} onChange={e => set('age', e.target.value)} />
              </div>
              <div>
                <label className="label">Date of Birth</label>
                <input className={inputCls('date_of_birth')} type="date" max={new Date().toISOString().split('T')[0]}
                  value={form.date_of_birth} onChange={e => handleDOB(e.target.value)} />
              </div>
              <div>
                <label className="label">Gender</label>
                <select className={inputCls('gender')} value={form.gender} onChange={e => set('gender', e.target.value)}>
                  {GENDERS.map(g => <option key={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Blood Group</label>
                <select className={inputCls('blood_group')} value={form.blood_group} onChange={e => set('blood_group', e.target.value)}>
                  <option value="">Select</option>
                  {BLOOD_GROUPS.map(bg => <option key={bg}>{bg}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Mobile Number *</label>
                <input className={`${inputCls('mobile')} font-mono`} maxLength={10} value={form.mobile}
                  onChange={e => set('mobile', e.target.value.replace(/\D/g,''))} />
                {errors.mobile && <Err msg={errors.mobile} />}
              </div>
              <div>
                <label className="label">ABHA ID</label>
                <input className={`${inputCls('abha_id')} font-mono`} value={form.abha_id} onChange={e => set('abha_id', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="label">Address</label>
                <textarea className={`${inputCls('address')} resize-none`} rows={2} value={form.address} onChange={e => set('address', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card p-6 mb-6">
            <h2 className="section-title">Insurance & Referral</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Mediclaim / Insurance</label>
                <select className="input" value={form.mediclaim} onChange={e=>set('mediclaim',e.target.value)}>
                  <option value="No">No</option><option value="Yes">Yes</option>
                </select>
              </div>
              <div>
                <label className="label">Cashless Option</label>
                <select className="input" value={form.cashless}
                  disabled={form.mediclaim !== 'Yes'} onChange={e=>set('cashless',e.target.value)}>
                  <option value="No">No</option><option value="Yes">Yes</option>
                </select>
              </div>
              <div>
                <label className="label">Referred By / Source</label>
                <select className="input" value={form.reference_source} onChange={e=>set('reference_source',e.target.value)}>
                  <option value="">Select (optional)</option>
                  <option>Doctor Referral</option><option>Patient Referral</option>
                  <option>Advertisement</option><option>Social Media</option>
                  <option>Google / Internet</option><option>Walk-in</option>
                  <option>Camp / Outreach</option><option>Other</option>
                </select>
              </div>
            </div>
          </div>
          <div className="card p-5 mb-4">
            <h2 className="section-title">Emergency Contact</h2>
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="label">Contact Name</label>
                <input className={inputCls('emergency_contact_name')} value={form.emergency_contact_name} onChange={e => set('emergency_contact_name', e.target.value)} />
              </div>
              <div>
                <label className="label">Contact Phone</label>
                <input className={`${inputCls('emergency_contact_phone')} font-mono`} maxLength={10} value={form.emergency_contact_phone}
                  onChange={e => set('emergency_contact_phone', e.target.value.replace(/\D/g,''))} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Link href={`/patients/${id}`} className="btn-secondary">Cancel</Link>
            <button type="submit" disabled={saving || saved} className="btn-primary px-8 disabled:opacity-60 flex items-center gap-2">
              {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving...</>
                : saved ? <><CheckCircle className="w-4 h-4" />Saved!</>
                : <><Save className="w-4 h-4" />Save Changes</>}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
