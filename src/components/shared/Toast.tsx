'use client'
/**
 * src/components/shared/Toast.tsx
 *
 * Global sticky toast notification component for inline error/success messages.
 * Renders at the BOTTOM of the viewport, always visible without scrolling.
 *
 * Usage:
 *   <Toast message={error} type="error" onDismiss={() => setError('')} />
 *   <Toast message={success} type="success" onDismiss={() => setSuccess('')} />
 *
 * Hook usage:
 *   const { showSuccess, showError, showWarning, ToastContainer } = useToast()
 *   // Call showSuccess('Done!') etc. and render <ToastContainer /> in your JSX
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, X, Info } from 'lucide-react'

type ToastType = 'error' | 'success' | 'warning' | 'info'

interface ToastProps {
  message: string
  type?: ToastType
  onDismiss?: () => void
  duration?: number // auto-dismiss in ms (0 = no auto-dismiss)
}

const CONFIG: Record<ToastType, { icon: any; bg: string; border: string; text: string }> = {
  error:   { icon: AlertCircle, bg: 'bg-red-50',    border: 'border-red-300',    text: 'text-red-800' },
  success: { icon: CheckCircle, bg: 'bg-green-50',  border: 'border-green-300',  text: 'text-green-800' },
  warning: { icon: AlertCircle, bg: 'bg-amber-50',  border: 'border-amber-300',  text: 'text-amber-800' },
  info:    { icon: Info,        bg: 'bg-blue-50',   border: 'border-blue-300',   text: 'text-blue-800' },
}

export default function Toast({ message, type = 'error', onDismiss, duration = 0 }: ToastProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (message) {
      setVisible(true)
      if (duration > 0) {
        const timer = setTimeout(() => {
          setVisible(false)
          setTimeout(() => onDismiss?.(), 300) // Wait for exit animation
        }, duration)
        return () => clearTimeout(timer)
      }
    } else {
      setVisible(false)
    }
  }, [message, duration, onDismiss])

  if (!message) return null

  const { icon: Icon, bg, border, text } = CONFIG[type]

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-lg
        transition-all duration-300 ease-out
        ${visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'}
      `}
    >
      <div className={`${bg} ${border} ${text} border-2 rounded-xl px-4 py-3 shadow-2xl flex items-start gap-3`}>
        <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <p className="text-sm font-medium flex-1">{message}</p>
        {onDismiss && (
          <button
            onClick={() => { setVisible(false); setTimeout(() => onDismiss(), 300) }}
            className="flex-shrink-0 p-0.5 rounded-lg hover:bg-black/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * useToast hook — imperative toast notifications.
 * Returns show functions and a ToastContainer to render in your component.
 *
 * Usage:
 *   const { showSuccess, showError, showWarning, ToastContainer } = useToast()
 *   showError('Something went wrong')
 *   // In JSX: <ToastContainer />
 */
export function useToast() {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  const dismiss = useCallback(() => setToast(null), [])

  const showSuccess = useCallback((message: string) => {
    setToast({ message, type: 'success' })
  }, [])

  const showError = useCallback((message: string) => {
    setToast({ message, type: 'error' })
  }, [])

  const showWarning = useCallback((message: string) => {
    setToast({ message, type: 'warning' })
  }, [])

  const showInfo = useCallback((message: string) => {
    setToast({ message, type: 'info' })
  }, [])

  const ToastContainer = useCallback(() => {
    if (!toast) return null
    return <Toast message={toast.message} type={toast.type} onDismiss={dismiss} duration={4000} />
  }, [toast, dismiss])

  return { showSuccess, showError, showWarning, showInfo, ToastContainer }
}