'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getIndiaToday, getHospitalSettings } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import {
  Shield, Plus, X, Search, ArrowLeft, Save, Loader2,
  CheckCircle, Clock, AlertTriangle, IndianRupee,
  RefreshCw, ChevronRight, FileText, Share2, MessageCircle,
  Send, Upload, ExternalLink,
} from 'lucide-react'

interface Claim {
  id: string
  patient_id: string
  patient_name: string
  mrn: string
  policy_number: string | null
  tpa_name: string | null
  insurance_company: string | null
  claim_amount: number
  approved_amount: number | null
  status: string
  admission_date: string | null
  discharge_date: string | null
  surgery_name: string | null
  diagnosis: string | null
  pre_auth_number: string | null
  claim_number: string | null
  settlement_utr: string | null
  settlement_date: string | null
  documents_sent: boolean
  notes: string | null
  created_at: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pre_auth_pending:   { label: 'Pre-Auth Pending', color: 'bg-yellow-50 text-yellow-700 border-yellow-200', icon: Clock },
  pre_auth_approved:  { label: 'Pre-Auth Approved', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: CheckCircle },
  pre_auth_rejected:  { label: 'Pre-Auth Rejected', color: 'bg-red-50 text-red-700 border-red-200', icon: X },
  claim_submitted:    { label: 'Claim Submitted', color: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: FileText },
  under_review:       { label: 'Under Review', color: 'bg-purple-50 text-purple-700 border-purple-200', icon: Clock },
  query_raised:       { label: 'Query Raised', color: 'bg-orange-50 text-orange-700 border-orange-200', icon: AlertTriangle },
  query_resolved:     { label: 'Query Resolved', color: 'bg-cyan-50 text-cyan-700 border-cyan-200', icon: CheckCircle },
  approved:           { label: 'Approved', color: 'bg-green-50 text-green-700 border-green-200', icon: CheckCircle },
  partially_approved: { label: 'Partially Approved', color: 'bg-lime-50 text-lime-700 border-lime-200', icon: CheckCircle },
  rejected:           { label: 'Rejected', color: 'bg-red-50 text-red-700 border-red-200', icon: X },
  settled:            { label: 'Settled', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: IndianRupee },
}

const STATUS_FLOW: Record<string, string[]> = {
  pre_auth_pending:   ['pre_auth_approved', 'pre_auth_rejected'],
  pre_auth_approved:  ['claim_submitted'],
  pre_auth_rejected:  ['pre_auth_pending'],
  claim_submitted:    ['under_review'],
  under_review:       ['query_raised', 'approved', 'partially_approved', 'rejected'],
  query_raised:       ['query_resolved'],
  query_resolved:     ['approved', 'partially_approved', 'rejected'],
  approved:           ['settled'],
  partially_approved: ['settled'],
  rejected:           ['pre_auth_pending'],
  settled:            [],
}

export default function InsurancePage() {
  const { user } = useAuth()
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'new'>('list')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState<any[]>([])
  const [selPatient, setSelPatient] = useState<any>(null)
  const [form, setForm] = useState({
    policy_number: '', tpa_name: '', insurance_company: '',
    claim_amount: '', diagnosis: '', surgery_name: '',
    admission_date: '', discharge_date: '', notes: '',
  })
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('insurance_claims').select('*').order('updated_at', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    const { data } = await q
    setClaims((data || []) as Claim[])
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const filtered = claims.filter(c =>
    !search ||
    c.patient_name.toLowerCase().includes(search.toLowerCase()) ||
    (c.mrn || '').includes(search) ||
    (c.tpa_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.claim_number || '').toLowerCase().includes(search.toLowerCase())
  )

  // Stats
  const pending = claims.filter(c => ['pre_auth_pending', 'claim_submitted', 'under_review', 'query_raised'].includes(c.status))
  const pendingAmount = pending.reduce((s, c) => s + c.claim_amount, 0)
  const settled = claims.filter(c => c.status === 'settled')
  const settledAmount = settled.reduce((s, c) => s + (c.approved_amount || 0), 0)

  function searchPatients(q: string) {
    setPatientQuery(q); setSelPatient(null)
    if (q.trim().length < 2) { setPatientResults([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('patients').select('id,full_name,mrn,mobile,policy_tpa_name,policy_number').or(`full_name.ilike.%${q}%,mrn.ilike.%${q}%`).limit(6)
      setPatientResults(data || [])
    }, 300)
  }

  function selectPatient(p: any) {
    setSelPatient(p)
    setPatientResults([])
    if (p.policy_tpa_name) setForm(f => ({ ...f, tpa_name: p.policy_tpa_name }))
    if (p.policy_number) setForm(f => ({ ...f, policy_number: p.policy_number }))
  }

  async function handleCreate() {
    if (!selPatient) { setError('Select a patient'); return }
    if (!form.claim_amount || Number(form.claim_amount) <= 0) { setError('Enter claim amount'); return }
    setSaving(true); setError('')
    const { error: e } = await supabase.from('insurance_claims').insert({
      patient_id: selPatient.id, patient_name: selPatient.full_name, mrn: selPatient.mrn || '',
      policy_number: form.policy_number || null, tpa_name: form.tpa_name || null,
      insurance_company: form.insurance_company || null, claim_amount: Number(form.claim_amount),
      diagnosis: form.diagnosis || null, surgery_name: form.surgery_name || null,
      admission_date: form.admission_date || null, discharge_date: form.discharge_date || null,
      notes: form.notes || null, status: 'pre_auth_pending', created_by: user?.full_name || null,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    resetForm(); setView('list'); load()
  }

  async function updateClaimStatus(claim: Claim, newStatus: string) {
    let extra: any = { status: newStatus, updated_at: new Date().toISOString() }
    if (newStatus === 'settled') {
      const utr = prompt('Settlement UTR / Reference Number:')
      if (utr === null) return
      const amt = prompt(`Approved Amount (claimed: ₹${claim.claim_amount}):`, String(claim.claim_amount))
      if (amt === null) return
      extra.settlement_utr = utr || null
      extra.settlement_date = getIndiaToday()
      extra.approved_amount = Number(amt) || claim.claim_amount
    }
    if (newStatus === 'query_raised') {
      const q = prompt('What query did TPA raise?')
      if (q === null) return
      extra.notes = (claim.notes ? claim.notes + '' : '') + `Query: ${q}`
    }
    if (newStatus === 'pre_auth_approved') {
      const num = prompt('Pre-Auth Number:')
      if (num) extra.pre_auth_number = num
    }
    if (newStatus === 'partially_approved') {
      const amt = prompt(`Approved Amount (claimed: ₹${claim.claim_amount}):`)
      if (amt === null) return
      extra.approved_amount = Number(amt) || 0
      const reason = prompt('Deduction reason:')
      if (reason) extra.deduction_reason = reason
    }

    await supabase.from('insurance_claims').update(extra).eq('id', claim.id)
    await supabase.from('insurance_claim_history').insert({
      claim_id: claim.id, old_status: claim.status, new_status: newStatus,
      notes: extra.notes || null, done_by: user?.full_name || null,
    })
    load()
  }

  function resetForm() {
    setSelPatient(null); setPatientQuery(''); setPatientResults([])
    setForm({ policy_number: '', tpa_name: '', insurance_company: '', claim_amount: '', diagnosis: '', surgery_name: '', admission_date: '', discharge_date: '', notes: '' })
  }

  // ── Share with CA (Chartered Accountant) ─────────────────────
  async function shareWithCA(claim: Claim) {
    const caNumber = prompt('Enter CA WhatsApp number (10-digit mobile):')
    if (!caNumber || caNumber.replace(/\D/g, '').length < 10) return

    const fullNum = caNumber.replace(/\D/g, '').length === 10 ? '91' + caNumber.replace(/\D/g, '') : caNumber.replace(/\D/g, '')

    const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any
    const hospitalName = hs.hospitalName || 'NexMedicon Hospital'

    const message = `*${hospitalName} — Insurance Claim Documents*

📋 *Claim Details:*
• Patient: ${claim.patient_name} (MRN: ${claim.mrn})
• TPA: ${claim.tpa_name || 'N/A'}
• Insurance: ${claim.insurance_company || 'N/A'}
• Policy: ${claim.policy_number || 'N/A'}
• Claim Amount: ₹${claim.claim_amount.toLocaleString('en-IN')}
${claim.approved_amount ? `• Approved: ₹${claim.approved_amount.toLocaleString('en-IN')}` : ''}
• Status: ${STATUS_CONFIG[claim.status]?.label || claim.status}
${claim.pre_auth_number ? `• Pre-Auth #: ${claim.pre_auth_number}` : ''}
${claim.claim_number ? `• Claim #: ${claim.claim_number}` : ''}
${claim.settlement_utr ? `• UTR: ${claim.settlement_utr}` : ''}

🏥 *Treatment:*
• Diagnosis: ${claim.diagnosis || 'N/A'}
• Surgery: ${claim.surgery_name || 'N/A'}
• Admission: ${claim.admission_date ? formatDate(claim.admission_date) : 'N/A'}
• Discharge: ${claim.discharge_date ? formatDate(claim.discharge_date) : 'N/A'}

${claim.notes ? `📝 Notes: ${claim.notes}` : ''}

---
Shared from ${hospitalName} Insurance Module
Please process/file as required.`

    const waUrl = `https://wa.me/${fullNum}?text=${encodeURIComponent(message)}`

    // Log the share
    await supabase.from('insurance_ca_shares').insert({
      claim_id: claim.id,
      shared_to: caNumber,
      shared_by: user?.full_name || 'Staff',
      share_method: 'whatsapp',
      documents: { claim_amount: claim.claim_amount, status: claim.status },
      notes: `Shared claim data for ${claim.patient_name}`,
    })

    window.open(waUrl, '_blank')
  }

  // ── Generate Insurance Bundle / Documents ────────────────────
  async function generateDocBundle(claim: Claim) {
    try {
      // v7 FIX: include auth header so PDF generation isn't 401-blocked
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { alert('Your session has expired. Please log in again.'); return }
      const res = await fetch('/api/insurance-bundle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ claimId: claim.id }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `Insurance_${claim.patient_name}_${claim.mrn}.pdf`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        alert('Failed to generate document bundle. Please try again.')
      }
    } catch {
      alert('Error generating documents.')
    }
  }

  function inr(n: number) { return `₹${n.toLocaleString('en-IN')}` }

  // ═══ NEW CLAIM ═══
  if (view === 'new') {
    return (
      <AppShell>
        <div className="p-6 max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => { resetForm(); setView('list') }} className="text-gray-400 hover:text-gray-700"><ArrowLeft className="w-5 h-5" /></button>
            <h1 className="text-xl font-bold text-gray-900">New Insurance Claim</h1>
          </div>
          {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{error}</div>}
          <div className="card p-5 mb-4">
            <h2 className="section-title">Patient</h2>
            {selPatient ? (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <div><div className="font-semibold">{selPatient.full_name}</div><div className="text-xs text-gray-500">{selPatient.mrn}{selPatient.policy_tpa_name && ` · ${selPatient.policy_tpa_name}`}</div></div>
                <button onClick={() => { setSelPatient(null); setPatientQuery('') }}><X className="w-4 h-4 text-gray-400 hover:text-red-500" /></button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input className="input pl-9" placeholder="Search patient…" value={patientQuery} onChange={e => searchPatients(e.target.value)} autoFocus />
                {patientResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-20 bg-white border rounded-lg shadow-lg mt-1">
                    {patientResults.map(p => (
                      <button key={p.id} onClick={() => selectPatient(p)} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm border-b last:border-0">
                        <span className="font-semibold">{p.full_name}</span><span className="text-gray-400 ml-2 text-xs">{p.mrn}</span>
                        {p.policy_tpa_name && <span className="text-xs text-blue-600 ml-2">{p.policy_tpa_name}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="card p-5 mb-4">
            <h2 className="section-title">Insurance Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">TPA Name</label><input className="input" placeholder="e.g. Medi Assist, Raksha" value={form.tpa_name} onChange={e => setForm(p => ({ ...p, tpa_name: e.target.value }))} /></div>
              <div><label className="label">Insurance Company</label><input className="input" placeholder="e.g. Star Health, HDFC Ergo" value={form.insurance_company} onChange={e => setForm(p => ({ ...p, insurance_company: e.target.value }))} /></div>
              <div><label className="label">Policy Number</label><input className="input" placeholder="Policy / Card number" value={form.policy_number} onChange={e => setForm(p => ({ ...p, policy_number: e.target.value }))} /></div>
              <div><label className="label">Claim Amount (₹) *</label><input className="input" type="number" placeholder="50000" value={form.claim_amount} onChange={e => setForm(p => ({ ...p, claim_amount: e.target.value }))} /></div>
            </div>
          </div>
          <div className="card p-5 mb-4">
            <h2 className="section-title">Treatment Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Diagnosis</label><input className="input" placeholder="e.g. Fibroid Uterus" value={form.diagnosis} onChange={e => setForm(p => ({ ...p, diagnosis: e.target.value }))} /></div>
              <div><label className="label">Surgery / Procedure</label><input className="input" placeholder="e.g. Hysterectomy" value={form.surgery_name} onChange={e => setForm(p => ({ ...p, surgery_name: e.target.value }))} /></div>
              <div><label className="label">Admission Date</label><input className="input" type="date" value={form.admission_date} onChange={e => setForm(p => ({ ...p, admission_date: e.target.value }))} /></div>
              <div><label className="label">Discharge Date</label><input className="input" type="date" value={form.discharge_date} onChange={e => setForm(p => ({ ...p, discharge_date: e.target.value }))} /></div>
              <div className="col-span-2"><label className="label">Notes</label><textarea className="input resize-none" rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
            </div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => { resetForm(); setView('list') }} className="btn-secondary">Cancel</button>
            <button onClick={handleCreate} disabled={saving || !selPatient} className="btn-primary flex items-center gap-2 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{saving ? 'Creating…' : 'Create Claim'}</button>
          </div>
        </div>
      </AppShell>
    )
  }

  // ═══ LIST VIEW ═══
  return (
    <AppShell>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Shield className="w-6 h-6 text-blue-600" /> Insurance Claims</h1>
            <p className="text-sm text-gray-500">{claims.length} claims · {pending.length} pending · {settled.length} settled</p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="btn-secondary flex items-center gap-1 text-xs"><RefreshCw className="w-3.5 h-3.5" /></button>
            <button onClick={() => { resetForm(); setView('new') }} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> New Claim</button>
          </div>
        </div>

        {/* Tab Navigation — Claims vs Insured Patients */}
        <InsuranceTabsSection
          claims={claims}
          pending={pending}
          pendingAmount={pendingAmount}
          settled={settled}
          settledAmount={settledAmount}
          filtered={filtered}
          loading={loading}
          search={search}
          setSearch={setSearch}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          updateClaimStatus={updateClaimStatus}
          shareWithCA={shareWithCA}
          generateDocBundle={generateDocBundle}
          inr={inr}
          user={user}
        />
      </div>
    </AppShell>
  )
}

// ═══════════════════════════════════════════════════════════════
// InsuranceTabsSection — Combines Claims list + Insured Patients
// ═══════════════════════════════════════════════════════════════

function InsuranceTabsSection({
  claims, pending, pendingAmount, settled, settledAmount, filtered,
  loading, search, setSearch, statusFilter, setStatusFilter,
  updateClaimStatus, shareWithCA, generateDocBundle, inr, user,
}: any) {
  const [activeTab, setActiveTab] = useState<'claims' | 'insured_patients'>('claims')
  const [insuredPatients, setInsuredPatients] = useState<any[]>([])
  const [insuredStats, setInsuredStats] = useState<any>(null)
  const [insuredLoading, setInsuredLoading] = useState(false)
  const [insuredFilter, setInsuredFilter] = useState<string>('all')

  // Load insured patients from sync API
  async function loadInsuredPatients(filter = insuredFilter) {
    setInsuredLoading(true)
    try {
      // v7 FIX: API route requires Authorization header (requireAuth).
      // Previously the fetch had no header → server returned 401 → res.ok
      // was false → the list silently stayed empty. Same pattern used by
      // every other authenticated fetch in this codebase.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        console.error('[Insurance] No active session; cannot load insured patients')
        setInsuredLoading(false)
        return
      }
      const res = await fetch(`/api/insurance/sync?filter=${filter}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setInsuredPatients(data.patients || [])
        setInsuredStats(data.stats || null)
      } else {
        const body = await res.text().catch(() => '')
        console.error('[Insurance] /api/insurance/sync failed:', res.status, body)
      }
    } catch (e) {
      console.error('[Insurance] Failed to load insured patients:', e)
    }
    setInsuredLoading(false)
  }

  useEffect(() => {
    if (activeTab === 'insured_patients') {
      loadInsuredPatients()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, insuredFilter])

  // Auto-create claim for a patient
  async function autoCreateClaim(patient: any) {
    if (!confirm(`Create insurance claim entry for ${patient.patient_name}?`)) return
    try {
      // v7 FIX: include auth header so POST isn't 401-blocked
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { alert('Your session has expired. Please log in again.'); return }
      const res = await fetch('/api/insurance/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          patient_id: patient.patient_id,
          trigger: 'manual',
        }),
      })
      const data = await res.json()
      if (data.ok) {
        alert(`Claim created for ${patient.patient_name}. Switch to Claims tab to manage it.`)
        loadInsuredPatients()
      } else {
        alert(data.message || data.error || 'Failed to create claim')
      }
    } catch {
      alert('Error creating claim')
    }
  }

  return (
    <>
      {/* Tab buttons */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('claims')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5
            ${activeTab === 'claims' ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
          <FileText className="w-3.5 h-3.5" /> Claims ({claims.length})
        </button>
        <button
          onClick={() => setActiveTab('insured_patients')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5
            ${activeTab === 'insured_patients' ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
          <Shield className="w-3.5 h-3.5" /> Insured Patients
          {insuredStats?.patients_without_claims > 0 && (
            <span className="bg-orange-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
              {insuredStats.patients_without_claims}
            </span>
          )}
        </button>
      </div>

      {/* ═══ CLAIMS TAB ═══ */}
      {activeTab === 'claims' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="card p-4 bg-orange-50">
              <div className="text-2xl font-bold text-orange-700">{inr(pendingAmount)}</div>
              <div className="text-xs font-semibold text-gray-600">{pending.length} Pending Claims</div>
            </div>
            <div className="card p-4 bg-green-50">
              <div className="text-2xl font-bold text-green-700">{inr(settledAmount)}</div>
              <div className="text-xs font-semibold text-gray-600">{settled.length} Settled</div>
            </div>
            <div className="card p-4 bg-blue-50">
              <div className="text-2xl font-bold text-blue-700">{claims.length}</div>
              <div className="text-xs font-semibold text-gray-600">Total Claims</div>
            </div>
          </div>

          {/* Search + filter */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-9" placeholder="Search patient, MRN, TPA, claim #…" value={search} onChange={(e: any) => setSearch(e.target.value)} />
            </div>
            <select className="input w-48" value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
          </div>

          {/* Claims list */}
          {loading ? <div className="text-center py-12 text-gray-400">Loading…</div> : filtered.length === 0 ? (
            <div className="card p-12 text-center text-gray-400">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">{claims.length === 0 ? 'No claims yet' : 'No claims match filter'}</p>
              {claims.length === 0 && (
                <p className="text-sm mt-2">
                  Patients who register with insurance will auto-appear in the <strong>Insured Patients</strong> tab.
                  Create claims from there or click <strong>+ New Claim</strong> above.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((c: any) => {
                const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.pre_auth_pending
                const Icon = cfg.icon
                const nextStatuses = STATUS_FLOW[c.status] || []
                return (
                  <div key={c.id} className={`card p-4 border ${cfg.color}`}>
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-semibold text-gray-900">{c.patient_name}</span>
                          <span className="text-xs text-gray-400">{c.mrn}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.color}`}><Icon className="w-3 h-3 inline mr-1" />{cfg.label}</span>
                        </div>
                        <div className="text-sm text-gray-600">
                          {c.tpa_name && <span>{c.tpa_name}</span>}
                          {c.insurance_company && <span className="ml-2 text-gray-400">({c.insurance_company})</span>}
                          {c.policy_number && <span className="ml-2 text-xs text-gray-400">Policy: {c.policy_number}</span>}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {c.diagnosis && <span>Dx: {c.diagnosis}</span>}
                          {c.surgery_name && <span className="ml-2">Surgery: {c.surgery_name}</span>}
                        </div>
                        <div className="flex items-center gap-4 mt-2">
                          <span className="text-sm font-mono font-bold text-gray-800">Claimed: {inr(c.claim_amount)}</span>
                          {c.approved_amount != null && <span className="text-sm font-mono font-bold text-green-700">Approved: {inr(c.approved_amount)}</span>}
                          {c.settlement_utr && <span className="text-xs text-gray-400">UTR: {c.settlement_utr}</span>}
                        </div>
                        {c.notes && <div className="text-xs text-gray-500 mt-1 italic">{c.notes}</div>}
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0 min-w-[100px]">
                        {nextStatuses.map((ns: string) => (
                          <button key={ns} onClick={() => updateClaimStatus(c, ns)}
                            className="text-xs bg-white border border-gray-200 hover:bg-gray-50 px-2 py-1 rounded font-medium text-gray-700 text-left">
                            → {STATUS_CONFIG[ns]?.label || ns}
                          </button>
                        ))}
                        <button onClick={() => shareWithCA(c)}
                          className="text-xs bg-green-50 border border-green-200 hover:bg-green-100 px-2 py-1 rounded font-medium text-green-700 text-left flex items-center gap-1">
                          <Share2 className="w-3 h-3" /> Share with CA
                        </button>
                        <button onClick={() => generateDocBundle(c)}
                          className="text-xs bg-blue-50 border border-blue-200 hover:bg-blue-100 px-2 py-1 rounded font-medium text-blue-700 text-left flex items-center gap-1">
                          <FileText className="w-3 h-3" /> Download Docs
                        </button>
                        <Link href={`/patients/${c.patient_id}`} className="text-xs text-blue-600 hover:underline px-2 py-1">Patient</Link>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ═══ INSURED PATIENTS TAB ═══ */}
      {activeTab === 'insured_patients' && (
        <>
          {/* Insured Patients Stats */}
          {insuredStats && (
            <div className="grid grid-cols-4 gap-3 mb-5">
              <div className="card p-3 bg-blue-50">
                <div className="text-xl font-bold text-blue-700">{insuredStats.total_insured_patients}</div>
                <div className="text-xs text-gray-600">Total Insured</div>
              </div>
              <div className="card p-3 bg-orange-50">
                <div className="text-xl font-bold text-orange-700">{insuredStats.patients_without_claims}</div>
                <div className="text-xs text-gray-600">No Claims Yet</div>
              </div>
              <div className="card p-3 bg-yellow-50">
                <div className="text-xl font-bold text-yellow-700">{insuredStats.patients_with_pending}</div>
                <div className="text-xs text-gray-600">Pending</div>
              </div>
              <div className="card p-3 bg-green-50">
                <div className="text-xl font-bold text-green-700">{insuredStats.patients_settled}</div>
                <div className="text-xs text-gray-600">Settled</div>
              </div>
            </div>
          )}

          {/* Filter tabs */}
          <div className="flex gap-2 mb-4">
            {[
              { key: 'all', label: 'All Insured' },
              { key: 'no_claim', label: 'No Claim' },
              { key: 'pending', label: 'Pending' },
              { key: 'settled', label: 'Settled' },
            ].map(f => (
              <button key={f.key}
                onClick={() => setInsuredFilter(f.key)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
                  ${insuredFilter === f.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                {f.label}
              </button>
            ))}
            <button onClick={() => loadInsuredPatients(insuredFilter)}
              className="text-xs text-gray-500 hover:text-gray-700 ml-auto flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>

          {/* Info banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-xs text-blue-700">
            <strong>Auto-Sync:</strong> This list auto-updates from patient registration. When a patient registers with
            Mediclaim = Yes or Cashless = Yes, they appear here. Claims are auto-created when they get admitted or discharged.
          </div>

          {/* Patient list */}
          {insuredLoading ? (
            <div className="text-center py-12 text-gray-400">Loading insured patients…</div>
          ) : insuredPatients.length === 0 ? (
            <div className="card p-12 text-center text-gray-400">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No insured patients found</p>
              <p className="text-sm mt-1">Patients who register with Mediclaim/Cashless will appear here automatically.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {insuredPatients.map((p: any) => (
                <div key={p.patient_id} className="card p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/patients/${p.patient_id}`} className="font-semibold text-gray-900 hover:text-blue-600 hover:underline">
                        {p.patient_name}
                      </Link>
                      <span className="text-xs text-gray-400 font-mono">{p.mrn}</span>
                      {p.mediclaim && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Mediclaim</span>}
                      {p.cashless && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Cashless</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {p.policy_tpa_name && <span>TPA: <strong>{p.policy_tpa_name}</strong></span>}
                      {p.policy_number && <span className="ml-2">Policy: {p.policy_number}</span>}
                      {p.mobile && <span className="ml-2 font-mono">{p.mobile}</span>}
                    </div>
                    {p.has_claim && (
                      <div className="text-xs mt-1">
                        <span className="text-gray-500">{p.total_claims} claim(s)</span>
                        {p.pending_claims > 0 && <span className="ml-2 text-orange-600">{p.pending_claims} pending</span>}
                        {p.settled_claims > 0 && <span className="ml-2 text-green-600">{p.settled_claims} settled</span>}
                        {p.total_claimed_amount > 0 && <span className="ml-2 font-mono">Claimed: {inr(p.total_claimed_amount)}</span>}
                        {p.total_settled_amount > 0 && <span className="ml-2 font-mono text-green-700">Settled: {inr(p.total_settled_amount)}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {!p.has_claim ? (
                      <button
                        onClick={() => autoCreateClaim(p)}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Create Claim
                      </button>
                    ) : (
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        p.latest_claim_status === 'settled' ? 'bg-green-100 text-green-700' :
                        p.pending_claims > 0 ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {STATUS_CONFIG[p.latest_claim_status]?.label || p.latest_claim_status || 'Active'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}