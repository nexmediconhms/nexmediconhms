'use client'
/**
 * src/components/shared/GlobalToastProvider.tsx
 *
 * Global toast notification provider that enables any component in the app
 * to show floating error/success/warning messages WITHOUT scrolling.
 *
 * Usage:
 *   1. Wrap your layout with <GlobalToastProvider>
 *   2. In any child component:
 *      import { useGlobalToast } from '@/components/shared/GlobalToastProvider'
 *      const { showError, showSuccess, showWarning, showInfo } = useGlobalToast()
 *      showError('Something went wrong')
 *
 * Messages appear as a fixed-position stack at the bottom-center of the viewport.
 * Auto-dismiss after duration (default 5s for success, 8s for errors).
 * Multiple toasts can stack.
 */

import { createContext, useCallback, useContext, useState } from 'react'
import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from 'lucide-react'

type ToastType = 'error' | 'success' | 'warning' | 'info'

interface ToastItem {
  id: string
  message: string
  type: ToastType
  duration: number
}

interface GlobalToastContextType {
  showError: (message: string, duration?: number) => void
  showSuccess: (message: string, duration?: number) => void
  showWarning: (message: string, duration?: number) => void
  showInfo: (message: string, duration?: number) => void
}

const GlobalToastContext = createContext<GlobalToastContextType>({
  showError: () => {},
  showSuccess: () => {},
  showWarning: () => {},
  showInfo: () => {},
})

export const useGlobalToast = () => useContext(GlobalToastContext)

const TOAST_CONFIG: Record<ToastType, { icon: any; bg: string; border: string; text: string; defaultDuration: number }> = {
  error:   { icon: AlertCircle,   bg: 'bg-red-50',    border: 'border-red-400',    text: 'text-red-800',   defaultDuration: 8000 },
  success: { icon: CheckCircle,   bg: 'bg-green-50',  border: 'border-green-400',  text: 'text-green-800', defaultDuration: 4000 },
  warning: { icon: AlertTriangle, bg: 'bg-amber-50',  border: 'border-amber-400',  text: 'text-amber-800', defaultDuration: 6000 },
  info:    { icon: Info,          bg: 'bg-blue-50',   border: 'border-blue-400',   text: 'text-blue-800',  defaultDuration: 5000 },
}

function ToastNotification({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const config = TOAST_CONFIG[item.type]
  const Icon = config.icon

  // Auto-dismiss
  useState(() => {
    if (item.duration > 0) {
      const timer = setTimeout(() => onDismiss(item.id), item.duration)
      return () => clearTimeout(timer)
    }
  })

  return (
    <div
      className={`${config.bg} ${config.border} ${config.text} border-2 rounded-xl px-4 py-3 shadow-2xl flex items-start gap-3 
        animate-in slide-in-from-bottom-4 fade-in duration-300 max-w-lg w-full`}
    >
      <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <p className="text-sm font-medium flex-1 leading-relaxed">{item.message}</p>
      <button
        onClick={() => onDismiss(item.id)}
        className="flex-shrink-0 p-0.5 rounded-lg hover:bg-black/5 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

export default function GlobalToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((message: string, type: ToastType, duration?: number) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const finalDuration = duration ?? TOAST_CONFIG[type].defaultDuration
    setToasts(prev => [...prev.slice(-4), { id, message, type, duration: finalDuration }]) // max 5 toasts
    if (finalDuration > 0) {
      setTimeout(() => dismiss(id), finalDuration)
    }
  }, [dismiss])

  const showError = useCallback((msg: string, dur?: number) => addToast(msg, 'error', dur), [addToast])
  const showSuccess = useCallback((msg: string, dur?: number) => addToast(msg, 'success', dur), [addToast])
  const showWarning = useCallback((msg: string, dur?: number) => addToast(msg, 'warning', dur), [addToast])
  const showInfo = useCallback((msg: string, dur?: number) => addToast(msg, 'info', dur), [addToast])

  return (
    <GlobalToastContext.Provider value={{ showError, showSuccess, showWarning, showInfo }}>
      {children}

      {/* Toast Stack — always visible at bottom center */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-lg flex flex-col gap-2 pointer-events-auto">
          {toasts.map(t => (
            <ToastNotification key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </GlobalToastContext.Provider>
  )
}
