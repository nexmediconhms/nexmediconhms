'use client'
/**
 * src/components/billing/AdminBillModify.tsx
 *
 * Admin-only billing modification panel.
 * Allows admin to modify billing amounts even after payment — for tax corrections,
 * insurance adjustments, discounts, and audit compliance.
 *
 * FIX: Now works on PAID bills too (not just unpaid).
 * FIX: Added tax/GST field adjustment.
 * FIX: Enhanced audit trail with before/after amounts.
 * FIX: Shows modification history inline.
 *
 * Security:
 *  - Only admin role can access this
 *  - All modifications logged with reason + original amounts
 *  - Original amounts preserved in audit log & bill notes
 */

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import { useAuth } from '@/lib/auth'
import {
  Save, AlertTriangle, Lock, Edit3, History, ChevronDown, ChevronUp,
  Receipt, ShieldCheck, Info,
} from 'lucide-react'
import { useToast } from '../shared/Toast'

interface BillItem {
  label: string
  amount: number
}

interface AdminBillModifyProps {
  bill: {
    id: string
    patient_name: string
    mrn: string
    net_amount: number
    subtotal: number
    discount: number
    gst_amount?: number
    gst_percent?: number
    items: BillItem[]
    status: string
    payment_mode: string | null
    created_at: string
    notes?: string
  }
  onUpdated: () => void
}

export default function AdminBillModify({ bill, onUpdated }: AdminBillModifyProps) {
  const { isAdmin } = useAuth()
  const { showSuccess, showError, showWarning, ToastContainer } = useToast()
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<string[]>([])

  // Editable fields
  const [newDiscount, setNewDiscount] = useState(String(bill.discount || 0))
  const [newGst, setNewGst] = useState(String(bill.gst_percent || 0))
  const [reason, setReason] = useState('')
  const [modType, setModType] = useState<'discount' | 'tax' | 'amount'>('discount')
  const [newNetAmount, setNewNetAmount] = useState(String(bill.net_amount))
  const [saving, setSaving] = useState(false)

  // Parse modification history from notes
  useEffect(() => {
    if (bill.notes) {
      const lines = bill.notes.split('\n').filter(l => l.includes('[ADMIN MODIFIED]'))
      setHistory(lines)
    }
  }, [bill.notes])

  if (!isAdmin) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
        <Lock className="w-3 h-3" />
        Only admin can modify bills
      </div>
    )
  }

  // Computed preview
  const subtotal = bill.subtotal || bill.net_amount
  const previewDiscount = parseFloat(newDiscount) || 0
  const previewGstPct = parseFloat(newGst) || 0
  const baseAfterDiscount = Math.max(0, subtotal - previewDiscount)
  const previewGstAmt = Math.round(baseAfterDiscount * previewGstPct / 100)
  const previewNet = modType === 'amount'
    ? parseFloat(newNetAmount) || 0
    : baseAfterDiscount + previewGstAmt

  const handleSave = async () => {
    if (!reason.trim()) {
      showError('Please provide a reason for modification')
      return
    }

    let finalNet = 0
    let finalDiscount = bill.discount
    let finalGstPct = bill.gst_percent || 0
    let finalGstAmt = bill.gst_amount || 0

    if (modType === 'discount') {
      const d = parseFloat(newDiscount)
      if (isNaN(d) || d < 0) { showError('Invalid discount amount'); return }
      finalDiscount = d
      const base = Math.max(0, subtotal - d)
      const gstPct = bill.gst_percent || 0
      finalGstAmt = Math.round(base * gstPct / 100)
      finalNet = base + finalGstAmt
    } else if (modType === 'tax') {
      const gp = parseFloat(newGst)
      if (isNaN(gp) || gp < 0 || gp > 100) { showError('Invalid GST %'); return }
      finalGstPct = gp
      const base = Math.max(0, subtotal - (bill.discount || 0))
      finalGstAmt = Math.round(base * gp / 100)
      finalNet = base + finalGstAmt
    } else {
      // Direct amount override
      const amt = parseFloat(newNetAmount)
      if (isNaN(amt) || amt < 0) { showError('Invalid amount'); return }
      finalNet = amt
      finalDiscount = Math.max(0, subtotal - amt)
    }

    if (Math.abs(finalNet - bill.net_amount) < 0.01 && modType !== 'tax') {
      showWarning('Amount unchanged — no modification needed')
      return
    }

    setSaving(true)
    try {
      const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      const modNote = `[ADMIN MODIFIED] ${timestamp} | ${modType.toUpperCase()}: ₹${bill.net_amount} → ₹${finalNet.toFixed(2)} | Reason: ${reason.trim()}`
      const existingNotes = bill.notes ? bill.notes + '\n' : ''

      const updatePayload: Record<string, unknown> = {
        net_amount: Math.round(finalNet * 100) / 100,
        discount: finalDiscount,
        gst_percent: finalGstPct,
        gst_amount: finalGstAmt,
        notes: existingNotes + modNote,
        updated_at: new Date().toISOString(),
        // Keep status — do NOT reset a paid bill to unpaid
      }

      const { error } = await supabase
        .from('bills')
        .update(updatePayload)
        .eq('id', bill.id)

      if (error) {
        showError('Failed to update: ' + error.message)
        setSaving(false)
        return
      }

      // Full audit trail
      await audit(
        'update', 'bill', bill.id,
        `[ADMIN BILL MODIFY] Type: ${modType} | Before: ₹${bill.net_amount} → After: ₹${finalNet.toFixed(2)} | ` +
        `Discount: ₹${finalDiscount} | GST: ${finalGstPct}% (₹${finalGstAmt}) | ` +
        `Patient: ${bill.patient_name} (${bill.mrn}) | Status: ${bill.status} | Reason: ${reason.trim()}`
      )

      showSuccess(`Bill updated: ₹${bill.net_amount.toLocaleString('en-IN')} → ₹${finalNet.toLocaleString('en-IN')}`)
      setEditing(false)
      setReason('')
      onUpdated()
    } catch (err: any) {
      showError('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const isPaid = bill.status === 'paid'

  if (!editing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-700 font-medium
                       bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Edit3 className="w-3 h-3" />
            Modify Bill
          </button>
          {isPaid && (
            <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
              <ShieldCheck className="w-3 h-3" /> Paid — admin override
            </span>
          )}
          {history.length > 0 && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600"
            >
              <History className="w-3 h-3" />
              {history.length} modification{history.length > 1 ? 's' : ''}
              {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
        {showHistory && history.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-1">
            {history.map((h, i) => (
              <p key={i} className="text-[10px] text-gray-500 font-mono leading-relaxed">{h}</p>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-3 space-y-4 relative">
      <ToastContainer />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
          <AlertTriangle className="w-4 h-4" />
          Admin: Modify Bill
        </div>
        {isPaid && (
          <div className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
            <Info className="w-3 h-3" />
            Bill is PAID — modification allowed for tax/accounting
          </div>
        )}
      </div>

      {/* Bill summary */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-white rounded-lg p-2 text-center">
          <div className="text-gray-400">Subtotal</div>
          <div className="font-bold text-gray-700">₹{subtotal.toLocaleString('en-IN')}</div>
        </div>
        <div className="bg-white rounded-lg p-2 text-center">
          <div className="text-gray-400">Current Net</div>
          <div className="font-bold text-blue-700">₹{bill.net_amount.toLocaleString('en-IN')}</div>
        </div>
        <div className="bg-white rounded-lg p-2 text-center border-2 border-dashed border-amber-300">
          <div className="text-gray-400">Preview Net</div>
          <div className="font-bold text-amber-700">₹{Math.round(previewNet).toLocaleString('en-IN')}</div>
        </div>
      </div>

      {/* Modification type selector */}
      <div>
        <label className="label">What to adjust</label>
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: 'discount', label: 'Discount', icon: '💰' },
            { id: 'tax', label: 'Tax/GST %', icon: '🧾' },
            { id: 'amount', label: 'Net Amount', icon: '✏️' },
          ] as const).map(opt => (
            <button
              key={opt.id}
              onClick={() => setModType(opt.id)}
              className={`flex flex-col items-center gap-1 py-2 px-3 rounded-lg text-xs font-medium border-2 transition-colors ${
                modType === opt.id
                  ? 'border-amber-500 bg-amber-100 text-amber-800'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-amber-300'
              }`}
            >
              <span className="text-lg">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input fields based on type */}
      {modType === 'discount' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Current Discount (₹)</label>
            <div className="input bg-gray-100 text-gray-500 cursor-not-allowed text-sm">
              ₹{(bill.discount || 0).toLocaleString('en-IN')}
            </div>
          </div>
          <div>
            <label className="label">New Discount (₹)</label>
            <input
              type="number"
              className="input"
              value={newDiscount}
              onChange={e => setNewDiscount(e.target.value)}
              min="0"
              max={subtotal}
              step="1"
              placeholder="0"
            />
          </div>
        </div>
      )}

      {modType === 'tax' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Current GST %</label>
            <div className="input bg-gray-100 text-gray-500 cursor-not-allowed text-sm">
              {bill.gst_percent || 0}%
            </div>
          </div>
          <div>
            <label className="label">New GST %</label>
            <input
              type="number"
              className="input"
              value={newGst}
              onChange={e => setNewGst(e.target.value)}
              min="0"
              max="100"
              step="0.5"
              placeholder="0"
            />
          </div>
        </div>
      )}

      {modType === 'amount' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Current Net Amount</label>
            <div className="input bg-gray-100 text-gray-500 cursor-not-allowed text-sm">
              ₹{bill.net_amount.toLocaleString('en-IN')}
            </div>
          </div>
          <div>
            <label className="label">New Net Amount (₹)</label>
            <input
              type="number"
              className="input"
              value={newNetAmount}
              onChange={e => setNewNetAmount(e.target.value)}
              min="0"
              step="1"
            />
          </div>
        </div>
      )}

      {/* Reason */}
      <div>
        <label className="label">Reason for Modification *</label>
        <input
          className="input"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Tax correction, Insurance adjustment, Discount applied, Accounting entry..."
        />
      </div>

      {/* Info box */}
      <div className="flex items-start gap-2 text-[10px] text-amber-700 bg-amber-100 rounded-lg p-2">
        <History className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          All modifications are logged in the audit trail with original amounts, timestamps, and your reason.
          {isPaid && ' This bill is marked PAID — modifying will NOT change payment records, only accounting amounts.'}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={() => {
            setEditing(false)
            setReason('')
            setNewDiscount(String(bill.discount || 0))
            setNewGst(String(bill.gst_percent || 0))
            setNewNetAmount(String(bill.net_amount))
          }}
          className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !reason.trim()}
          className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs
                     font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving
            ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Save className="w-3 h-3" />}
          {saving ? 'Saving...' : 'Save Modification'}
        </button>
      </div>
    </div>
  )
}