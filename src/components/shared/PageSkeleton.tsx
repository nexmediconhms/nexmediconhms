'use client'
/**
 * PageSkeleton — Consistent loading skeleton for pages.
 *
 * Shows a shimmer animation that matches the typical page layout,
 * reducing perceived load time and preventing layout shift.
 *
 * Variants:
 *   - 'list': Table/list view (patients, appointments, bills)
 *   - 'form': Form page (new patient, new consultation)
 *   - 'detail': Detail page (patient profile, encounter detail)
 *   - 'dashboard': Dashboard with cards
 */

interface Props {
  variant?: 'list' | 'form' | 'detail' | 'dashboard'
  rows?: number
}

function Shimmer({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-gray-200 rounded-lg animate-pulse ${className}`} />
  )
}

export default function PageSkeleton({ variant = 'list', rows = 5 }: Props) {
  if (variant === 'dashboard') {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <Shimmer className="h-8 w-48" />
          <Shimmer className="h-10 w-32" />
        </div>
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5">
              <Shimmer className="h-4 w-24 mb-3" />
              <Shimmer className="h-8 w-32 mb-2" />
              <Shimmer className="h-3 w-20" />
            </div>
          ))}
        </div>
        {/* Charts area */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <Shimmer className="h-5 w-40 mb-4" />
            <Shimmer className="h-48 w-full" />
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <Shimmer className="h-5 w-40 mb-4" />
            <Shimmer className="h-48 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'form') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Shimmer className="h-10 w-10 rounded-xl" />
          <div className="flex-1">
            <Shimmer className="h-6 w-56 mb-2" />
            <Shimmer className="h-4 w-40" />
          </div>
          <Shimmer className="h-10 w-32" />
        </div>
        {/* Form sections */}
        {[1, 2].map(section => (
          <div key={section} className="bg-white rounded-2xl border border-gray-100 p-6 mb-5">
            <Shimmer className="h-5 w-40 mb-5" />
            <div className="grid grid-cols-2 gap-5">
              {[1, 2, 3, 4].map(field => (
                <div key={field}>
                  <Shimmer className="h-4 w-24 mb-2" />
                  <Shimmer className="h-11 w-full rounded-xl" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'detail') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Shimmer className="h-5 w-5" />
          <div className="flex-1">
            <Shimmer className="h-6 w-64 mb-2" />
            <Shimmer className="h-4 w-40" />
          </div>
          <div className="flex gap-2">
            <Shimmer className="h-8 w-20 rounded-lg" />
            <Shimmer className="h-8 w-28 rounded-lg" />
          </div>
        </div>
        {/* Content cards */}
        {[1, 2, 3].map(card => (
          <div key={card} className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
            <Shimmer className="h-5 w-32 mb-4" />
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map(item => (
                <div key={item} className="bg-gray-50 rounded-lg p-3">
                  <Shimmer className="h-3 w-16 mb-2" />
                  <Shimmer className="h-5 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Default: list variant
  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Shimmer className="h-7 w-48 mb-2" />
          <Shimmer className="h-4 w-32" />
        </div>
        <div className="flex gap-2">
          <Shimmer className="h-10 w-28 rounded-lg" />
          <Shimmer className="h-10 w-36 rounded-lg" />
        </div>
      </div>
      {/* Search bar */}
      <Shimmer className="h-11 w-full rounded-xl mb-4" />
      {/* List items */}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-4">
            <Shimmer className="h-10 w-10 rounded-full" />
            <div className="flex-1">
              <Shimmer className="h-4 w-48 mb-2" />
              <Shimmer className="h-3 w-32" />
            </div>
            <Shimmer className="h-6 w-20 rounded-full" />
            <Shimmer className="h-8 w-8 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}
