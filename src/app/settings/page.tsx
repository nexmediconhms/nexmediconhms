'use client'
import { useState, useEffect } from 'react'
import AppShell from '@/components/layout/AppShell'
import { Settings, Save, CheckCircle, Building2, User, Printer, Info } from 'lucide-react'
import { loadSettings, DEFAULTS, SETTINGS_STORAGE_KEY, type HospitalSettings } from '@/lib/settings'


function Field({ label, value, onChange, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

export default function SettingsPage() {
  const [form, setForm] = useState<HospitalSettings>(DEFAULTS)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const s = loadSettings()
    setForm(s)
  }, [])

  function set(field: keyof HospitalSettings, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function handleSave() {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(form))
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function handleReset() {
    if (confirm('Reset all settings to defaults?')) {
      localStorage.removeItem(SETTINGS_STORAGE_KEY)
      setForm(DEFAULTS)
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <Settings className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-500">Configure hospital and doctor details used in print headers.</p>
          </div>
        </div>

        {saved && (
          <div className="mb-5 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> Settings saved successfully.
          </div>
        )}

        {/* Info callout */}
        <div className="mb-5 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 flex items-start gap-3 text-sm text-blue-700">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>These details appear on printed prescriptions and discharge summaries. Changes take effect immediately on the next print.</span>
        </div>

        {/* Hospital Info */}
        <div className="card p-6 mb-5">
          <h2 className="section-title flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-600" /> Hospital Details
          </h2>
          <div className="grid grid-cols-2 gap-5">
            <div className="col-span-2">
              <Field label="Hospital Name" value={form.hospitalName}
                onChange={v => set('hospitalName', v)}
                placeholder="e.g. City Women's Hospital"
                hint="Appears as the large heading on all printed documents" />
            </div>
            <div className="col-span-2">
              <Field label="Address" value={form.address}
                onChange={v => set('address', v)}
                placeholder="Full address including city and PIN code" />
            </div>
            <Field label="Phone / WhatsApp" value={form.phone}
              onChange={v => set('phone', v)} placeholder="+91 98765 43210" />
            <Field label="Registration Number" value={form.regNo}
              onChange={v => set('regNo', v)} placeholder="e.g. GJ/2024/12345" />
            <Field label="GSTIN" value={form.gstin}
              onChange={v => set('gstin', v)} placeholder="27XXXXXXX1Z5" />
          </div>
        </div>

        {/* Doctor Info */}
        <div className="card p-6 mb-5">
          <h2 className="section-title flex items-center gap-2">
            <User className="w-4 h-4 text-blue-600" /> Default Doctor Details
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            These appear in the signature block on prescriptions and discharge summaries.
          </p>
          <div className="grid grid-cols-2 gap-5">
            <Field label="Doctor Name" value={form.doctorName}
              onChange={v => set('doctorName', v)} placeholder="Dr. Full Name" />
            <Field label="Qualifications" value={form.doctorQual}
              onChange={v => set('doctorQual', v)} placeholder="MBBS, MD (OBG), DNB" />
            <Field label="Medical Council Registration" value={form.doctorReg}
              onChange={v => set('doctorReg', v)} placeholder="GJ/12345/2010" />
          </div>
        </div>

        {/* Payment Settings */}
        <div className="card p-6 mb-5">
          <h2 className="section-title flex items-center gap-2">
            💳 Payment & Fees
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Default consultation fees — auto-populated in Billing when creating a new bill.
          </p>
          <div className="grid grid-cols-2 gap-5">
            <div className="col-span-2">
              <Field label="Hospital UPI ID" value={form.upiId}
                onChange={v => set('upiId', v)}
                placeholder="yourhospital@upibank"
                hint="Used in payment links sent to patients via WhatsApp" />
            </div>
            <Field label="OPD Consultation Fee (₹)" value={form.feeOPD}
              onChange={v => set('feeOPD', v)} placeholder="500" />
            <Field label="ANC Consultation Fee (₹)" value={form.feeANC}
              onChange={v => set('feeANC', v)} placeholder="400" />
            <Field label="Follow-up Consultation Fee (₹)" value={form.feeFollowUp}
              onChange={v => set('feeFollowUp', v)} placeholder="300" />
            <Field label="IPD Admission (per day) (₹)" value={form.feeIPD}
              onChange={v => set('feeIPD', v)} placeholder="1500" />
            <Field label="Emergency Consultation Fee (₹)" value={form.feeEmergency}
              onChange={v => set('feeEmergency', v)} placeholder="800" />
          </div>
        </div>

        {/* Fee preview */}
        <div className="card p-5 mb-5 bg-gray-50 border-gray-200">
          <h2 className="section-title text-sm">💰 Fee Quick Reference</h2>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {([
              ['OPD Consultation', form.feeOPD],
              ['ANC Consultation', form.feeANC],
              ['Follow-up', form.feeFollowUp],
              ['IPD (per day)', form.feeIPD],
              ['Emergency', form.feeEmergency],
            ] as [string, string][]).map(([label, fee]) => (
              <div key={label} className="bg-white border border-gray-100 rounded-lg px-3 py-2">
                <div className="text-gray-500">{label}</div>
                <div className="font-bold text-gray-900 text-base font-mono">₹{fee || '—'}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">These amounts auto-populate in the Billing module when creating bills.</p>
        </div>

        {/* Print Footer */}
        <div className="card p-6 mb-6">
          <h2 className="section-title flex items-center gap-2">
            <Printer className="w-4 h-4 text-blue-600" /> Print Footer Note
          </h2>
          <label className="label">Footer message on prescriptions</label>
          <textarea className="input resize-none" rows={2}
            placeholder="e.g. Thank you for visiting. Please follow the advice given above."
            value={form.footerNote} onChange={e => set('footerNote', e.target.value)} />
          <p className="text-xs text-gray-400 mt-1">Appears at the bottom of every printed prescription.</p>
        </div>

        {/* Preview */}
        <div className="card p-5 mb-6 bg-gray-50 border-gray-200">
          <h2 className="section-title flex items-center gap-2">
            <Printer className="w-4 h-4 text-gray-500" /> Print Header Preview
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg p-5 text-center">
            <div className="text-lg font-bold tracking-wide uppercase">{form.hospitalName || '—'}</div>
            <div className="text-sm text-gray-500 mt-0.5">{form.address || '—'}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              Tel: {form.phone || '—'}
              {form.regNo && ` · Reg: ${form.regNo}`}
              {form.gstin && ` · GSTIN: ${form.gstin}`}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 text-right">
              <div className="font-semibold text-gray-700">{form.doctorName || '—'}</div>
              <div>{form.doctorQual || '—'}</div>
              {form.doctorReg && <div>Reg: {form.doctorReg}</div>}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button onClick={handleReset} className="btn-secondary text-xs text-red-600 border-red-200 hover:bg-red-50">
            Reset to Defaults
          </button>
          <button onClick={handleSave} className="btn-primary flex items-center gap-2">
            <Save className="w-4 h-4" /> Save Settings
          </button>
        </div>

      </div>
    </AppShell>
  )
}
