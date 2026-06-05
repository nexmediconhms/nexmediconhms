'use client'
/**
 * src/app/ipd/beds/page.tsx
 *
 * Full Bed Management page.
 * Requires v30-master-fix.sql to have been run first (adds reservedfor, reservedat, reservednote columns).
 *
 * HOW TO ADD TO NAVIGATION:
 * In your sidebar/nav, add a link to /ipd/beds
 */

import { useEffect, useState, useCallback } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { BedStatus, getBedActions, isBedAssignable } from '@/lib/business-logic'
import { useAuth } from '@/lib/auth'
import {
  Bed, User, Lock, Wrench, CheckCircle, Plus,
  RefreshCw, Search, X, AlertCircle, Trash2,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────

interface BedRecord {
  id:           string
  bed_number:   string
  ward:         string | null
  type:         string
  status:       BedStatus
  reservedfor:  string | null
  reservedat:   string | null
  reservednote: string | null
  notes:        string | null
  patient_name?: string
  patient_mrn?:  string
}

// ── Status styles ─────────────────────────────────────────────

const STATUS_STYLES: Record<BedStatus, {
  border: string; bg: string; text: string; dot: string; label: string
}> = {
  available:   { border: 'border-green-300',  bg: 'bg-green-50',   text: 'text-green-700',  dot: 'bg-green-500',  label: 'Available'   },
  occupied:    { border: 'border-red-300',    bg: 'bg-red-50',     text: 'text-red-700',    dot: 'bg-red-500',    label: 'Occupied'    },
  reserved:    { border: 'border-amber-300',  bg: 'bg-amber-50',   text: 'text-amber-700',  dot: 'bg-amber-500',  label: 'Reserved'    },
  maintenance: { border: 'border-gray-300',   bg: 'bg-gray-50',    text: 'text-gray-600',   dot: 'bg-gray-400',   label: 'Maintenance' },
}

// ── Reserve Modal ─────────────────────────────────────────────

function ReserveModal({
  bed, onClose, onDone,
}: { bed: BedRecord; onClose: () => void; onDone: () => void }) {
  const [name,   setName]   = useState('')
  const [note,   setNote]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  async function confirm() {
    if (!name.trim()) { setError('Patient name is required'); return }
    setSaving(true)
    const { error: err } = await supabase
      .from('beds')
      .update({
        status:       'reserved',
        reservedfor:  name.trim(),
        reservednote: note.trim() || null,
        reservedat:   new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      })
      .eq('id', bed.id)

    setSaving(false)
    if (err) { setError(err.message); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">🔒 Reserve Bed {bed.bed_number}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl p-3 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Patient / Person Name <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="e.g. Priya Sharma"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Note (optional)</label>
            <textarea
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              rows={2}
              placeholder="e.g. Expected tomorrow morning"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={confirm}
            disabled={saving || !name.trim()}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2.5
                       rounded-xl font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Reserving…' : '🔒 Reserve Bed'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-semibold text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Bed Modal ─────────────────────────────────────────────

function AddBedModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form,   setForm]   = useState({ bed_number: '', ward: '', type: 'General' })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  async function save() {
    if (!form.bed_number.trim()) { setError('Bed number is required'); return }
    if (!form.ward.trim()) { setError('Ward is required'); return }
    setSaving(true)
    setError('')

    const bedNumber = form.bed_number.trim().toUpperCase()
    const ward = form.ward.trim()

    // Try with 'bed_number' column first (new schema)
    let result = await supabase.from('beds').insert({
      bed_number: bedNumber,
      ward,
      type:      form.type,
      status:    'available',
    })

    // If that fails with schema cache error, try the old column name 'bednumber'
    if (result.error && result.error.message.includes('schema cache')) {
      result = await supabase.from('beds').insert({
        bednumber: bedNumber,
        ward,
        type:     form.type,
        status:   'available',
      } as any)
    }

    setSaving(false)
    if (result.error) {
      // Provide user-friendly error messages
      if (result.error.message.includes('duplicate') || result.error.message.includes('unique')) {
        setError(`Bed "${bedNumber}" already exists. Choose a different bed number.`)
      } else if (result.error.message.includes('schema cache')) {
        setError('Database schema mismatch. Please run the migration SQL (migrations/001-fix-beds-schema.sql) in Supabase SQL Editor to fix this.')
      } else {
        setError(result.error.message)
      }
      return
    }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">+ Add New Bed</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Bed Number <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. B01, W2-03"
              value={form.bed_number}
              onChange={e => setForm(f => ({ ...f, bed_number: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Ward</label>
            <input
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. General, Maternity, Private"
              value={form.ward}
              onChange={e => setForm(f => ({ ...f, ward: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Bed Type</label>
            <select
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            >
              {['General', 'Semi-Private', 'Private', 'ICU', 'HDU', 'Labour Room', 'Maternity'].map(t => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5
                       rounded-xl font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Adding…' : '+ Add Bed'}
          </button>
          <button onClick={onClose}
            className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-semibold text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bed Card ──────────────────────────────────────────────────

function BedCard({
  bed, onAction,
}: {
  bed:      BedRecord
  onAction: (bed: BedRecord, action: string) => void
}) {
  const s = STATUS_STYLES[bed.status]

  return (
    <div className={`border-2 ${s.border} ${s.bg} rounded-2xl p-4 space-y-3`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${s.dot} flex-shrink-0`} />
          <div>
            <div className="font-bold text-gray-900">Bed {bed.bed_number}</div>
            <div className="text-xs text-gray-500">{bed.ward || 'General'} · {bed.type}</div>
          </div>
        </div>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/70 ${s.text}`}>
          {s.label}
        </span>
      </div>

      {/* Occupied info */}
      {bed.status === 'occupied' && bed.patient_name && (
        <div className="flex items-center gap-2 bg-white/60 rounded-xl px-3 py-2">
          <User className="w-4 h-4 text-red-500 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{bed.patient_name}</div>
            {bed.patient_mrn && (
              <div className="text-xs text-gray-500">{bed.patient_mrn}</div>
            )}
          </div>
        </div>
      )}

      {/* Reserved info */}
      {bed.status === 'reserved' && bed.reservedfor && (
        <div className="flex items-start gap-2 bg-white/60 rounded-xl px-3 py-2">
          <Lock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{bed.reservedfor}</div>
            {bed.reservednote && (
              <div className="text-xs text-gray-500 mt-0.5">{bed.reservednote}</div>
            )}
            {bed.reservedat && (
              <div className="text-xs text-gray-400 mt-0.5">
                Reserved: {new Date(bed.reservedat).toLocaleString('en-IN', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
                {/* ── IPD-7 fix: show a "stale reservation" badge ──
                    Pre-fix, a reservation made 6 months ago for "Priya Sharma"
                    looked identical to one made 10 minutes ago — staff had no
                    cue that something needed attention. We compute staleness
                    from `reservedat` (no schema change required) and surface
                    it inline; the user can then unreserve / convert it as
                    appropriate.  Threshold: > 24 hours. */}
                {(() => {
                  const ageMs = Date.now() - new Date(bed.reservedat).getTime()
                  const ageHrs = ageMs / (1000 * 60 * 60)
                  if (ageHrs <= 24) return null
                  const ageDays = Math.floor(ageHrs / 24)
                  return (
                    <span className="ml-2 inline-block bg-amber-200 text-amber-800 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                      ⏳ {ageDays >= 1
                        ? `${ageDays} day${ageDays !== 1 ? 's' : ''} old`
                        : `${Math.floor(ageHrs)} hours old`} — review
                    </span>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {bed.status === 'available' && (
          <>
            <button
              onClick={() => onAction(bed, 'reserve')}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5
                         bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold"
            >
              <Lock className="w-3 h-3" /> Reserve
            </button>
            <button
              onClick={() => onAction(bed, 'maintenance')}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5
                         bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-semibold"
            >
              <Wrench className="w-3 h-3" /> Maintenance
            </button>
          </>
        )}

        {bed.status === 'reserved' && (
          <>
            <button
              onClick={() => onAction(bed, 'available')}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5
                         bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold"
            >
              <CheckCircle className="w-3 h-3" /> Unreserve
            </button>
            <button
              onClick={() => onAction(bed, 'maintenance')}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5
                         bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-semibold"
            >
              <Wrench className="w-3 h-3" /> Maintenance
            </button>
          </>
        )}

        {bed.status === 'maintenance' && (
          <button
            onClick={() => onAction(bed, 'available')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5
                       bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold"
          >
            <CheckCircle className="w-3 h-3" /> Mark Available
          </button>
        )}

        {bed.status === 'occupied' && (
          <p className="text-xs text-red-600 opacity-70 italic">
            Discharge patient to free this bed
          </p>
        )}

        {/* Delete button — only visible for non-occupied beds */}
        {bed.status !== 'occupied' && (
          <button
            onClick={() => onAction(bed, 'delete')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5
                       bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold ml-auto"
          >
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

export default function BedsPage() {
  const { isAdmin } = useAuth()
  const [beds,         setBeds]         = useState<BedRecord[]>([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [filterStatus, setFilterStatus] = useState<BedStatus | 'all'>('all')
  const [reservingBed, setReservingBed] = useState<BedRecord | null>(null)
  const [showAdd,      setShowAdd]      = useState(false)

  const stats = {
    available:   beds.filter(b => b.status === 'available').length,
    occupied:    beds.filter(b => b.status === 'occupied').length,
    reserved:    beds.filter(b => b.status === 'reserved').length,
    maintenance: beds.filter(b => b.status === 'maintenance').length,
  }

  // ── IPD-10 fix: surface schema-cache fallbacks visibly ──
  // The loadBeds() routine below transparently falls back to the legacy
  // (no-underscore) bed columns when the new snake_case query fails with
  // a schema-cache error. Pre-fix that fallback was completely silent —
  // a partial migration on a Supabase project would route every request
  // through the legacy path forever and only surface as "performance is
  // weird" tickets. Now we capture whether the fallback fired and show
  // a discreet one-line banner so the admin notices and can run the
  // pending migration.
  const [schemaFallbackHit, setSchemaFallbackHit] = useState(false)

  const loadBeds = useCallback(async () => {
    setLoading(true)

    // Try with 'bed_number' first (new schema), fallback to 'bednumber' (old schema)
    let bedData: any[] | null = null
    let { data, error: err1 } = await supabase
      .from('beds')
      .select('*')
      .order('bed_number')

    if (err1 && err1.message.includes('schema cache')) {
      // Old schema — try ordering by bednumber
      // IPD-10: flag that the legacy (no-underscore) path is in use so
      // we can warn the admin in the UI. Without this, projects whose
      // schema migration hasn't been run silently route every read
      // through the legacy schema and accumulate tech debt.
      setSchemaFallbackHit(true)
      console.warn(
        '[IPD beds] beds.bed_number column not found — falling back to ' +
        'legacy bednumber column. Please run the latest schema migration ' +
        '(see migrations/017_comprehensive_schema_alignment.sql).',
      )
      const { data: oldData } = await supabase
        .from('beds')
        .select('*')
        .order('bednumber' as any)

      // Normalize old schema to new field names
      bedData = (oldData || []).map((b: any) => ({
        ...b,
        bed_number: b.bed_number || b.bednumber,
      }))
    } else {
      bedData = data
    }

    if (!bedData) { setLoading(false); return }

    // Get active admissions to find who's in each bed
    const { data: admissions } = await supabase
      .from('ipd_admissions')
      .select('id, bed_id, patient_id, patient_name, mrn')
      .eq('status', 'active')

    const admMap = new Map<string, any>()
    for (const adm of admissions || []) {
      if (adm.bed_id) admMap.set(adm.bed_id, adm)
    }

    setBeds(bedData.map(b => ({
      ...b,
      patient_name: admMap.get(b.id)?.patient_name,
      patient_mrn:  admMap.get(b.id)?.mrn,
    })))
    setLoading(false)
  }, [])

  useEffect(() => { loadBeds() }, [loadBeds])

  async function handleAction(bed: BedRecord, action: string) {
    if (action === 'reserve') {
      setReservingBed(bed)
      return
    }

    if (action === 'delete') {
      if (!isAdmin) { alert('Only admin can delete beds.'); return }
      if (bed.status === 'occupied') { alert('Cannot delete an occupied bed. Discharge the patient first.'); return }
      if (!confirm(`Are you sure you want to permanently remove Bed ${bed.bed_number}? This cannot be undone.`)) return
      await supabase.from('beds').delete().eq('id', bed.id)
      await loadBeds()
      return
    }

    const newStatus = action as BedStatus
    await supabase.from('beds').update({
      status:       newStatus,
      reservedfor:  null,
      reservednote: null,
      reservedat:   null,
      updated_at:   new Date().toISOString(),
    }).eq('id', bed.id)

    await loadBeds()
  }

  const filtered = beds.filter(b => {
    const matchSearch =
      !search ||
      b.bed_number.toLowerCase().includes(search.toLowerCase()) ||
      (b.ward || '').toLowerCase().includes(search.toLowerCase()) ||
      (b.patient_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (b.reservedfor || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || b.status === filterStatus
    return matchSearch && matchStatus
  })

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bed Management</h1>
            <p className="text-sm text-gray-500">
              {beds.length} total · {stats.available} available
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadBeds}
              className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200">
              <RefreshCw className="w-4 h-4 text-gray-600" />
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white
                           px-4 py-2 rounded-xl font-semibold text-sm"
              >
                <Plus className="w-4 h-4" /> Add Bed
              </button>
            )}
          </div>
        </div>

        {/* Stats bar — also filter buttons */}
        <div className="grid grid-cols-4 gap-3">
          {(Object.entries(stats) as [BedStatus, number][]).map(([status, count]) => {
            const s = STATUS_STYLES[status]
            const isActive = filterStatus === status
            return (
              <button
                key={status}
                onClick={() => setFilterStatus(isActive ? 'all' : status)}
                className={`rounded-xl p-3 text-center border-2 transition-all
                  ${isActive ? `${s.border} ${s.bg}` : 'border-gray-200 bg-white hover:border-gray-300'}`}
              >
                <div className={`text-2xl font-black ${s.text}`}>{count}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search bed number, ward, patient name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* IPD-10: visible warning when bed table read fell back to the
            legacy schema. Helps an admin notice that a pending migration
            should be applied. Discreet so it doesn't alarm regular staff. */}
        {schemaFallbackHit && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Database schema notice:</strong> the bed table is being
              read through a legacy compatibility path. Please run the latest
              schema migration (<code className="bg-amber-100 px-1 rounded">migrations/017_comprehensive_schema_alignment.sql</code>)
              when convenient. Functionality is unaffected; performance and
              future feature parity are not.
            </div>
          </div>
        )}

        {/* Bed grid */}
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Bed className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium">
              {beds.length === 0 ? 'No beds added yet — add your first bed!' : 'No beds match your search'}
            </p>
            {beds.length === 0 && (
              <button
                onClick={() => setShowAdd(true)}
                className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-xl font-semibold text-sm"
              >
                + Add First Bed
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(bed => (
              <BedCard key={bed.id} bed={bed} onAction={handleAction} />
            ))}
          </div>
        )}
      </div>

      {reservingBed && (
        <ReserveModal
          bed={reservingBed}
          onClose={() => setReservingBed(null)}
          onDone={() => { setReservingBed(null); loadBeds() }}
        />
      )}
      {showAdd && (
        <AddBedModal
          onClose={() => setShowAdd(false)}
          onDone={() => { setShowAdd(false); loadBeds() }}
        />
      )}
    </AppShell>
  )
}