'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { useAuth } from '@/lib/auth'
import type { ClinicUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { Settings, Save, CheckCircle, Building2, User, Printer, Info, Shield, ChevronRight, UserPlus, Users, Trash2, AlertCircle, Loader2, Copy } from 'lucide-react'
import { loadSettings, DEFAULTS, SETTINGS_STORAGE_KEY, type HospitalSettings } from '@/lib/settings'

function Field({ label, value, onChange, placeholder, hint }: {
  label: string; value: string; onChange: (v:string)=>void; placeholder?: string; hint?: string
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value)}/>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

export default function SettingsPage() {
  const [form,  setForm]  = useState<HospitalSettings>(DEFAULTS)
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
            <Settings className="w-5 h-5 text-blue-600"/>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-500">Configure hospital and doctor details used in print headers.</p>
          </div>
        </div>

        {saved && (
          <div className="mb-5 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4"/> Settings saved successfully.
          </div>
        )}

        {/* Info callout */}
        <div className="mb-5 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 flex items-start gap-3 text-sm text-blue-700">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5"/>
          <span>These details appear on printed prescriptions and discharge summaries. Changes take effect immediately on the next print.</span>
        </div>

        {/* Hospital Info */}
        <div className="card p-6 mb-5">
          <h2 className="section-title flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-600"/> Hospital Details
          </h2>
          <div className="grid grid-cols-2 gap-5">
            <div className="col-span-2">
              <Field label="Hospital Name" value={form.hospitalName}
                onChange={v=>set('hospitalName',v)}
                placeholder="e.g. City Women's Hospital"
                hint="Appears as the large heading on all printed documents"/>
            </div>
            <div className="col-span-2">
              <Field label="Address" value={form.address}
                onChange={v=>set('address',v)}
                placeholder="Full address including city and PIN code"/>
            </div>
            <Field label="Phone / WhatsApp" value={form.phone}
              onChange={v=>set('phone',v)} placeholder="+91 98765 43210"/>
            <Field label="Registration Number" value={form.regNo}
              onChange={v=>set('regNo',v)} placeholder="e.g. GJ/2024/12345"/>
            <Field label="GSTIN" value={form.gstin}
              onChange={v=>set('gstin',v)} placeholder="27XXXXXXX1Z5"/>
          </div>
        </div>

        {/* Doctor Info */}
        <div className="card p-6 mb-5">
          <h2 className="section-title flex items-center gap-2">
            <User className="w-4 h-4 text-blue-600"/> Default Doctor Details
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            These appear in the signature block on prescriptions and discharge summaries.
          </p>
          <div className="grid grid-cols-2 gap-5">
            <Field label="Doctor Name" value={form.doctorName}
              onChange={v=>set('doctorName',v)} placeholder="Dr. Full Name"/>
            <Field label="Qualifications" value={form.doctorQual}
              onChange={v=>set('doctorQual',v)} placeholder="MBBS, MD (OBG), DNB"/>
            <Field label="Medical Council Registration" value={form.doctorReg}
              onChange={v=>set('doctorReg',v)} placeholder="GJ/12345/2010"/>
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
                onChange={v=>set('upiId',v)}
                placeholder="yourhospital@upibank"
                hint="Used in payment links sent to patients via WhatsApp"/>
            </div>
            <Field label="OPD Consultation Fee (₹)" value={form.feeOPD}
              onChange={v=>set('feeOPD',v)} placeholder="500"/>
            <Field label="ANC Consultation Fee (₹)" value={form.feeANC}
              onChange={v=>set('feeANC',v)} placeholder="400"/>
            <Field label="Follow-up Consultation Fee (₹)" value={form.feeFollowUp}
              onChange={v=>set('feeFollowUp',v)} placeholder="300"/>
            <Field label="IPD Admission (per day) (₹)" value={form.feeIPD}
              onChange={v=>set('feeIPD',v)} placeholder="1500"/>
            <Field label="Emergency Consultation Fee (₹)" value={form.feeEmergency}
              onChange={v=>set('feeEmergency',v)} placeholder="800"/>
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
            <Printer className="w-4 h-4 text-blue-600"/> Print Footer Note
          </h2>
          <label className="label">Footer message on prescriptions</label>
          <textarea className="input resize-none" rows={2}
            placeholder="e.g. Thank you for visiting. Please follow the advice given above."
            value={form.footerNote} onChange={e=>set('footerNote',e.target.value)}/>
          <p className="text-xs text-gray-400 mt-1">Appears at the bottom of every printed prescription.</p>
        </div>

        {/* Preview */}
        <div className="card p-5 mb-6 bg-gray-50 border-gray-200">
          <h2 className="section-title flex items-center gap-2">
            <Printer className="w-4 h-4 text-gray-500"/> Print Header Preview
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg p-5 text-center">
            <div className="text-lg font-bold tracking-wide uppercase">{form.hospitalName || '—'}</div>
            <div className="text-sm text-gray-500 mt-0.5">{form.address || '—'}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              Tel: {form.phone || '—'}
              {form.regNo  && ` · Reg: ${form.regNo}`}
              {form.gstin  && ` · GSTIN: ${form.gstin}`}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 text-right">
              <div className="font-semibold text-gray-700">{form.doctorName || '—'}</div>
              <div>{form.doctorQual || '—'}</div>
              {form.doctorReg && <div>Reg: {form.doctorReg}</div>}
            </div>
          </div>
        </div>

        {/* ABDM / FHIR Integration */}
        <Link href="/abdm-setup"
          className="card p-5 mb-6 flex items-center gap-4 hover:border-green-300 hover:bg-green-50/30 transition-colors group cursor-pointer">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center group-hover:bg-green-200 transition-colors">
            <Shield className="w-5 h-5 text-green-600"/>
          </div>
          <div className="flex-1">
            <div className="font-semibold text-gray-900">ABDM / ABHA Integration</div>
            <div className="text-xs text-gray-500">Configure Ayushman Bharat Digital Mission, ABHA verification & HL7 FHIR R4 export</div>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-green-600"/>
        </Link>

        {/* User Management — Admin only */}
        <UserManagementSection />

        <div className="flex items-center justify-between">
          <button onClick={handleReset} className="btn-secondary text-xs text-red-600 border-red-200 hover:bg-red-50">
            Reset to Defaults
          </button>
          <button onClick={handleSave} className="btn-primary flex items-center gap-2">
            <Save className="w-4 h-4"/> Save Settings
          </button>
        </div>

      </div>
    </AppShell>
  )
}

// ── User Management Section (Admin only) ─────────────────────
function UserManagementSection() {
  const { isAdmin } = useAuth()
  const [users,       setUsers]       = useState<ClinicUser[]>([])
  const [loading,     setLoading]     = useState(false)
  const [showInvite,  setShowInvite]  = useState(false)
  const [invEmail,    setInvEmail]    = useState('')
  const [invName,     setInvName]     = useState('')
  const [invRole,     setInvRole]     = useState<'doctor' | 'staff'>('staff')
  const [inviting,    setInviting]    = useState(false)
  const [invResult,   setInvResult]   = useState<{ ok: boolean; msg: string; pwd?: string } | null>(null)
  const [error,       setError]       = useState('')

  if (!isAdmin) return null

  async function loadUsers() {
    setLoading(true)
    setError('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const res = await fetch('/api/users', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const json = await res.json()
    if (json.error) { setError(json.error); setLoading(false); return }
    setUsers(json.users || [])
    setLoading(false)
  }

  // Load users on first render
  useEffect(() => { loadUsers() }, [])

  async function handleInvite() {
    if (!invEmail.trim() || !invName.trim()) return
    setInviting(true)
    setInvResult(null)
    setError('')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setInviting(false); return }

    try {
      const res = await fetch('/api/users/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: invEmail.trim(),
          full_name: invName.trim(),
          role: invRole,
        }),
      })
      const json = await res.json()
      if (json.error) {
        setInvResult({ ok: false, msg: json.error })
      } else {
        setInvResult({ ok: true, msg: json.message, pwd: json.tempPassword })
        setInvEmail('')
        setInvName('')
        loadUsers()
      }
    } catch (err: any) {
      setInvResult({ ok: false, msg: err.message })
    }
    setInviting(false)
  }

  async function toggleActive(userId: string, currentActive: boolean) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId, updates: { is_active: !currentActive } }),
    })
    loadUsers()
  }

  async function changeRole(userId: string, newRole: string) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId, updates: { role: newRole } }),
    })
    loadUsers()
  }

  const ROLE_COLORS: Record<string, string> = {
    admin:  'bg-purple-100 text-purple-700',
    doctor: 'bg-blue-100 text-blue-700',
    staff:  'bg-green-100 text-green-700',
  }

  return (
    <div className="card p-6 mb-6">
      <h2 className="section-title flex items-center gap-2">
        <Users className="w-4 h-4 text-blue-600"/> Manage Users
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Invite doctors and staff to use the system. Each user gets their own login.
      </p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5"/>
          <span>{error}</span>
        </div>
      )}

      {/* Current users list */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <Loader2 className="w-4 h-4 animate-spin"/> Loading users...
        </div>
      ) : (
        <div className="space-y-2 mb-4">
          {users.map(u => (
            <div key={u.id} className={`flex items-center gap-3 p-3 rounded-lg border ${u.is_active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{u.full_name}</div>
                <div className="text-xs text-gray-500 truncate">{u.email}</div>
              </div>
              <select
                value={u.role}
                onChange={e => changeRole(u.id, e.target.value)}
                className={`text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-600'}`}
              >
                <option value="admin">👑 Admin</option>
                <option value="doctor">🩺 Doctor</option>
                <option value="staff">📋 Staff</option>
              </select>
              <button
                onClick={() => toggleActive(u.id, u.is_active)}
                className={`text-xs px-2 py-1 rounded-lg border ${u.is_active ? 'text-red-600 border-red-200 hover:bg-red-50' : 'text-green-600 border-green-200 hover:bg-green-50'}`}
              >
                {u.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
          {users.length === 0 && !loading && (
            <p className="text-sm text-gray-400 italic py-2">No users found. Invite your first team member below.</p>
          )}
        </div>
      )}

      {/* Invite new user */}
      {!showInvite ? (
        <button onClick={() => setShowInvite(true)}
          className="btn-primary text-sm flex items-center gap-2">
          <UserPlus className="w-4 h-4"/> Invite New User
        </button>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-blue-800 flex items-center gap-2">
            <UserPlus className="w-4 h-4"/> Invite New User
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Full Name</label>
              <input className="input" placeholder="Dr. Patel" value={invName}
                onChange={e => setInvName(e.target.value)} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" placeholder="doctor@clinic.com" value={invEmail}
                onChange={e => setInvEmail(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Role</label>
            <div className="flex gap-2">
              {(['doctor', 'staff'] as const).map(r => (
                <button key={r} type="button"
                  onClick={() => setInvRole(r)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${
                    invRole === r
                      ? r === 'doctor' ? 'bg-blue-600 text-white border-blue-600' : 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-600 border-gray-300'
                  }`}
                >
                  {r === 'doctor' ? '🩺 Doctor' : '📋 Staff'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleInvite} disabled={inviting || !invEmail.trim() || !invName.trim()}
              className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
              {inviting ? <Loader2 className="w-4 h-4 animate-spin"/> : <UserPlus className="w-4 h-4"/>}
              {inviting ? 'Creating...' : 'Create User'}
            </button>
            <button onClick={() => { setShowInvite(false); setInvResult(null) }}
              className="btn-secondary text-sm">Cancel</button>
          </div>

          {invResult && (
            <div className={`rounded-lg p-3 text-sm ${invResult.ok ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              <p>{invResult.msg}</p>
              {invResult.pwd && (
                <div className="mt-2 bg-white border border-green-300 rounded-lg p-3">
                  <p className="text-xs font-bold text-green-700 mb-1">Temporary Password (share with the user):</p>
                  <div className="flex items-center gap-2">
                    <code className="text-lg font-mono font-bold text-green-900 bg-green-50 px-3 py-1 rounded">{invResult.pwd}</code>
                    <button onClick={() => navigator.clipboard.writeText(invResult.pwd!)}
                      className="text-green-600 hover:text-green-800 p-1" title="Copy password">
                      <Copy className="w-4 h-4"/>
                    </button>
                  </div>
                  <p className="text-xs text-green-600 mt-1">The user should change this password after first login.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
