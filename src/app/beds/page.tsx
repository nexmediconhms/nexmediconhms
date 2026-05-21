'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { escapeLike, formatDate, getIndiaToday } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import type { Bed } from '@/types'
import { BedDouble, Search, X, CheckCircle, User, Plus, Trash2, Settings } from 'lucide-react'

type BedStatus = Bed['status']

const STATUS_CONFIG: Record<BedStatus, { label: string; bg: string; border: string; text: string; dot: string }> = {
  available: { label: 'Available', bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-800', dot: 'bg-green-500' },
  occupied:  { label: 'Occupied',  bg: 'bg-red-50',   border: 'border-red-300',   text: 'text-red-800',   dot: 'bg-red-500'   },
  cleaning:  { label: 'Cleaning',  bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-800', dot: 'bg-yellow-500' },
  reserved:  { label: 'Reserved', bg: 'bg-blue-50',   border: 'border-blue-300',   text: 'text-blue-800',  dot: 'bg-blue-500'  },
}

export default function BedsPage() {
  const { user, can } = useAuth()
  const [beds, setBeds] = useState<Bed[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ bed: Bed; action: 'admit' | 'discharge' } | null>(null)

  // Admit form
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<any[]>([])
  const [selectedPatient, setSelectedPatient] = useState<any>(null)
  const [expectedDischarge, setExpectedDischarge] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  // Add Bed form (admin only)
  const [showAddBed, setShowAddBed] = useState(false)
  const [showManageBeds, setShowManageBeds] = useState(false)
  const [newBed, setNewBed] = useState({ bed_number: '', ward: 'General Ward', floor: '1', bed_type: 'General' })
  const [addBedLoading, setAddBedLoading] = useState(false)
  const [addBedError, setAddBedError] = useState('')
  const [bulkCount, setBulkCount] = useState(1)
  const [bulkPrefix, setBulkPrefix] = useState('')

  useEffect(() => {
    loadBeds()
    // Auto-refresh every 30s
    const interval = setInterval(loadBeds, 30000)
    return () => clearInterval(interval)
  }, [])

  async function loadBeds() {
    // Try with 'bed_number' first (new schema), fallback to handle schema cache error
    let { data, error: err } = await supabase.from('beds').select('*').order('bed_number')
    if (err && err.message.includes('schema cache')) {
      // Old schema has 'bednumber' instead of 'bed_number'
      const { data: oldData } = await supabase.from('beds').select('*')
      data = (oldData || []).map((b: any) => ({
        ...b,
        bed_number: b.bed_number || b.bednumber,
      }))
    }
    setBeds((data as Bed[]) || [])
    setLoading(false)
  }

  async function searchPatients(q: string) {
    setPatientSearch(q)
    setSelectedPatient(null)
    if (q.length < 2) { setPatientResults([]); return }
    const safe = escapeLike(q)
    const { data } = await supabase
      .from('patients').select('id, full_name, mrn, age, gender')
      .or(`full_name.ilike.%${safe}%,mrn.ilike.%${safe}%,mobile.ilike.%${safe}%`).limit(6)
    setPatientResults(data || [])
  }

  async function handleAdmit() {
    if (!modal || !selectedPatient) return
    setActionLoading(true)

    // Update bed status
    await supabase.from('beds').update({
      status: 'occupied',
      patient_id: selectedPatient.id,
      patient_name: selectedPatient.full_name,
      admission_date: getIndiaToday(),
      expected_discharge: expectedDischarge || null,
      updated_at: new Date().toISOString(),
    }).eq('id', modal.bed.id)

    // Also create an IPD admission record to keep things in sync
    await supabase.from('ipd_admissions').insert({
      patient_id: selectedPatient.id,
      patient_name: selectedPatient.full_name,
      mrn: selectedPatient.mrn || '',
      age: selectedPatient.age,
      gender: selectedPatient.gender,
      bed_id: modal.bed.id,
      bed_number: modal.bed.bed_number,
      ward: modal.bed.ward,
      admission_date: getIndiaToday(),
      admission_time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }),
      admitting_doctor: '',
      status: 'active',
    }).then(() => {}) // Non-blocking — IPD table may not exist in all setups

    setActionLoading(false)
    closeModal()
    loadBeds()
  }

  async function handleDischarge() {
    if (!modal) return
    setActionLoading(true)

    // Use the enhanced discharge API
    try {
      const res = await fetch('/api/ipd/discharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admission_id: null, // Will be looked up by bed
          discharge_date: getIndiaToday(),
          condition_at_discharge: 'Satisfactory',
          final_diagnosis: '',
          discharge_advice: '',
          discharged_by: '',
        }),
      })

      // If the API doesn't find an admission (e.g. direct bed admission without IPD record),
      // fall back to direct bed update
      if (!res.ok) {
        await supabase.from('beds').update({
          status: 'cleaning',
          patient_id: null,
          patient_name: null,
          admission_date: null,
          expected_discharge: null,
          updated_at: new Date().toISOString(),
        }).eq('id', modal.bed.id)

        // Also update ipd_admissions if exists
        if (modal.bed.patient_id) {
          await supabase.from('ipd_admissions')
            .update({ status: 'discharged', updated_at: new Date().toISOString() })
            .eq('bed_id', modal.bed.id)
            .eq('status', 'active')
        }

        // Auto-mark as available after short delay
        setTimeout(async () => {
          await supabase.from('beds').update({ status: 'available', updated_at: new Date().toISOString() })
            .eq('id', modal.bed.id).eq('status', 'cleaning')
          loadBeds()
        }, 3000)
      }
    } catch {
      // Fallback to direct update
      await supabase.from('beds').update({
        status: 'cleaning',
        patient_id: null,
        patient_name: null,
        admission_date: null,
        expected_discharge: null,
        updated_at: new Date().toISOString(),
      }).eq('id', modal.bed.id)
    }

    setActionLoading(false)
    closeModal()
    loadBeds()

    // Show success notification
    alert(`Patient discharged successfully from Bed ${modal.bed.bed_number}. Bed is now being cleaned.`)
  }

  async function toggleReserve(bed: Bed) {
    const newStatus: BedStatus = bed.status === 'reserved' ? 'available' : 'reserved'
    await supabase.from('beds').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', bed.id)
    loadBeds()
  }

  function closeModal() {
    setModal(null)
    setPatientSearch('')
    setPatientResults([])
    setSelectedPatient(null)
    setExpectedDischarge('')
  }

  function openBed(bed: Bed) {
    if (bed.status === 'available' || bed.status === 'reserved') setModal({ bed, action: 'admit' })
    else if (bed.status === 'occupied') setModal({ bed, action: 'discharge' })
  }

  // ── Admin: Add Bed(s) ─────────────────────────────────────
  async function handleAddBed() {
    setAddBedError('')
    if (bulkCount === 1) {
      if (!newBed.bed_number.trim()) { setAddBedError('Bed number is required'); return }
      // Check if bed number already exists
      const existing = beds.find(b => b.bed_number === newBed.bed_number.trim())
      if (existing) { setAddBedError(`Bed ${newBed.bed_number} already exists`); return }
    } else {
      if (!bulkPrefix.trim()) { setAddBedError('Prefix is required for bulk add'); return }
    }

    setAddBedLoading(true)
    try {
      const bedsToInsert = []
      if (bulkCount === 1) {
        bedsToInsert.push({
          bed_number: newBed.bed_number.trim(),
          ward: newBed.ward,
          floor: newBed.floor,
          bed_type: newBed.bed_type,
          status: 'available' as const,
        })
      } else {
        for (let i = 1; i <= bulkCount; i++) {
          bedsToInsert.push({
            bed_number: `${bulkPrefix.trim()}${i}`,
            ward: newBed.ward,
            floor: newBed.floor,
            bed_type: newBed.bed_type,
            status: 'available' as const,
          })
        }
      }

      const { error } = await supabase.from('beds').insert(bedsToInsert)
      if (error) {
        if (error.message.includes('duplicate') || error.message.includes('unique')) {
          setAddBedError('One or more bed numbers already exist. Use a different prefix.')
        } else {
          setAddBedError(`Failed to add bed(s): ${error.message}`)
        }
      } else {
        setShowAddBed(false)
        setNewBed({ bed_number: '', ward: 'General Ward', floor: '1', bed_type: 'General' })
        setBulkCount(1)
        setBulkPrefix('')
        setAddBedError('')
        loadBeds()
      }
    } catch (err: any) {
      setAddBedError(`Error: ${err.message}`)
    }
    setAddBedLoading(false)
  }

  // ── Admin: Delete Bed ─────────────────────────────────────
  async function handleDeleteBed(bedId: string, bedNumber: string) {
    if (!confirm(`Are you sure you want to delete bed ${bedNumber}? This action cannot be undone.`)) return
    const { error } = await supabase.from('beds').delete().eq('id', bedId)
    if (error) {
      alert(`Failed to delete bed: ${error.message}`)
    } else {
      loadBeds()
    }
  }

  // ── Group by ward ─────────────────────────────────────────
  const wards = Array.from(new Set(beds.map(b => b.ward)))
  const stats = {
    available: beds.filter(b => b.status === 'available').length,
    occupied:  beds.filter(b => b.status === 'occupied').length,
    cleaning:  beds.filter(b => b.status === 'cleaning').length,
    reserved:  beds.filter(b => b.status === 'reserved').length,
  }

  return (
    <AppShell>
      <div className="p-6">
        {/* Header — Add/Manage buttons always visible (auth checked on action) */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BedDouble className="w-6 h-6 text-blue-600" /> Bed Management
            </h1>
            <p className="text-sm text-gray-500">Click any bed to admit or discharge a patient. Refreshes every 30 seconds.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowManageBeds(!showManageBeds)}
              className="btn-secondary flex items-center gap-2 text-xs">
              <Settings className="w-3.5 h-3.5" /> Manage
            </button>
            <button onClick={() => setShowAddBed(true)}
              className="btn-primary flex items-center gap-2 text-xs">
              <Plus className="w-3.5 h-3.5" /> Add Bed
            </button>
          </div>
        </div>

        {/* Add Bed Modal (Admin) */}
        {showAddBed && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowAddBed(false) }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-blue-600" /> Add New Bed(s)
                </h3>
                <button onClick={() => { setShowAddBed(false); setAddBedError('') }} className="text-gray-400 hover:text-gray-700">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {addBedError && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                  {addBedError}
                </div>
              )}

              <div className="space-y-4">
                {/* Single or Bulk */}
                <div>
                  <label className="label">Number of Beds to Add</label>
                  <input type="number" min="1" max="50" className="input w-24"
                    value={bulkCount} onChange={e => setBulkCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))} />
                  <p className="text-xs text-gray-400 mt-1">Add up to 50 beds at once</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Bed Number / Prefix</label>
                    <input className="input" placeholder={bulkCount > 1 ? 'e.g. GW- (creates GW-1, GW-2...)' : 'e.g. GW-101'}
                      value={bulkCount > 1 ? bulkPrefix : newBed.bed_number}
                      onChange={e => bulkCount > 1 ? setBulkPrefix(e.target.value) : setNewBed(prev => ({ ...prev, bed_number: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Ward</label>
                    <select className="input" value={newBed.ward}
                      onChange={e => setNewBed(prev => ({ ...prev, ward: e.target.value }))}>
                      <option>General Ward</option>
                      <option>Private Ward</option>
                      <option>Semi-Private Ward</option>
                      <option>ICU</option>
                      <option>NICU</option>
                      <option>Labour Ward</option>
                      <option>Post-Op Ward</option>
                      <option>Pediatric Ward</option>
                      <option>Emergency Ward</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Floor</label>
                    <select className="input" value={newBed.floor}
                      onChange={e => setNewBed(prev => ({ ...prev, floor: e.target.value }))}>
                      <option value="G">Ground Floor</option>
                      <option value="1">1st Floor</option>
                      <option value="2">2nd Floor</option>
                      <option value="3">3rd Floor</option>
                      <option value="4">4th Floor</option>
                      <option value="5">5th Floor</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Bed Type</label>
                    <select className="input" value={newBed.bed_type}
                      onChange={e => setNewBed(prev => ({ ...prev, bed_type: e.target.value }))}>
                      <option>General</option>
                      <option>Semi-Private</option>
                      <option>Private</option>
                      <option>Deluxe</option>
                      <option>ICU</option>
                      <option>NICU</option>
                      <option>Ventilator</option>
                      <option>Cradle</option>
                    </select>
                  </div>
                </div>

                {bulkCount > 1 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                    <strong>Preview:</strong> Will create {bulkCount} beds: {bulkPrefix || 'BED-'}1, {bulkPrefix || 'BED-'}2, ... {bulkPrefix || 'BED-'}{bulkCount}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setShowAddBed(false); setAddBedError('') }} className="btn-secondary flex-1">Cancel</button>
                  <button onClick={handleAddBed} disabled={addBedLoading}
                    className="btn-primary flex-1 disabled:opacity-50">
                    {addBedLoading ? 'Adding...' : `Add ${bulkCount > 1 ? `${bulkCount} Beds` : 'Bed'}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Manage Beds Panel — Delete / Edit beds (always accessible) */}
        {showManageBeds && (
          <div className="mb-6 card p-4 border-2 border-orange-200 bg-orange-50/30">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Settings className="w-4 h-4 text-orange-600" /> Bed Administration
              </h3>
              <button onClick={() => setShowManageBeds(false)} className="text-xs text-gray-500 hover:text-gray-700">Close</button>
            </div>
            <p className="text-xs text-gray-500 mb-3">Click the ✕ button on any available/reserved bed below to delete it. Occupied beds cannot be deleted.</p>
            <div className="flex flex-wrap gap-2">
              {beds.filter(b => b.status !== 'occupied').map(bed => (
                <div key={bed.id} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
                  <span className="font-mono font-bold text-gray-700">{bed.bed_number}</span>
                  <span className="text-gray-400">({bed.ward})</span>
                  <button onClick={() => handleDeleteBed(bed.id, bed.bed_number)}
                    className="ml-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded p-0.5 transition-colors"
                    title={`Delete bed ${bed.bed_number}`}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {beds.filter(b => b.status !== 'occupied').length === 0 && (
                <p className="text-xs text-gray-400 italic">All beds are currently occupied. Discharge patients first to manage beds.</p>
              )}
            </div>
          </div>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {Object.entries(stats).map(([status, count]) => {
            const cfg = STATUS_CONFIG[status as BedStatus]
            return (
              <div key={status} className={`card p-4 flex items-center gap-4 ${cfg.bg} border ${cfg.border}`}>
                <div className={`w-3 h-3 rounded-full ${cfg.dot} flex-shrink-0`} />
                <div>
                  <div className={`text-2xl font-bold ${cfg.text}`}>{count}</div>
                  <div className="text-xs font-semibold text-gray-600">{cfg.label}</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mb-5 flex-wrap">
          {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
            <div key={s} className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </div>
          ))}
          <span className="text-xs text-gray-400 ml-2">· Click available bed to admit · Click occupied bed to discharge</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : beds.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-gray-300 bg-gray-50/50 rounded-2xl">
            <BedDouble className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-xl font-bold text-gray-700 mb-2">No Beds Configured</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
              Your hospital has no beds set up yet. Add beds to start managing IPD admissions, patient assignments, and bed occupancy tracking.
            </p>
            <button onClick={() => setShowAddBed(true)}
              className="btn-primary flex items-center gap-2 mx-auto text-base px-6 py-3">
              <Plus className="w-5 h-5" /> Add Your First Bed
            </button>
            <p className="text-xs text-gray-400 mt-3">
              You can add beds individually or in bulk (up to 50 at once).
            </p>
          </div>
        ) : (
          wards.map(ward => {
            const wardBeds = beds.filter(b => b.ward === ward)
            return (
              <div key={ward} className="mb-6">
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <BedDouble className="w-4 h-4 text-gray-400" /> {ward}
                  <span className="text-xs font-normal text-gray-400 normal-case tracking-normal">
                    ({wardBeds.filter(b => b.status === 'available').length} available of {wardBeds.length})
                  </span>
                </h2>
                <div className="grid grid-cols-5 gap-3">
                  {wardBeds.map(bed => {
                    const cfg = STATUS_CONFIG[bed.status]
                    return (
                      <button key={bed.id}
                        onClick={() => openBed(bed)}
                        className={`rounded-xl border-2 p-3 text-left transition-all hover:shadow-md hover:scale-105
                          ${cfg.bg} ${cfg.border} ${bed.status === 'cleaning' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-sm text-gray-800 font-mono">{bed.bed_number}</span>
                          <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot} ${bed.status === 'occupied' ? 'animate-pulse' : ''}`} />
                        </div>
                        {bed.status === 'occupied' && bed.patient_name ? (
                          <div>
                            <div className="text-xs font-semibold text-gray-800 truncate">{bed.patient_name}</div>
                            {bed.admission_date && (
                              <div className="text-xs text-gray-500">Since {formatDate(bed.admission_date)}</div>
                            )}
                            {bed.expected_discharge && (
                              <div className="text-xs text-blue-600">DC: {formatDate(bed.expected_discharge)}</div>
                            )}
                            <Link href={`/ipd/${bed.id}`}
                              onClick={e=>e.stopPropagation()}
                              className="text-xs text-purple-600 hover:underline mt-0.5 block">
                              📋 Nursing Chart
                            </Link>
                          </div>
                        ) : (
                          <div>
                            <div className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</div>
                            {/* Reserve / Unreserve buttons */}
                            {(bed.status === 'available' || bed.status === 'reserved') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleReserve(bed) }}
                                className={`mt-1.5 text-xs px-2 py-1 rounded-md font-medium transition-colors ${
                                  bed.status === 'reserved'
                                    ? 'bg-green-100 text-green-700 hover:bg-green-200 border border-green-200'
                                    : 'bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-200'
                                }`}>
                                {bed.status === 'reserved' ? '✓ Unreserve' : '⊕ Reserve'}
                              </button>
                            )}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* ── Modal ─────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                {modal.action === 'admit' ? `Admit Patient — Bed ${modal.bed.bed_number}` : `Discharge — Bed ${modal.bed.bed_number}`}
              </h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modal.action === 'admit' ? (
              <div className="space-y-4">
                {/* Patient search */}
                {!selectedPatient ? (
                  <div>
                    <label className="label">Search Patient</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input className="input pl-9" placeholder="Name, MRN, or mobile..."
                        value={patientSearch} onChange={e => searchPatients(e.target.value)} autoFocus />
                    </div>
                    {patientResults.length > 0 && (
                      <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden">
                        {patientResults.map(p => (
                          <button key={p.id} type="button"
                            onClick={() => { setSelectedPatient(p); setPatientResults([]) }}
                            className="w-full text-left px-3 py-2.5 hover:bg-blue-50 flex items-center gap-3 border-b border-gray-50 last:border-0">
                            <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center text-xs font-bold text-blue-700 flex-shrink-0">
                              {p.full_name.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-gray-800">{p.full_name}</div>
                              <div className="text-xs text-gray-400">{p.mrn} · {p.age}y · {p.gender}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="font-semibold text-sm text-gray-900">{selectedPatient.full_name}</div>
                      <div className="text-xs text-gray-500">{selectedPatient.mrn} · {selectedPatient.age}y</div>
                    </div>
                    <button onClick={() => setSelectedPatient(null)} className="text-gray-400 hover:text-red-500">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div>
                  <label className="label">Expected Discharge Date (optional)</label>
                  <input className="input" type="date" min={getIndiaToday()}
                    value={expectedDischarge} onChange={e => setExpectedDischarge(e.target.value)} />
                </div>

                <div className="flex gap-3">
                  <button onClick={closeModal} className="btn-secondary flex-1">Cancel</button>
                  <button onClick={handleAdmit} disabled={!selectedPatient || actionLoading}
                    className="btn-primary flex-1 disabled:opacity-50">
                    {actionLoading ? 'Admitting...' : 'Confirm Admission'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="bg-red-50 border border-red-100 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-red-600" />
                    <div>
                      <div className="font-semibold text-gray-900">{modal.bed.patient_name}</div>
                      <div className="text-xs text-gray-500">
                        Admitted: {modal.bed.admission_date ? formatDate(modal.bed.admission_date) : '—'}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  This will discharge the patient and mark the bed for cleaning. The bed will be available again shortly.
                </p>
                <div className="flex gap-3">
                  <button onClick={closeModal} className="btn-secondary flex-1">Cancel</button>
                  <button onClick={handleDischarge} disabled={actionLoading}
                    className="btn-danger flex-1 disabled:opacity-50">
                    {actionLoading ? 'Processing...' : 'Confirm Discharge'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  )
}