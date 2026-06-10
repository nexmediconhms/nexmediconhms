'use client'
/**
 * src/app/ipd/[bedId]/consent/page.tsx
 *
 * Digital Consent Form Management for IPD
 *
 * Features:
 * - 9 pre-built consent templates (LSCS, Hysterectomy, Delivery, etc.)
 * - Auto-fills patient/doctor/hospital details into templates
 * - Digital signing with signatory details and ID proof
 * - Consent history with status tracking (signed / revoked)
 * - Printable consent forms
 * - Feeds into discharge clearance (consent check)
 *
 * NEW FILE — does not modify any existing page or component.
 * Access via: /ipd/[bedId]/consent
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatDate, getHospitalSettings } from '@/lib/utils'
import {
  FileText, ArrowLeft, Loader2, CheckCircle, AlertCircle,
  Shield, Plus, Eye, Printer, XCircle, Clock,
  User, Phone, CreditCard, PenLine, ChevronDown, ChevronUp,
} from 'lucide-react'

interface ConsentTemplate {
  id: string
  name: string
  code: string
  category: string
  body_text: string
  risks_text: string
}

interface ConsentRecord {
  id: string
  template_id: string
  consent_type: string
  procedure_name: string
  patient_name: string
  signatory_name: string
  signatory_relation: string
  signatory_mobile: string
  signatory_id_proof: string
  doctor_name: string
  witness_name: string
  status: string
  signed_at: string
  rendered_body: string
  rendered_risks: string
  revoked_at: string | null
  revoked_reason: string | null
  created_at: string
}

export default function ConsentPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const bedId = params.bedId as string

  // FIXED: Added address and phone properties to the fallback object
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {
    hospitalName: 'Hospital', doctorName: 'Doctor', doctorQual: '', doctorReg: '', address: '', phone: '',
  }

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bed, setBed] = useState<any>(null)
  const [patient, setPatient] = useState<any>(null)
  const [admissionId, setAdmissionId] = useState('')
  const [templates, setTemplates] = useState<ConsentTemplate[]>([])
  const [records, setRecords] = useState<ConsentRecord[]>([])
  const [tableExists, setTableExists] = useState(true)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<ConsentTemplate | null>(null)
  const [formData, setFormData] = useState({
    procedure_name: '',
    procedure_indication: '',
    anesthesia_type: '',
    consent_language: 'English',
    signatory_name: '',
    signatory_relation: 'Self',
    signatory_mobile: '',
    signatory_id_proof: '',
    doctor_name: '',
    witness_name: '',
    confirmed: false,
  })
  const [saving, setSaving] = useState(false)
  const [previewText, setPreviewText] = useState('')
  const [previewRisks, setPreviewRisks] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  // View signed consent
  const [viewRecord, setViewRecord] = useState<ConsentRecord | null>(null)

  const currentUser = user?.full_name || user?.email || ''

  // ── Load data ─────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: b } = await supabase.from('beds').select('*').eq('id', bedId).single()
      if (!b) { setError('Bed not found'); setLoading(false); return }
      setBed(b)

      if (b.patient_id) {
        const { data: p } = await supabase.from('patients').select('*').eq('id', b.patient_id).single()
        if (p) setPatient(p)
      }

      const { data: adm } = await supabase.from('ipd_admissions')
        .select('id, admitting_doctor, diagnosis_on_admission')
        .eq('bed_id', bedId).eq('status', 'active').single()
      if (adm) {
        setAdmissionId(adm.id)
        setFormData(prev => ({
          ...prev,
          doctor_name: adm.admitting_doctor || hs.doctorName || '',
          procedure_indication: adm.diagnosis_on_admission || '',
        }))
      }

      // Load templates
      const { data: tmpl, error: tmplErr } = await supabase.from('consent_templates')
        .select('*').eq('is_active', true).order('sort_order')
      if (tmplErr) {
        if (tmplErr.message?.includes('does not exist')) setTableExists(false)
        else throw tmplErr
      } else {
        setTemplates(tmpl || [])
      }

      // Load existing consent records
      if (adm?.id) {
        const { data: recs } = await supabase.from('consent_records')
          .select('*').eq('ipd_admission_id', adm.id).order('created_at', { ascending: false })
        setRecords(recs || [])
      }

    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [bedId])

  useEffect(() => { loadData() }, [loadData])

  // ── Render template with placeholders ─────────────────────────
  function renderTemplate(text: string): string {
    if (!text) return ''
    return text
      .replace(/\{\{patient_name\}\}/g, patient?.full_name || '___________')
      .replace(/\{\{signatory_name\}\}/g, formData.signatory_name || '___________')
      .replace(/\{\{signatory_relation\}\}/g, formData.signatory_relation || '___________')
      .replace(/\{\{hospital_name\}\}/g, hs.hospitalName || '___________')
      .replace(/\{\{doctor_name\}\}/g, formData.doctor_name || '___________')
      .replace(/\{\{procedure_name\}\}/g, formData.procedure_name || '___________')
      .replace(/\{\{procedure_indication\}\}/g, formData.procedure_indication || '___________')
      .replace(/\{\{anesthesia_type\}\}/g, formData.anesthesia_type || '___________')
      .replace(/\{\{consent_language\}\}/g, formData.consent_language || 'English')
  }

  // ── Select template ───────────────────────────────────────────
  function selectTemplate(t: ConsentTemplate) {
    setSelectedTemplate(t)
    setFormData(prev => ({
      ...prev,
      signatory_name: patient?.full_name || '',
      signatory_mobile: patient?.mobile || '',
      procedure_name: t.name.replace('Consent for ', ''),
    }))
    setShowForm(true)
    setShowPreview(false)
  }

  // ── Preview ───────────────────────────────────────────────────
  function generatePreview() {
    if (!selectedTemplate) return
    setPreviewText(renderTemplate(selectedTemplate.body_text))
    setPreviewRisks(renderTemplate(selectedTemplate.risks_text || ''))
    setShowPreview(true)
  }

  // ── Save consent ──────────────────────────────────────────────
  async function saveConsent() {
    if (!selectedTemplate || !admissionId || !patient) return
    if (!formData.signatory_name) { setError('Signatory name is required.'); return }
    if (!formData.confirmed) { setError('Please confirm the checkbox to sign the consent.'); return }

    setSaving(true)
    setError('')

    try {
      const rendered = renderTemplate(selectedTemplate.body_text)
      const renderedRisks = renderTemplate(selectedTemplate.risks_text || '')

      const { error: insErr } = await supabase.from('consent_records').insert({
        template_id: selectedTemplate.id,
        ipd_admission_id: admissionId,
        patient_id: patient.id,
        consent_type: selectedTemplate.category,
        procedure_name: formData.procedure_name,
        consent_language: formData.consent_language,
        rendered_body: rendered,
        rendered_risks: renderedRisks,
        patient_name: patient.full_name,
        patient_relation: formData.signatory_relation === 'Self' ? 'Self' : formData.signatory_relation,
        signatory_name: formData.signatory_name,
        signatory_relation: formData.signatory_relation,
        signatory_mobile: formData.signatory_mobile || null,
        signatory_id_proof: formData.signatory_id_proof || null,
        doctor_name: formData.doctor_name,
        doctor_explained: true,
        witness_name: formData.witness_name || null,
        status: 'signed',
        signed_at: new Date().toISOString(),
        created_by: currentUser,
      })

      if (insErr) throw insErr

      setShowForm(false)
      setSelectedTemplate(null)
      setShowPreview(false)
      setFormData(prev => ({ ...prev, confirmed: false }))
      loadData()
    } catch (err: any) {
      setError(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Revoke consent ────────────────────────────────────────────
  async function revokeConsent(id: string) {
    const reason = window.prompt('Reason for revoking this consent:')
    if (!reason) return

    await supabase.from('consent_records').update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_reason: reason,
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    loadData()
  }

  // ── Print consent ─────────────────────────────────────────────
  function printConsent(rec: ConsentRecord) {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`
      <html><head><title>Consent Form — ${rec.procedure_name}</title>
      <style>
        body { font-family: 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.7; padding: 30px 40px; color: #333; }
        h1 { text-align: center; font-size: 20px; letter-spacing: 2px; text-transform: uppercase; border-bottom: 3px solid #333; padding-bottom: 8px; }
        h2 { text-align: center; font-size: 15px; margin-top: 5px; letter-spacing: 3px; text-transform: uppercase; border-top: 1px solid #999; border-bottom: 1px solid #999; padding: 6px 0; }
        .meta { display: flex; justify-content: space-between; font-size: 11px; color: #666; margin: 8px 0; }
        .body { white-space: pre-line; margin: 20px 0; }
        .risks { background: #f9f9f9; padding: 15px; border: 1px solid #ddd; border-radius: 4px; margin: 15px 0; }
        .risks-title { font-weight: bold; margin-bottom: 8px; }
        .sig-block { display: flex; justify-content: space-between; margin-top: 60px; }
        .sig-line { border-top: 2px solid #333; width: 200px; padding-top: 5px; text-align: center; font-size: 11px; }
        .stamp { font-size: 10px; color: #999; text-align: center; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px; }
        @media print { body { padding: 10mm 15mm; } @page { margin: 10mm; } }
      </style></head><body>
      <h1>${hs.hospitalName}</h1>
      <div class="meta"><span>${hs.address || ''}</span><span>Tel: ${hs.phone || ''}</span></div>
      <h2>Informed Consent Form</h2>
      <div class="meta">
        <span>Patient: <strong>${rec.patient_name}</strong></span>
        <span>Date: ${rec.signed_at ? new Date(rec.signed_at).toLocaleDateString('en-IN') : ''}</span>
      </div>
      <div class="meta">
        <span>Procedure: <strong>${rec.procedure_name || rec.consent_type}</strong></span>
        <span>Doctor: ${rec.doctor_name}</span>
      </div>
      <hr/>
      <div class="body">${rec.rendered_body || ''}</div>
      ${rec.rendered_risks ? `<div class="risks"><div class="risks-title">Risks and Complications:</div>${rec.rendered_risks}</div>` : ''}
      <div class="sig-block">
        <div>
          <div class="sig-line">
            ${rec.signatory_name}<br/>
            (${rec.signatory_relation})${rec.signatory_mobile ? '<br/>Mob: ' + rec.signatory_mobile : ''}
            ${rec.signatory_id_proof ? '<br/>ID: ' + rec.signatory_id_proof : ''}
          </div>
          <div style="font-size:10px;margin-top:3px;text-align:center">Patient / Attendant</div>
        </div>
        <div>
          <div class="sig-line">${rec.witness_name || '&nbsp;'}</div>
          <div style="font-size:10px;margin-top:3px;text-align:center">Witness</div>
        </div>
        <div>
          <div class="sig-line">${rec.doctor_name}</div>
          <div style="font-size:10px;margin-top:3px;text-align:center">Doctor</div>
        </div>
      </div>
      <div class="stamp">
        Signed on: ${rec.signed_at ? new Date(rec.signed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''} ·
        Recorded by: ${currentUser} · ${hs.hospitalName}
      </div>
      </body></html>
    `)
    printWindow.document.close()
    setTimeout(() => printWindow.print(), 300)
  }

  // ── Group templates by category ───────────────────────────────
  const tmplByCategory: Record<string, ConsentTemplate[]> = {}
  templates.forEach(t => {
    const cat = t.category || 'General'
    if (!tmplByCategory[cat]) tmplByCategory[cat] = []
    tmplByCategory[cat].push(t)
  })

  const signedCount = records.filter(r => r.status === 'signed').length
  const categoryColors: Record<string, string> = {
    General: 'bg-blue-50 border-blue-200 text-blue-800',
    Surgery: 'bg-orange-50 border-orange-200 text-orange-800',
    Delivery: 'bg-pink-50 border-pink-200 text-pink-800',
    Procedure: 'bg-purple-50 border-purple-200 text-purple-800',
    Anesthesia: 'bg-green-50 border-green-200 text-green-800',
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          <span className="ml-2 text-gray-500">Loading consent forms...</span>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-500" /> Consent Forms
              </h1>
              {patient && (
                <p className="text-sm text-gray-500">
                  {patient.full_name} · MRN: {patient.mrn || '—'} · Bed {bed?.bed_number}
                  {signedCount > 0 && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{signedCount} signed</span>}
                </p>
              )}
            </div>
          </div>
          <Link href={`/ipd/${bedId}`} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
            ← Nursing Chart
          </Link>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            <button onClick={() => setError('')} className="ml-auto text-red-400">×</button>
          </div>
        )}

        {!tableExists && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center mb-4">
            <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto mb-3" />
            <h3 className="font-semibold text-gray-800 mb-2">Database Setup Required</h3>
            <p className="text-sm text-gray-600">
              Run <code className="bg-gray-100 px-1 rounded">consent_forms_migration.sql</code> in Supabase SQL Editor.
            </p>
          </div>
        )}

        {/* ═══ SIGNED CONSENTS ═══ */}
        {records.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Consent Records ({records.length})
            </h2>
            <div className="space-y-2">
              {records.map(rec => (
                <div key={rec.id} className={`flex items-center justify-between p-3 rounded-lg border ${
                  rec.status === 'signed' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                }`}>
                  <div>
                    <span className="font-medium text-gray-800 text-sm">{rec.procedure_name || rec.consent_type}</span>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Signed by: {rec.signatory_name} ({rec.signatory_relation}) ·
                      Doctor: {rec.doctor_name} ·
                      {rec.signed_at && <span> {new Date(rec.signed_at).toLocaleDateString('en-IN')}</span>}
                    </div>
                    {rec.status === 'revoked' && (
                      <div className="text-xs text-red-600 mt-0.5">
                        ⚠ Revoked: {rec.revoked_reason} ({rec.revoked_at ? new Date(rec.revoked_at).toLocaleDateString('en-IN') : ''})
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      rec.status === 'signed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {rec.status === 'signed' ? '✓ Signed' : '✕ Revoked'}
                    </span>
                    <button onClick={() => setViewRecord(rec)} className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
                      <Eye className="w-3 h-3" /> View
                    </button>
                    <button onClick={() => printConsent(rec)} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-0.5">
                      <Printer className="w-3 h-3" /> Print
                    </button>
                    {rec.status === 'signed' && (
                      <button onClick={() => revokeConsent(rec.id)} className="text-xs text-red-400 hover:text-red-600 flex items-center gap-0.5">
                        <XCircle className="w-3 h-3" /> Revoke
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ NEW CONSENT FORM ═══ */}
        {!showForm ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Create New Consent
            </h2>
            <div className="space-y-4">
              {Object.entries(tmplByCategory).map(([cat, tmpls]) => (
                <div key={cat}>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{cat}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {tmpls.map(t => {
                      const alreadySigned = records.some(r => r.template_id === t.id && r.status === 'signed')
                      return (
                        <button key={t.id} onClick={() => selectTemplate(t)}
                          className={`text-left p-3 rounded-lg border-2 transition-all hover:shadow-sm ${
                            categoryColors[cat] || 'bg-gray-50 border-gray-200 text-gray-800'
                          } ${alreadySigned ? 'opacity-60' : 'hover:border-blue-400'}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t.name}</span>
                            {alreadySigned && <CheckCircle className="w-4 h-4 text-green-500" />}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <PenLine className="w-4 h-4 text-blue-500" />
                {selectedTemplate?.name}
              </h2>
              <button onClick={() => { setShowForm(false); setSelectedTemplate(null); setShowPreview(false) }}
                className="text-xs text-gray-400 hover:text-gray-600">✕ Cancel</button>
            </div>

            {/* Form fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Procedure / Surgery Name</label>
                <input type="text" value={formData.procedure_name}
                  onChange={e => setFormData(p => ({ ...p, procedure_name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Indication</label>
                <input type="text" value={formData.procedure_indication}
                  onChange={e => setFormData(p => ({ ...p, procedure_indication: e.target.value }))}
                  placeholder="e.g., Fetal distress, Fibroid uterus"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              {selectedTemplate?.code === 'CON-ANESTHESIA' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Anesthesia Type</label>
                  <select value={formData.anesthesia_type}
                    onChange={e => setFormData(p => ({ ...p, anesthesia_type: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                    <option value="">Select</option>
                    {['Spinal', 'Epidural', 'General (GA)', 'Local', 'Combined Spinal-Epidural', 'Sedation'].map(a => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Consent Language</label>
                <select value={formData.consent_language}
                  onChange={e => setFormData(p => ({ ...p, consent_language: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                  {['English', 'Hindi', 'Gujarati', 'Marathi', 'Tamil', 'Telugu', 'Kannada', 'Bengali', 'Malayalam', 'Punjabi', 'Odia'].map(l => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Signatory details */}
            <div className="border-t border-gray-200 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1">
                <User className="w-3 h-3" /> Signatory Details
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Signatory Name *</label>
                  <input type="text" value={formData.signatory_name}
                    onChange={e => setFormData(p => ({ ...p, signatory_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Relation to Patient</label>
                  <select value={formData.signatory_relation}
                    onChange={e => setFormData(p => ({ ...p, signatory_relation: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                    {['Self', 'Husband', 'Wife', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Guardian', 'Other'].map(r => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Mobile Number</label>
                  <input type="tel" value={formData.signatory_mobile}
                    onChange={e => setFormData(p => ({ ...p, signatory_mobile: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">ID Proof (Aadhar / PAN / Voter ID)</label>
                  <input type="text" value={formData.signatory_id_proof}
                    onChange={e => setFormData(p => ({ ...p, signatory_id_proof: e.target.value }))}
                    placeholder="Optional" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Doctor Name</label>
                  <input type="text" value={formData.doctor_name}
                    onChange={e => setFormData(p => ({ ...p, doctor_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Witness Name</label>
                  <input type="text" value={formData.witness_name}
                    onChange={e => setFormData(p => ({ ...p, witness_name: e.target.value }))}
                    placeholder="Optional" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
            </div>

            {/* Preview button */}
            <div className="flex gap-2">
              <button onClick={generatePreview}
                className="text-sm px-4 py-2 rounded-lg border border-blue-300 text-blue-600 hover:bg-blue-50 flex items-center gap-1">
                <Eye className="w-4 h-4" /> Preview Consent Text
              </button>
            </div>

            {/* Preview */}
            {showPreview && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 text-sm space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Consent Text Preview</p>
                <div className="whitespace-pre-line text-gray-700 leading-relaxed">{previewText}</div>
                {previewRisks && (
                  <div className="bg-red-50 border border-red-200 rounded p-3 mt-3">
                    <p className="text-xs font-semibold text-red-700 mb-1">Risks and Complications:</p>
                    <div className="whitespace-pre-line text-gray-700 text-xs">{previewRisks}</div>
                  </div>
                )}
              </div>
            )}

            {/* Confirmation checkbox */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={formData.confirmed}
                  onChange={e => setFormData(p => ({ ...p, confirmed: e.target.checked }))}
                  className="w-5 h-5 rounded border-gray-300 text-blue-600 mt-0.5" />
                <span className="text-sm text-gray-700">
                  I, <strong>{formData.signatory_name || '(signatory)'}</strong>, confirm that the above procedure,
                  its risks, benefits, and alternatives have been explained to me in <strong>{formData.consent_language}</strong>.
                  I have had the opportunity to ask questions. I voluntarily give my informed consent.
                </span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowForm(false); setSelectedTemplate(null) }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm">Cancel</button>
              <button onClick={saveConsent} disabled={saving || !formData.confirmed}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
                Sign & Save Consent
              </button>
            </div>
          </div>
        )}

        {/* ═══ VIEW SIGNED CONSENT MODAL ═══ */}
        {viewRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 mx-4 max-h-[85vh] overflow-y-auto space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">{viewRecord.procedure_name || viewRecord.consent_type}</h3>
                <button onClick={() => setViewRecord(null)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="text-xs text-gray-500">
                Signed: {viewRecord.signed_at ? new Date(viewRecord.signed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'} ·
                By: {viewRecord.signatory_name} ({viewRecord.signatory_relation}) ·
                Doctor: {viewRecord.doctor_name}
              </div>
              <div className="whitespace-pre-line text-sm text-gray-700 bg-gray-50 rounded-lg p-4 border">
                {viewRecord.rendered_body}
              </div>
              {viewRecord.rendered_risks && (
                <div className="whitespace-pre-line text-xs text-gray-700 bg-red-50 rounded-lg p-4 border border-red-200">
                  <p className="font-semibold text-red-700 mb-1">Risks and Complications:</p>
                  {viewRecord.rendered_risks}
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button onClick={() => printConsent(viewRecord)}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm flex items-center gap-1">
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button onClick={() => setViewRecord(null)}
                  className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm">Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}