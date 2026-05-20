'use client'
/**
 * src/components/settings/LabPartnerSection.tsx
 *
 * Lab Partner Management — Admin UI for:
 * - Viewing existing lab partners
 * - Creating new lab partners with one-click token generation
 * - Copying shareable portal link
 * - Toggling partner active/inactive
 * - Regenerating tokens
 *
 * Lab partners use a SEPARATE authentication system (token-based portal)
 * and don't need Supabase Auth accounts.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import {
  FlaskConical, Plus, Copy, Check, Loader2, AlertCircle,
  RefreshCw, ExternalLink, Trash2, ToggleLeft, ToggleRight,
  Link2, Send,
} from 'lucide-react'

interface LabPartner {
  id: string
  name: string
  email: string | null
  phone: string | null
  is_active: boolean
  created_at: string
}

interface PortalUser {
  id: string
  name: string
  email: string | null
  phone: string | null
  lab_partner_id: string
  lab_name: string
  auth_token: string
  is_active: boolean
  last_used_at: string | null
  created_at: string
}

export default function LabPartnerSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [partners, setPartners] = useState<LabPartner[]>([])
  const [portalUsers, setPortalUsers] = useState<PortalUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // New partner form
  const [showAdd, setShowAdd] = useState(false)
  const [newLabName, setNewLabName] = useState('')
  const [newLabPhone, setNewLabPhone] = useState('')
  const [newLabEmail, setNewLabEmail] = useState('')
  const [newContactName, setNewContactName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState<{ ok: boolean; msg: string; token?: string; url?: string } | null>(null)

  // Copied states
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => { if (isAdmin) loadData() }, [isAdmin])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('Not authenticated'); setLoading(false); return }

      const res = await fetch('/api/labs/portal-users', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()

      if (json.error) {
        // Table might not exist yet — not a fatal error
        if (json.error.includes('does not exist')) {
          setError('Lab partner tables not set up yet. Run fix-all-permissions.sql in Supabase SQL Editor.')
        } else {
          setError(json.error)
        }
      } else {
        setPortalUsers(json.users || [])
      }

      // Also load lab partners directly
      const { data: lps } = await supabase.from('lab_partners').select('*').order('created_at', { ascending: false })
      setPartners(lps || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load')
    }
    setLoading(false)
  }

  async function handleCreatePartner() {
    if (!newLabName.trim() || !newContactName.trim()) return
    setCreating(true)
    setCreateResult(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setCreateResult({ ok: false, msg: 'Not authenticated' }); setCreating(false); return }

      // Step 1: Create lab partner record
      const { data: lp, error: lpErr } = await supabase
        .from('lab_partners')
        .insert({
          name: newLabName.trim(),
          phone: newLabPhone.trim() || null,
          email: newLabEmail.trim() || null,
        })
        .select()
        .single()

      if (lpErr) {
        setCreateResult({ ok: false, msg: `Failed to create lab partner: ${lpErr.message}` })
        setCreating(false)
        return
      }

      // Step 2: Create portal user with token
      const res = await fetch('/api/labs/portal-users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: newContactName.trim(),
          email: newLabEmail.trim() || undefined,
          phone: newLabPhone.trim() || undefined,
          lab_partner_id: lp.id,
        }),
      })

      const json = await res.json()

      if (json.ok) {
        const portalUrl = `${window.location.origin}/lab-partner-portal?token=${json.token}`
        setCreateResult({
          ok: true,
          msg: `Lab partner "${newLabName}" created! Share the link below.`,
          token: json.token,
          url: portalUrl,
        })
        // Reset form
        setNewLabName('')
        setNewLabPhone('')
        setNewLabEmail('')
        setNewContactName('')
        loadData()
      } else {
        setCreateResult({ ok: false, msg: json.error || 'Failed to create portal user' })
      }
    } catch (err: any) {
      setCreateResult({ ok: false, msg: err.message })
    }
    setCreating(false)
  }

  async function handleToggleActive(portalUserId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      await fetch('/api/labs/portal-users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id: portalUserId, action: 'toggle_active' }),
      })
      loadData()
    } catch {}
  }

  async function handleRegenerateToken(portalUserId: string) {
    if (!confirm('Regenerate token? The old link will stop working immediately.')) return

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch('/api/labs/portal-users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id: portalUserId, action: 'regenerate_token' }),
      })
      const json = await res.json()
      if (json.ok) {
        alert(`New token generated! New link:\n${json.shareable_url}`)
        loadData()
      }
    } catch {}
  }

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function getPortalUrl(token: string) {
    return `${window.location.origin}/lab-partner-portal?token=${token}`
  }

  if (!isAdmin) return null

  return (
    <div className="card p-6 mb-6">
      <h2 className="section-title flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-purple-600" /> Lab Partners
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        External labs can upload patient reports directly via a token-based portal.
        No email/password needed — just share the link.
      </p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Existing portal users */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading lab partners...
        </div>
      ) : (
        <div className="space-y-3 mb-4">
          {portalUsers.map(pu => (
            <div key={pu.id} className={`rounded-xl border p-4 ${pu.is_active ? 'border-purple-200 bg-purple-50/50' : 'border-gray-200 bg-gray-50 opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">{pu.lab_name}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${pu.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {pu.is_active ? 'Active' : 'Revoked'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Contact: {pu.name} {pu.email && `· ${pu.email}`} {pu.phone && `· ${pu.phone}`}
                  </div>
                  {pu.last_used_at && (
                    <div className="text-[10px] text-gray-400 mt-1">
                      Last upload: {new Date(pu.last_used_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Copy link */}
                  <button
                    onClick={() => copyToClipboard(getPortalUrl(pu.auth_token), pu.id)}
                    className="p-2 rounded-lg hover:bg-purple-100 text-purple-600 transition-colors"
                    title="Copy portal link"
                  >
                    {copiedId === pu.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </button>

                  {/* Open portal */}
                  <a
                    href={getPortalUrl(pu.auth_token)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-lg hover:bg-blue-100 text-blue-600 transition-colors"
                    title="Open portal (test)"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>

                  {/* Regenerate token */}
                  <button
                    onClick={() => handleRegenerateToken(pu.id)}
                    className="p-2 rounded-lg hover:bg-orange-100 text-orange-600 transition-colors"
                    title="Regenerate token (old link dies)"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>

                  {/* Toggle active */}
                  <button
                    onClick={() => handleToggleActive(pu.id)}
                    className={`p-2 rounded-lg transition-colors ${pu.is_active ? 'hover:bg-red-100 text-red-500' : 'hover:bg-green-100 text-green-600'}`}
                    title={pu.is_active ? 'Revoke access' : 'Reactivate access'}
                  >
                    {pu.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Shareable link (copyable) */}
              {pu.is_active && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 bg-white border border-purple-200 rounded-lg px-3 py-1.5 text-xs text-purple-700 font-mono truncate">
                    {getPortalUrl(pu.auth_token)}
                  </div>
                  <button
                    onClick={() => copyToClipboard(getPortalUrl(pu.auth_token), `link-${pu.id}`)}
                    className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1 flex-shrink-0"
                  >
                    {copiedId === `link-${pu.id}` ? <Check className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
                    {copiedId === `link-${pu.id}` ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
              )}
            </div>
          ))}
          {portalUsers.length === 0 && !loading && (
            <p className="text-sm text-gray-400 italic py-3 text-center">
              No lab partners yet. Add your first one below.
            </p>
          )}
        </div>
      )}

      {/* Add new lab partner */}
      {!showAdd ? (
        <button onClick={() => setShowAdd(true)}
          className="btn-primary text-sm flex items-center gap-2 bg-purple-600 hover:bg-purple-700">
          <Plus className="w-4 h-4" /> Add Lab Partner
        </button>
      ) : (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-purple-800 flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add New Lab Partner
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Lab Name *</label>
              <input className="input" placeholder="City Pathology Lab"
                value={newLabName} onChange={e => setNewLabName(e.target.value)} />
            </div>
            <div>
              <label className="label">Contact Person *</label>
              <input className="input" placeholder="Ramesh Patel"
                value={newContactName} onChange={e => setNewContactName(e.target.value)} />
            </div>
            <div>
              <label className="label">Phone (optional)</label>
              <input className="input" placeholder="9876543210"
                value={newLabPhone} onChange={e => setNewLabPhone(e.target.value)} />
            </div>
            <div>
              <label className="label">Email (optional)</label>
              <input className="input" type="email" placeholder="lab@example.com"
                value={newLabEmail} onChange={e => setNewLabEmail(e.target.value)} />
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={handleCreatePartner}
              disabled={creating || !newLabName.trim() || !newContactName.trim()}
              className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50 bg-purple-600 hover:bg-purple-700">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              {creating ? 'Creating...' : 'Create & Generate Link'}
            </button>
            <button onClick={() => { setShowAdd(false); setCreateResult(null) }}
              className="btn-secondary text-sm">Cancel</button>
          </div>

          {/* Result */}
          {createResult && (
            <div className={`rounded-xl p-4 text-sm ${createResult.ok ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <p className={createResult.ok ? 'text-green-800 font-semibold' : 'text-red-700'}>{createResult.msg}</p>
              {createResult.url && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-bold text-green-700">Share this link with the lab partner:</p>
                  <div className="flex items-center gap-2 bg-white border border-green-300 rounded-lg px-3 py-2">
                    <code className="text-xs text-green-800 font-mono flex-1 truncate">{createResult.url}</code>
                    <button onClick={() => copyToClipboard(createResult.url!, 'new-link')}
                      className="text-green-600 hover:text-green-800 p-1 flex-shrink-0">
                      {copiedId === 'new-link' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-green-600">
                    The lab partner can bookmark this link. It works permanently until you revoke it.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* How it works callout */}
      <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-gray-600 mb-1">How Lab Partner Portal Works:</p>
        <ul className="text-xs text-gray-500 space-y-0.5 list-disc list-inside">
          <li>Lab partner opens the shared link (no login/password needed)</li>
          <li>They upload PDF reports using patient MRN numbers</li>
          <li>Doctor & staff get in-app notifications when a report is uploaded</li>
          <li>Reports appear automatically in the patient&apos;s profile</li>
          <li>You can revoke access instantly by toggling the switch</li>
        </ul>
      </div>
    </div>
  )
}
