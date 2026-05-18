'use client'
/**
 * AutoSaveIndicator — Small, unobtrusive UI showing auto-save status.
 *
 * Renders as a tiny pill (or nothing when idle) so it doesn't clutter the page.
 * Drop this next to page headers or save buttons.
 */

import { CheckCircle, Loader2, AlertCircle, Cloud } from 'lucide-react'
import type { AutoSaveStatus } from '@/lib/useAutoSave'

interface Props {
  status: AutoSaveStatus
  lastSavedAt?: string | null
  errorMessage?: string | null
  className?: string
}

export default function AutoSaveIndicator({ status, lastSavedAt, errorMessage, className = '' }: Props) {
  if (status === 'idle' && !lastSavedAt) return null

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    } catch { return '' }
  }

  return (
    <div className={`flex items-center gap-1.5 text-xs transition-all duration-300 ${className}`}>
      {status === 'saving' && (
        <>
          <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
          <span className="text-blue-600 font-medium">Saving…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <CheckCircle className="w-3 h-3 text-green-500" />
          <span className="text-green-600 font-medium">Auto-saved</span>
          {lastSavedAt && (
            <span className="text-gray-400 ml-0.5">at {formatTime(lastSavedAt)}</span>
          )}
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="w-3 h-3 text-red-500" />
          <span className="text-red-600 font-medium">{errorMessage || 'Save failed'}</span>
        </>
      )}
      {status === 'idle' && lastSavedAt && (
        <>
          <Cloud className="w-3 h-3 text-gray-400" />
          <span className="text-gray-400">Saved at {formatTime(lastSavedAt)}</span>
        </>
      )}
    </div>
  )
}