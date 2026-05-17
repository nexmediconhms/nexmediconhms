'use client'
/**
 * src/app/settings/lab-partners/page.tsx — v33 FIX
 *
 * FIX #12: Lab partners page now checks for admin role.
 * Doctors and staff see a "read-only" view — they can see which labs are configured
 * but CANNOT add partners, modify percentages, or delete partners.
 * Only admins see the full management UI including revenue percentages.
 *
 * FIX #2/#3: Lab partner revenue data (percentages) is sensitive financial info —
 * only admins should see it. Doctors see lab names only (for assigning to reports).
 */
import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Plus, Trash2, Save, FlaskConical, Percent, Lock, AlertCircle } from 'lucide-react'

interface LabPartner {
  id: string
  name: string
  contact: string
  hospital_pct: number
  lab_pct: number
  is_active: boolean
}

export default function LabPartnersPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const [partners, setPartners] = useState<LabPartner[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', contact: '', hospital_pct: '60', lab_pct: '40' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('lab_partners').select('*').order('name')
    setPartners((data || []) as LabPartner[])
    setLoading(false)
  }

  async function addPartner() {
    if (!form.name.trim() || !isAdmin) return
    setSaving(true)
    const hospitalPct = Number(form.hospital_pct) || 60
    const labPct = Number(form.lab_pct) || 40
    await supabase.from('lab_partners').insert({
      name: form.name.trim(),
      contact: form.contact.trim() || null,
      hospital_pct: hospitalPct,
      lab_pct: labPct,
    })
    setForm({ name: '', contact: '', hospital_pct: '60', lab_pct: '40' })
    setShowForm(false)
    setSaving(false)
    load()
  }

  async function toggleActive(id: string, current: boolean) {
    if (!isAdmin) return
    await supabase.from('lab_partners').update({ is_active: !current }).eq('id', id)
    load()
  }

  async function deletePartner(id: string, name: string) {
    if (!isAdmin) return
    if (!confirm(`Delete partner "${name}"? This cannot be undone.`)) return
    await supabase.from('lab_partners').delete().eq('id', id)
    load()
  }

  function updateSplit(field: 'hospital_pct' | 'lab_pct', value: string) {
    const num = Math.min(100, Math.max(0, Number(value) || 0))
    if (field === 'hospital_pct') setForm(p => ({ ...p, hospital_pct: String(num), lab_pct: String(100 - num) }))
    else setForm(p => ({ ...p, lab_pct: String(num), hospital_pct: String(100 - num) }))
  }

  if (authLoading) {
    return <AppShell><div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div></AppShell>
  }

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-indigo-600" /> Lab Partners
            </h1>
            <p className="text-sm text-gray-500">
              {isAdmin
                ? 'Configure revenue sharing with partner laboratories'
                : 'Active lab partners for your hospital'}
            </p>
          </div>
          {/* FIX #12: Only admins see "Add Partner" button */}
          {isAdmin && (
            <button onClick={() => setShowForm(!showForm)}
              className="btn-primary flex items-center gap-2 text-sm">
              <Plus className="w-4 h-4" /> Add Partner
            </button>
          )}
        </div>

        {/* FIX #12: Non-admin notice */}
        {!isAdmin && (
          <div className="mb-5 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3 text-sm text-blue-700">
            <Lock className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Revenue sharing percentages and partner management are restricted to admin users. Contact your administrator to add or modify lab partners.</span>
          </div>
        )}

        {/* Add partner form — admin only */}
        {isAdmin && showForm && (
          <div className="card p-5 mb-5 border-l-4 border-indigo-400">
            <h3 className="font-semibold text-gray-800 mb-3">New Lab Partner</h3>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="label">Lab Name *</label>
                <input className="input" placeholder="e.g. Metropolis, SRL Diagnostics"
                  value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Contact (optional)</label>
                <input className="input" placeholder="Phone or email"
                  value={form.contact} onChange={e => setForm(p => ({ ...p, contact: e.target.value }))} />
              </div>
              <div>
                <label className="label">Hospital Share (%)</label>
                <input className="input" type="number" min="0" max="100"
                  value={form.hospital_pct} onChange={e => updateSplit('hospital_pct', e.target.value)} />
              </div>
              <div>
                <label className="label">Lab Share (%)</label>
                <input className="input" type="number" min="0" max="100"
                  value={form.lab_pct} onChange={e => updateSplit('lab_pct', e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={addPartner} disabled={saving || !form.name.trim()}
                className="btn-primary text-xs flex items-center gap-2 disabled:opacity-60">
                <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Partner'}
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary text-xs">Cancel</button>
              <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
                <Percent className="w-3 h-3" /> Total: {Number(form.hospital_pct) + Number(form.lab_pct)}%
                {Number(form.hospital_pct) + Number(form.lab_pct) !== 100 && (
                  <span className="text-red-500 font-semibold ml-1">Must equal 100%</span>
                )}
              </span>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        ) : partners.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No lab partners configured</p>
            {isAdmin && <p className="text-sm mt-1">Click "Add Partner" to set up revenue sharing with an external lab</p>}
            {!isAdmin && <p className="text-sm mt-1">Contact your administrator to configure lab partners</p>}
          </div>
        ) : (
          <div className="space-y-3">
            {partners.map(p => (
              <div key={p.id} className={`card p-4 flex items-center gap-4 ${!p.is_active ? 'opacity-50' : ''}`}>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{p.name}</div>
                  {/* FIX #12: Contact shown to all, but only for info */}
                  <div className="text-xs text-gray-500">{p.contact || 'No contact info'}</div>
                </div>
                {/* FIX #12: Revenue percentages shown to admins only */}
                {isAdmin ? (
                  <>
                    <div className="text-center">
                      <div className="text-sm font-bold text-green-700">{p.hospital_pct}%</div>
                      <div className="text-xs text-gray-400">Hospital</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-blue-700">{p.lab_pct}%</div>
                      <div className="text-xs text-gray-400">Lab</div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Lock className="w-3 h-3" /> Revenue split (admin only)
                  </div>
                )}
                <div className="flex gap-1">
                  {/* Active/inactive toggle — admin only */}
                  {isAdmin ? (
                    <>
                      <button onClick={() => toggleActive(p.id, p.is_active)}
                        className={`text-xs px-2 py-1 rounded ${p.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </button>
                      <button onClick={() => deletePartner(p.id, p.name)}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className={`text-xs px-2 py-1 rounded ${p.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info box — only shown to admins */}
        {isAdmin && (
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-blue-800 mb-2">How Revenue Sharing Works</h3>
            <ul className="space-y-1 text-xs text-blue-700">
              <li>1. Add a lab partner with their revenue split (e.g. 60% Hospital / 40% Lab).</li>
              <li>2. When creating a lab report, assign the partner lab from the dropdown.</li>
              <li>3. Reports show "Net to Hospital" vs "Net to Lab" for each test ordered.</li>
              <li>4. The CA Report includes a "Lab Payable" section for monthly reconciliation.</li>
            </ul>
          </div>
        )}
      </div>
    </AppShell>
  )
}