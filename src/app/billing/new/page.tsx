'use client'
/**
 * /billing/new — Redirects to the billing page with the "new bill" view active.
 * The billing page uses an internal state `view` to show the new bill form.
 * We pass a URL param to trigger it.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function BillingNewRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/billing?view=new')
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
