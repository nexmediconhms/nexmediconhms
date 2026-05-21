/**
 * FILE: src/components/billing/BillVersionHistory.tsx
 *
 * ISSUE #10 FIX: Bill Version History UI
 *
 * Displays the immutable audit trail of all modifications made to a bill.
 * Shows old vs new amounts, who modified, when, and why.
 * Allows admin to click any version to see the full snapshot.
 *
 * HOW TO USE:
 *   In the bill detail page or AdminBillModify, add:
 *
 *   import BillVersionHistory from '@/components/billing/BillVersionHistory'
 *
 *   <BillVersionHistory billId={bill.id} />
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - Does not modify any existing components
 *   - Does not change the bills table
 *   - Read-only component — only calls SELECT, never modifies data
 */

'use client'

import { useState, useEffect } from 'react'
import { getBillVersionHistory, type BillVersion } from '@/lib/bill-versioning-enhanced'
import {
  History, ChevronDown, ChevronUp, Eye,
  IndianRupee, ArrowRight, Clock, User,
  AlertCircle,
} from 'lucide-react'

interface BillVersionHistoryProps {
  billId: string
}

export default function BillVersionHistory({ billId }: BillVersionHistoryProps) {
  const [versions, setVersions] = useState<BillVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [selectedSnapshot, setSelectedSnapshot] = useState<Record<string, any> | null>(null)

  useEffect(() => {
    loadVersions()
  }, [billId])

  async function loadVersions() {
    setLoading(true)
    const data = await getBillVersionHistory(billId)
    setVersions(data)
    setLoading(false)
  }

  if (loading) return null
  if (versions.length === 0) return null // No modification history — don't show

  return (
    <div className="mt-4 border border-amber-200 bg-amber-50/50 rounded-xl overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-100/50 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-bold text-amber-800">
          <History className="w-4 h-4" />
          Modification History
          <span className="bg-amber-200 text-amber-700 text-xs px-2 py-0.5 rounded-full">
            {versions.length} version{versions.length > 1 ? 's' : ''}
          </span>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-amber-600" />
          : <ChevronDown className="w-4 h-4 text-amber-600" />
        }
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-amber-700">
            Every bill modification is permanently recorded for audit compliance.
            Versions cannot be edited or deleted.
          </p>

          {/* Version timeline */}
          {versions.map((v, i) => (
            <div
              key={v.id}
              className="bg-white border border-amber-200 rounded-lg p-3 relative"
            >
              {/* Timeline dot */}
              {i < versions.length - 1 && (
                <div className="absolute left-6 top-full w-0.5 h-3 bg-amber-200" />
              )}

              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Version badge + type */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-mono font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
                      v{v.version_number}
                    </span>
                    <span className="text-xs font-semibold text-gray-600 capitalize">
                      {v.modification_type}
                    </span>
                    {i === 0 && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">
                        LATEST
                      </span>
                    )}
                  </div>

                  {/* Amount change */}
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <span className="font-mono text-gray-500">
                      <IndianRupee className="w-3 h-3 inline" />
                      {Number(v.previous_amount || 0).toLocaleString('en-IN')}
                    </span>
                    <ArrowRight className="w-3 h-3 text-gray-400" />
                    <span className="font-mono font-bold text-gray-900">
                      <IndianRupee className="w-3 h-3 inline" />
                      {Number(v.new_amount || 0).toLocaleString('en-IN')}
                    </span>
                    {v.previous_amount !== v.new_amount && (
                      <span className={`text-xs font-bold ${
                        v.new_amount > v.previous_amount ? 'text-red-500' : 'text-green-600'
                      }`}>
                        {v.new_amount > v.previous_amount ? '+' : ''}
                        {((v.new_amount - v.previous_amount) / (v.previous_amount || 1) * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>

                  {/* Reason */}
                  <div className="flex items-start gap-1.5 text-xs text-gray-500 mb-1">
                    <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>{v.reason}</span>
                  </div>

                  {/* Modifier + timestamp */}
                  <div className="flex items-center gap-3 text-[11px] text-gray-400">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {v.modified_by}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(v.created_at).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>

                {/* View snapshot button */}
                <button
                  onClick={() => setSelectedSnapshot(
                    selectedSnapshot?.id === v.id ? null : { ...v.snapshot, id: v.id }
                  )}
                  className="flex-shrink-0 p-2 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors"
                  title="View bill snapshot at this version"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>

              {/* Expanded snapshot */}
              {selectedSnapshot?.id === v.id && (
                <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Bill Snapshot at v{v.version_number}
                  </div>
                  <pre className="text-xs text-gray-600 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                    {JSON.stringify(v.snapshot, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}