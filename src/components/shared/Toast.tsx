'use client'
/**
 * src/components/shared/Toast.tsx
 *
 * Global Toast Notification System
 * 
 * Solves the problem of error/success messages requiring scroll to see.
 * Toasts appear as fixed-position overlays at the top-right of the viewport,
 * visible regardless of scroll position.
 *
 * Usage:
 *   import { useToast, ToastProvider } from '@/components/shared/Toast'
 *   const { showToast } = useToast()
 *   showToast('Please enter at least a chief complaint or diagnosis.', 'error')
 *   showToast('Bill saved successfully!', 'success')
 */

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react'
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: string
  message: string
  type: ToastType
  duration: number
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void
  showError: (message: string) => void
  showSuccess: (message: string) => void
  showWarning: (message: string) => void
  showInfo: (message: string) => void
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
  showError: () => {},
  showSuccess: () => {},
  showWarning: () => {},
  showInfo: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

const TOAST_CONFIG: Record<ToastType, { icon: any; bg: string; border: string; text: string; iconColor: string }> = {
  success: {
    icon: CheckCircle,
    bg: 'bg-green-50',
    border: 'border-green-300',
    text: 'text-green-800',
    iconColor: 'text-green-500',
  },
  error: {
    icon: AlertCircle,
    bg: 'bg-red-50',
    border: 'border-red-300',
    text: 'text-red-800',
    iconColor: 'text-red-500',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-800',
    iconColor: 'text-amber-500',
  },
  info: {
    icon: Info,
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    text: 'text-blue-800',
    iconColor: 'text-blue-500',
  },
}

function ToastItemCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const config = TOAST_CONFIG[toast.type]
  const Icon = config.icon

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, onDismiss])

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg ${config.bg} ${config.border} animate-slide-in-right max-w-sm w-full`}
      role="alert"
      aria-live="assertive"
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${config.iconColor}`} />
      <p className={`text-sm font-medium flex-1 ${config.text}`}>{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, type: ToastType = 'info', duration = 5000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setToasts(prev => {
      // Keep max 5 toasts visible
      const updated = [...prev, { id, message, type, duration }]
      return updated.slice(-5)
    })
  }, [])

  const showError = useCallback((message: string) => showToast(message, 'error', 6000), [showToast])
  const showSuccess = useCallback((message: string) => showToast(message, 'success', 4000), [showToast])
  const showWarning = useCallback((message: string) => showToast(message, 'warning', 5000), [showToast])
  const showInfo = useCallback((message: string) => showToast(message, 'info', 4000), [showToast])

  return (
    <ToastContext.Provider value={{ showToast, showError, showSuccess, showWarning, showInfo }}>
      {children}
      {/* Toast container — fixed position, always visible */}
      <div
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
        aria-label="Notifications"
      >
        {toasts.map(toast => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItemCard toast={toast} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
