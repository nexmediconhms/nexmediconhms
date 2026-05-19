'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Bed, User, Lock, Wrench, CheckCircle, AlertCircle } from 'lucide-react'

type BedStatus = 'available' | 'occupied' | 'reserved' | 'maintenance'

interface BedRecord {
  id: string
  bed_number: string
  ward: string | null
  type: string
  status: BedStatus
  reservedfor: string | null
  reservednote: string | null
}

const STATUS_CONFIG = {
  available:   { label: 'Available',   color: 'bg-green-100 text-green-700 border-green-200',  icon: CheckCircle, dot: 'bg-green-500' },
  occupied:    { label: 'Occupied',    color: 'bg-red-100 text-red-700 border-red-200',         icon: User,        dot: 'bg-red-500'   },
  reserved:    { label: 'Reserved',    color: 'bg-amber-100 text-amber-700 border-amber-200',   icon: Lock,        dot: 'bg-amber-500' },
  maintenance: { label: 'Maintenance', color: 'bg-gray-100 text-gray-600 border-gray-200',      icon: Wrench,      dot: 'bg-gray-400'  },
}

export default function BedCard({ bed, onUpdate }: { bed: BedRecord; onUpdate: () => void }) {
  const [loading, setLoading] = useState(false)
  const [showReserveModal, setShowReserveModal] = useState(false)
  const [reserveName, setReserveName]   = useState('')
  const [reserveNote, setReserveNote]   = useState('')

  const cfg = STATUS_CONFIG[bed.status]
  const Icon = cfg.icon

  async function updateStatus(newStatus: BedStatus, extra?: Record<string, any>) {
    setLoading(true)
    await supabase.from('beds').update({
      status: newStatus,
      reservedfor: extra?.reservedfor ?? null,
      reservednote: extra?.reservednote ?? null,
      reservedat: newStatus === 'reserved' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', bed.id)
    setLoading(false)
    onUpdate()
  }

  return (
    <div className={`border rounded-xl p-4 space-y-3 ${cfg.color}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
          <div>
            <div className="font-bold text-base">Bed {bed.bed_number}</div>
            <div className="text-xs opacity-70">{bed.ward || 'General'} · {bed.type}</div>
          </div>
        </div>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/60">
          {cfg.label}
        </span>
      </div>

      {bed.status === 'reserved' && bed.reservedfor && (
        <div className="text-xs bg-white/50 rounded-lg p-2">
          Reserved for: <strong>{bed.reservedfor}</strong>
          {bed.reservednote && <div className="opacity-70 mt-0.5">{bed.reservednote}</div>}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-1">
        {bed.status === 'available' && (
          <>
            <button onClick={() => setShowReserveModal(true)} disabled={loading}
              className="text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg font-medium disabled:opacity-50">
              🔒 Reserve
            </button>
            <button onClick={() => updateStatus('maintenance')} disabled={loading}
              className="text-xs px-3 py-1.5 bg-gray-500 text-white rounded-lg font-medium disabled:opacity-50">
              🔧 Maintenance
            </button>
          </>
        )}
        {bed.status === 'reserved' && (
          <>
            <button onClick={() => updateStatus('available')} disabled={loading}
              className="text-xs px-3 py-1.5 bg-green-500 text-white rounded-lg font-medium disabled:opacity-50">
              ✅ Unreserve
            </button>
            <button onClick={() => updateStatus('maintenance')} disabled={loading}
              className="text-xs px-3 py-1.5 bg-gray-500 text-white rounded-lg font-medium disabled:opacity-50">
              🔧 Maintenance
            </button>
          </>
        )}
        {bed.status === 'maintenance' && (
          <button onClick={() => updateStatus('available')} disabled={loading}
            className="text-xs px-3 py-1.5 bg-green-500 text-white rounded-lg font-medium disabled:opacity-50">
            ✅ Mark Available
          </button>
        )}
        {/* Occupied beds: discharge button is in the IPD admission detail, not here */}
        {bed.status === 'occupied' && (
          <span className="text-xs text-red-700 opacity-70">Discharge patient to free this bed</span>
        )}
      </div>

      {/* Reserve Modal */}
      {showReserveModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl space-y-3">
            <div className="font-bold text-gray-900">Reserve Bed {bed.bed_number}</div>
            <input className="input w-full" placeholder="Patient / Person name (required)"
              value={reserveName} onChange={e => setReserveName(e.target.value)} />
            <textarea className="input w-full resize-none" rows={2}
              placeholder="Note (optional — e.g. 'Expected tomorrow 10 AM')"
              value={reserveNote} onChange={e => setReserveNote(e.target.value)} />
            <div className="flex gap-2">
              <button disabled={!reserveName.trim() || loading}
                onClick={async () => {
                  await updateStatus('reserved', { reservedfor: reserveName.trim(), reservednote: reserveNote.trim() || null })
                  setShowReserveModal(false)
                }}
                className="flex-1 bg-amber-500 text-white py-2 rounded-lg font-semibold text-sm disabled:opacity-50">
                Confirm Reserve
              </button>
              <button onClick={() => setShowReserveModal(false)}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg font-semibold text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}