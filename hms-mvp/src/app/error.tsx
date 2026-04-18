'use client'
import { useEffect } from 'react'
import { RefreshCw, Home } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to console for debugging during development
    console.error('App error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <span className="text-3xl">⚠️</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
        <p className="text-gray-500 mb-2">
          An unexpected error occurred. This has been logged.
        </p>
        {error?.message && (
          <p className="text-xs text-gray-400 font-mono bg-gray-100 rounded-lg px-3 py-2 mb-6 break-all">
            {error.message}
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <button onClick={reset}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
          <a href="/dashboard"
            className="inline-flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold px-5 py-2.5 rounded-lg border border-gray-200 transition-colors">
            <Home className="w-4 h-4" /> Dashboard
          </a>
        </div>
      </div>
    </div>
  )
}
