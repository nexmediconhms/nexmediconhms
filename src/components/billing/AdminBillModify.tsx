'use client'
/**
 * src/components/billing/AdminBillModify.tsx
 *
 * Admin-only billing modification panel.
 * Allows admin to modify/reduce billing amounts after generation.
 * Maintains audit trail of all modifications.
 *
 * Security:
 *  - Only admin role can access this
 *  - All modifications logged with reason
 *  - Original amounts preserved in audit log
 */

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import { useAuth } from '@/lib/auth'
import {
  Save, AlertTriangle, Lock, Edit3, History
} from 'lucide-react'
import { useToast } from '../shared/Toast'

interface AdminBillModifyProps {
  bill: {
    id: string
    patient_name: string
    mrn: string
    net_amount: number
    subtotal: number
    discount: number
    items: Array<{ label: string; amount: number }>
    status: string
    payment_mode: string | null
    created_at: string
  }
  onUpdated: () => void
}

export default function AdminBillModify({ bill, onUpdated }: AdminBillModifyProps) {
  const { isAdmin } = useAuth()
  const { showSuccess, showError, showWarning } = useToast()
  const [editing, setEditing] = useState(false)
  const [newAmount, setNewAmount] = useState(String(bill.net_amount))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  if (!isAdmin) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
        <Lock className="w-3 h-3" />
        Only admin can modify bills
      </div>
    )
  }

  const handleSave = async () => {
    const amount = parseFloat(newAmount)
    if (isNaN(amount) || amount < 0) {
      showError('Please enter a valid amount')
      return
    }
    if (!reason.trim()) {
      showError('Please provide a reason for modification')
      return
    }
    if (amount === bill.net_amount) {
      showWarning('Amount is the same — no change needed')
      return
    }

    setSaving(true)
    try {
      // Calculate new discount (original subtotal - new amount)
      const newDiscount = Math.max(0, bill.subtotal - amount)

      const { error } = await supabase
        .from('bills')
        .update({
          net_amount: amount,
          discount: newDiscount,
          notes: `[ADMIN MODIFIED] Previous: ₹${bill.net_amount}. Reason: ${reason.trim()}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bill.id)

      if (error) {
        showError('Failed to update: ' + error.message)
        setSaving(false)
        return
      }

      // Audit log
      await audit('update', 'bill', bill.id,
        `Bill amount modified by admin. Original: ₹${bill.net_amount} → New: ₹${amount}. Reason: ${reason.trim()}. Patient: ${bill.patient_name} (${bill.mrn})`)

      showSuccess(`Bill updated: ₹${bill.net_amount} → ₹${amount}`)
      setEditing(false)
      setReason('')
      onUpdated()
    } catch (err: any) {
      showError('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-700 font-medium
                   bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors"
      >
        <Edit3 className="w-3 h-3" />
        Modify Amount
      </button>
    )
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
        <AlertTriangle className="w-4 h-4" />
        Admin: Modify Bill Amount
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Current Amount</label>
          <div className="input bg-gray-100 text-gray-500 cursor-not-allowed">
            ₹{bill.net_amount.toLocaleString('en-IN')}
          </div>
        </div>
        <div>
          <label className="label">New Amount (₹)</label>
          <input
            type="number"
            className="input"
            value={newAmount}
            onChange={e => setNewAmount(e.target.value)}
            min="0"
            step="1"
          />
        </div>
      </div>

      <div>
        <label className="label">Reason for Modification *</label>
        <input
          className="input"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Discount applied, Insurance adjustment, Tax correction..."
        />
      </div>

      <div className="flex items-center justify-between pt-2">
        <p className="text-[10px] text-amber-700 flex items-center gap-1">
          <History className="w-3 h-3" />
          This change will be logged in the audit trail
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => { setEditing(false); setReason(''); setNewAmount(String(bill.net_amount)) }}
            className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !reason.trim()}
            className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {saving ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-3 h-3" />}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}