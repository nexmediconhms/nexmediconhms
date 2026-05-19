'use client'
/**
 * /prescriptions — Redirects to OPD page.
 * In this clinic workflow, prescriptions are accessed through patient encounters (OPD).
 * To view a patient's prescription: OPD → Patient → Prescription tab
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PrescriptionsRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/opd')
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500">Redirecting to OPD...</p>
        <p className="text-xs text-gray-400 mt-1">Prescriptions are created from patient encounters</p>
      </div>
    </div>
  )
}