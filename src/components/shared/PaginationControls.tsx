/**
 * src/components/shared/PaginationControls.tsx
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * ────────
 * Reusable pagination UI component for any list page.
 * 
 * THE BUG (Bug #14 — Monolithic Components):
 * ──────────────────────────────────────────
 * Pages like OPD, Patients, and /opd/new are 500-1700 lines of code
 * in a SINGLE file. This makes them hard to:
 *   - Read and understand
 *   - Test individual pieces
 *   - Reuse shared patterns (like pagination, search bars)
 *   - Debug when something breaks
 * 
 * This file is the FIRST step toward decomposition: extracting shared
 * UI patterns into reusable components.
 * 
 * WHERE IT'S USED:
 * ────────────────
 * - src/app/patients/page.tsx (patient list pagination)
 * - Can be reused in: appointments, billing, lab reports, etc.
 * 
 * DOES IT BREAK ANYTHING?
 * ───────────────────────
 * No. This is a NEW component. Existing pages can adopt it gradually.
 */

'use client'

interface PaginationProps {
  /** Current page (0-indexed) */
  page: number
  /** Items per page */
  pageSize: number
  /** Total count of all matching records */
  totalCount: number
  /** Whether the parent is currently loading data */
  loading?: boolean
  /** Called when user clicks Previous or Next */
  onPageChange: (newPage: number) => void
}

/**
 * Simple Previous / Page X of Y / Next pagination controls.
 * 
 * Usage:
 * ```tsx
 * <PaginationControls
 *   page={page}
 *   pageSize={50}
 *   totalCount={totalCount}
 *   loading={loading}
 *   onPageChange={(newPage) => loadData(newPage)}
 * />
 * ```
 */
export default function PaginationControls({
  page,
  pageSize,
  totalCount,
  loading = false,
  onPageChange,
}: PaginationProps) {
  const totalPages = Math.ceil(totalCount / pageSize)
  const showingFrom = page * pageSize + 1
  const showingTo = Math.min((page + 1) * pageSize, totalCount)

  // Don't render if all items fit on one page
  if (totalCount <= pageSize) return null

  return (
    <div className="flex items-center justify-between mt-4 px-2">
      <p className="text-xs text-gray-500">
        Showing {showingFrom.toLocaleString('en-IN')}–{showingTo.toLocaleString('en-IN')} of{' '}
        {totalCount.toLocaleString('en-IN')}
      </p>
      <div className="flex gap-2 items-center">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0 || loading}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Previous
        </button>
        <span className="px-3 py-1.5 text-xs text-gray-500 tabular-nums">
          Page {page + 1} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page + 1 >= totalPages || loading}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  )
}
