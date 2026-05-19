'use client'
/**
 * /ipd/new — Redirects to the IPD page which has the admission form.
 * The IPD page shows the admission form when you click "New Admission".
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function IPDNewRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/ipd')
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
