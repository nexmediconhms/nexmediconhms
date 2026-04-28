'use client'
/**
 * src/app/settings/doctors/page.tsx
 *
 * Multiple Doctors Management (Requirement #4)
 *
 * Features:
 *  - List all doctors in the clinic
 *  - Add new doctors with specialty, registration
 *  - Set primary doctor
 *  - Each doctor has their own prescription header
 *  - Assign doctors to appointments/encounters
 */

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import {
  Stethoscope, UserPlus, Edit, Save, CheckCircle, X,
  Shield, Star, User, Phone, Mail, Trash2, AlertCircle
} from 'lucide-react'

interface Doctor {
  id:          string
  auth_id:     string
  email:       string
  full_name:   string
  role:        string
  is_active:   boolean
  phone?:      string
  specialty?:  string
  med_reg_no?: string
  is_primary?: boolean
}

export default function DoctorsPage() {
  const { user, isAdmin } = useAuth()
  const [doctors, setDoctors]     = useState<Doctor[]>([])
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]     = useState<string | null>(null)
  const [editForm, setEditForm]   = useState<Partial<Doctor>>({})
  const [saving, setSaving]       = useState(false)
  const [showAdd, setShowAdd]     = useState(false)

  // New doctor invite form
  const [inviteForm, setInviteForm] = useState({
    full_name:   '',
    email:       '',
    specialty:   '',
    med_reg_no:  '',
    phone:       '',
    is_primary:  false,
  })
  const [inviting, setInviting]   = useState(false)
  const [inviteResult, setInviteResult] = useState<{ tempPassword?: string; error?: string } | null>(null)

  useEffect(() => { loadDoctors() }, [])

  async function loadDoctors() {
    setLoading(true)
    const { data } = await supabase
      .from('clinic_users')
      .select('*')
      .in('role', ['admin', 'doctor'])
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('full_name')
    setDoctors((data || []) as Doctor[])
    setLoading(false)
  }

  function startEdit(doc: Doctor) {
    setEditing(doc.id)
    setEditForm({
      full_name:   doc.full_name,
      specialty:   doc.specialty || '',
      med_reg_no:  doc.med_reg_no || '',
      phone:       doc.phone || '',
      is_primary:  doc.is_primary || false,
    })
  }

  async function saveEdit(id: string) {
    setSaving(true)
    // If setting as primary, unset all others first
    if (editForm.is_primary) {
      await supabase
        .from('clinic_users')
        .update({ is_primary: false })
        .neq('id', id)
    }
    await supabase
      .from('clinic_users')
      .update({
        full_name:  editForm.full_name,
        specialty:  editForm.specialty || null,
        med_reg_no: editForm.med_reg_no || null,
        phone:      editForm.phone || null,
        is_primary: editForm.is_primary || false,
      })
      .eq('id', id)
    setEditing(null)
    await loadDoctors()
    setSaving(false)
  }

  async function inviteDoctor() {
    if (!inviteForm.full_name || !inviteForm.email) {
      alert('Name and email are required')
      return
    }
    setInviting(true)
    setInviteResult(null)

    // Create Supabase auth user via API route (needs service_role key)
    const { data: authData } = await supabase.auth.getSession()
    const token = authData.session?.access_token

    const res = await fetch('/api/admin/invite-user', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ ...inviteForm, role: 'doctor' }),
    })
    const result = await res.json()

    if (result.tempPassword) {
      setInviteResult({ tempPassword: result.tempPassword })
      setInviteForm({ full_name: '', email: '', specialty: '', med_reg_no: '', phone: '', is_primary: false })
      setShowAdd(false)
      await loadDoctors()
    } else {
      setInviteResult({ error: result.error || 'Failed to invite doctor' })
    }
    setInviting(false)
  }

  async function deactivateDoctor(id: string, name: string) {
    if (!confirm(`Deactivate Dr. ${name}? They will lose access to the system.`)) return
    await supabase.from('clinic_users').update({ is_active: false }).eq('id', id)
    await loadDoctors()
  }

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Stethoscope className="w-6 h-6 text-blue-500"/> Doctors
            </h1>
            <p className="text-sm text-gray-500">
              Manage multiple doctors · Set specialties and registration numbers
            </p>
          </div>
          {isAdmin && (
            <button onClick={() => setShowAdd(!showAdd)}
              className="btn-primary flex items-center gap-2 text-xs">
              <UserPlus className="w-3.5 h-3.5"/> Add Doctor
            </button>
          )}
        </div>

        {/* Success message after invite */}
        {inviteResult?.tempPassword && (
          <div className="card p-4 mb-5 bg-green-50 border border-green-200">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"/>
              <div>
                <p className="font-semibold text-green-800">Doctor account created!</p>
                <p className="text-sm text-green-700 mt-1">
                  Share these credentials with the doctor:
                </p>
                <div className="bg-white border border-green-200 rounded-lg p-3 mt-2 font-mono text-sm">
                  <div>Temporary Password: <strong>{inviteResult.tempPassword}</strong></div>
                </div>
                <p className="text-xs text-green-600 mt-2">The doctor should change their password on first login.</p>
              </div>
            </div>
          </div>
        )}

        {/* Add doctor form */}
        {showAdd && isAdmin && (
          <div className="card p-5 mb-5 border-l-4 border-blue-400">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-500"/> Invite New Doctor
            </h3>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="label">Full Name *</label>
                <input className="input" placeholder="Dr. Full Name"
                  value={inviteForm.full_name} onChange={e => setInviteForm(p => ({ ...p, full_name: e.target.value }))}/>
              </div>
              <div>
                <label className="label">Email *</label>
                <input className="input" type="email" placeholder="doctor@example.com"
                  value={inviteForm.email} onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))}/>
              </div>
              <div>
                <label className="label">Specialty</label>
                <select className="input" value={inviteForm.specialty}
                  onChange={e => setInviteForm(p => ({ ...p, specialty: e.target.value }))}>
                  <option value="">— Select specialty —</option>
                  {[
                    'General Medicine', 'Gynaecology & Obstetrics', 'Paediatrics',
                    'Surgery', 'Orthopaedics', 'ENT', 'Ophthalmology',
                    'Dermatology', 'Psychiatry', 'Cardiology', 'Neurology',
                    'Gastroenterology', 'Urology', 'Oncology', 'Anaesthesiology', 'Other'
                  ].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Medical Registration No.</label>
                <input className="input" placeholder="Council registration number"
                  value={inviteForm.med_reg_no} onChange={e => setInviteForm(p => ({ ...p, med_reg_no: e.target.value }))}/>
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" type="tel" placeholder="10-digit mobile"
                  value={inviteForm.phone} onChange={e => setInviteForm(p => ({ ...p, phone: e.target.value }))}/>
              </div>
              <div className="flex items-center gap-2 mt-5">
                <input type="checkbox" id="is_primary" checked={inviteForm.is_primary}
                  onChange={e => setInviteForm(p => ({ ...p, is_primary: e.target.checked }))}
                  className="w-4 h-4"/>
                <label htmlFor="is_primary" className="text-sm text-gray-700 font-medium flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 text-yellow-500"/> Set as primary doctor
                </label>
              </div>
            </div>
            {inviteResult?.error && (
              <div className="text-sm text-red-600 flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4"/>{inviteResult.error}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={inviteDoctor} disabled={inviting}
                className="btn-primary text-xs flex items-center gap-2 disabled:opacity-60">
                {inviting ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                  : <UserPlus className="w-3.5 h-3.5"/>}
                {inviting ? 'Creating…' : 'Create Doctor Account'}
              </button>
              <button onClick={() => setShowAdd(false)} className="btn-secondary text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* Doctors list */}
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : (
          <div className="space-y-4">
            {doctors.map(doc => (
              <div key={doc.id} className="card p-5">
                {editing === doc.id ? (
                  // Edit mode
                  <div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="label">Full Name</label>
                        <input className="input" value={editForm.full_name || ''}
                          onChange={e => setEditForm(p => ({ ...p, full_name: e.target.value }))}/>
                      </div>
                      <div>
                        <label className="label">Specialty</label>
                        <input className="input" value={editForm.specialty || ''}
                          onChange={e => setEditForm(p => ({ ...p, specialty: e.target.value }))}/>
                      </div>
                      <div>
                        <label className="label">Medical Reg. No.</label>
                        <input className="input" value={editForm.med_reg_no || ''}
                          onChange={e => setEditForm(p => ({ ...p, med_reg_no: e.target.value }))}/>
                      </div>
                      <div>
                        <label className="label">Phone</label>
                        <input className="input" value={editForm.phone || ''}
                          onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}/>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <input type="checkbox" checked={editForm.is_primary || false}
                        onChange={e => setEditForm(p => ({ ...p, is_primary: e.target.checked }))}
                        className="w-4 h-4"/>
                      <span className="text-sm text-gray-700 flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 text-yellow-500"/> Primary doctor
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(doc.id)} disabled={saving}
                        className="btn-primary text-xs flex items-center gap-1.5">
                        <Save className="w-3 h-3"/>{saving ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => setEditing(null)} className="btn-secondary text-xs flex items-center gap-1.5">
                        <X className="w-3 h-3"/> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <span className="text-lg font-bold text-blue-700">{doc.full_name.charAt(0)}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-gray-900">{doc.full_name}</h3>
                          {doc.is_primary && (
                            <span className="flex items-center gap-1 text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                              <Star className="w-3 h-3"/> Primary
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${doc.role === 'admin' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>
                            {doc.role}
                          </span>
                        </div>
                        {doc.specialty && <p className="text-sm text-gray-600 mt-0.5">{doc.specialty}</p>}
                        <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-400">
                          <span className="flex items-center gap-1"><Mail className="w-3 h-3"/>{doc.email}</span>
                          {doc.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3"/>{doc.phone}</span>}
                          {doc.med_reg_no && <span className="flex items-center gap-1"><Shield className="w-3 h-3"/>Reg: {doc.med_reg_no}</span>}
                        </div>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-2">
                        <button onClick={() => startEdit(doc)}
                          className="btn-secondary text-xs flex items-center gap-1">
                          <Edit className="w-3 h-3"/> Edit
                        </button>
                        {doc.id !== user?.id && (
                          <button onClick={() => deactivateDoctor(doc.id, doc.full_name)}
                            className="text-xs px-2 py-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded border border-transparent hover:border-red-200 transition-colors">
                            <Trash2 className="w-3 h-3"/>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}