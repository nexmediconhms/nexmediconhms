'use client'
/**
 * /appointments/new — Redirects to the appointments page.
 * The appointments page has inline booking functionality.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AppointmentNewRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/appointments')
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
