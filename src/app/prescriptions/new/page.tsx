'use client'
/**
 * /prescriptions/new — Redirects to OPD page.
 * Prescriptions in NexMedicon are always created from an OPD encounter.
 * Flow: OPD → Select Patient → Start Encounter → Write Prescription
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PrescriptionNewRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/opd')
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
