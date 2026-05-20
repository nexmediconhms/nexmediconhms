'use client'
/**
 * /ipd/new — New IPD Admission page.
 * Redirects to the IPD page with the admission form active.
 * If a patientId is provided in the URL, it passes it through
 * so the admission form pre-fills the patient details.
 */
import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function IPDNewContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const patientId = searchParams.get('patientId')
    if (patientId) {
      router.replace(`/ipd?patientId=${patientId}`)
    } else {
      router.replace('/ipd')
    }
  }, [router, searchParams])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function IPDNewRedirect() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <IPDNewContent />
    </Suspense>
  )
}
