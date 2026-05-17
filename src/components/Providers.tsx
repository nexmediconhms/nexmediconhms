'use client'
/**
 * src/components/Providers.tsx
 *
 * Client-side providers wrapper for the root layout.
 * Wraps the entire app with:
 *  - PatientProvider (global patient context)
 *  - ToastProvider (global toast notifications)
 */

import { ReactNode } from 'react'
import { PatientProvider } from '@/lib/patient-context'
import { ToastProvider } from '@/components/shared/Toast'

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <PatientProvider>
      <ToastProvider>
        {children}
      </ToastProvider>
    </PatientProvider>
  )
}
