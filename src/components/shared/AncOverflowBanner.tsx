'use client'
/**
 * src/components/shared/AncOverflowBanner.tsx
 *
 * ═══════════════════════════════════════════════════════════════
 * CRITICAL BUG FIX: ANC_MAX_ROWS = 2000 hard cap with NO UI feedback.
 *
 * PROBLEM:
 *   The ANC page caps at 2000 rows. The code comment says:
 *   "Older encounters beyond this cap will simply not appear
 *    (admin can extend if needed)."
 *
 *   There is ZERO indication in the UI. A clinic running for 2+
 *   years with 50+ ANC visits/day can silently have patients
 *   invisible in the ANC registry — a clinical safety issue.
 *
 * FIX:
 *   This banner is shown on the ANC page when the total count
 *   of ANC-eligible encounters in the lookback period is >= the
 *   cap. It clearly warns staff that some patients may not be
 *   visible and suggests filtering by date or contacting admin.
 *
 * USAGE (in src/app/anc/page.tsx):
 *
 *   import AncOverflowBanner from '@/components/shared/AncOverflowBanner'
 *
 *   // Props: pass the actual fetched count and the cap constant
 *   <AncOverflowBanner fetchedCount={ancRecords.length} cap={ANC_MAX_ROWS} />
 * ═══════════════════════════════════════════════════════════════
 */

import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'

interface Props {
  fetchedCount: number
  cap:          number      // ANC_MAX_ROWS (2000 by default)
  lookbackMonths?: number   // ANC_LOOKBACK_MONTHS (18 by default)
}

export default function AncOverflowBanner({ fetchedCount, cap, lookbackMonths = 18 }: Props) {
  const [dismissed, setDismissed] = useState(false)

  // Only show if we hit the cap (fetched === cap means we were likely cut off)
  if (fetchedCount < cap || dismissed) return null

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
      <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-red-900">
          ⚠️ ANC Registry may be incomplete — record limit reached
        </p>
        <p className="text-xs text-red-700 mt-1 leading-relaxed">
          The system fetched the maximum of <strong>{cap.toLocaleString()}</strong> ANC records
          from the last {lookbackMonths} months. <strong>Some patients may not be visible</strong>{' '}
          in this list. Use the search or date filter to find specific patients, or contact your
          system administrator to adjust the record limit.
        </p>
        <p className="text-xs text-red-600 mt-1 font-medium">
          📋 Do not rely solely on this list for high-risk ANC follow-up. Cross-check with
          appointment records.
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-red-400 hover:text-red-600 flex-shrink-0"
        title="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}