'use client'

/**
 * src/components/billing/OutstandingBadge.tsx
 *
 * Small badge showing a patient's outstanding financial balance.
 * Can be placed on patient profile cards, list items, or headers.
 *
 * Usage:
 *   <OutstandingBadge patientId="uuid" />
 *   <OutstandingBadge patientId="uuid" size="sm" />
 *
 * Behavior:
 *   - Shows nothing if outstanding is 0
 *   - Shows red badge with ₹ amount if outstanding > 0
 *   - Shows green "Cleared" if explicitly requested via showZero prop
 *   - Loads asynchronously, shows skeleton while loading
 *
 * ─── ADDITIVE ────────────────────────────────────────────────────────
 * New component. Drop-in anywhere that shows patient information.
 * ─────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react'
import { IndianRupee, CheckCircle } from 'lucide-react'

interface OutstandingBadgeProps {
  patientId: string
  /** 'sm' = inline badge, 'md' = slightly bigger */
  size?: 'sm' | 'md'
  /** If true, show "Cleared" when outstanding is 0 */
  showZero?: boolean
  /** Additional CSS classes */
  className?: string
}

export default function OutstandingBadge({
  patientId,
  size = 'sm',
  showZero = false,
  className = '',
}: OutstandingBadgeProps) {
  const [outstanding, setOutstanding] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!patientId) return

    let cancelled = false

    async function load() {
      try {
        const res = await fetch(`/api/billing/patient-ledger?patientId=${patientId}`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          setOutstanding(data.summary?.currentOutstanding ?? 0)
        }
      } catch { /* non-fatal */ }
      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [patientId])

  if (loading) {
    return (
      <span className={`inline-block w-12 h-4 bg-gray-100 rounded animate-pulse ${className}`} />
    )
  }

  if (outstanding === null) return null

  if (outstanding <= 0) {
    if (!showZero) return null
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 text-green-700 ${
        size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1'
      } ${className}`}>
        <CheckCircle className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        Cleared
      </span>
    )
  }

  const formatted = `₹${outstanding.toLocaleString('en-IN')}`

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 text-red-700 font-semibold ${
      size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1'
    } ${className}`}>
      <IndianRupee className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {formatted} due
    </span>
  )
}