'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import { AlertTriangle, X } from 'lucide-react'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [loading,      setLoading]      = useState(true)
  const [configWarn,   setConfigWarn]   = useState<string[]>([])
  const [warnDismissed,setWarnDismissed]= useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setLoading(false)
    })
  }, [router])

  // Check which keys are missing
  useEffect(() => {
    fetch('/api/check-config')
      .then(r => r.json())
      .then(({ anthropicOk, supabaseOk }) => {
        const warnings: string[] = []
        if (!supabaseOk)  warnings.push('Supabase not configured — patient data won\'t save')
        if (!anthropicOk) warnings.push('Anthropic API key missing — AI features (OCR, summaries, voice) won\'t work')
        setConfigWarn(warnings)
      })
      .catch(() => {}) // silently ignore if check itself fails
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading NexMedicon HMS...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <div className="no-print hidden md:block">
        <Sidebar />
      </div>
      <main className="md:ml-60 print:ml-0 flex-1 min-h-screen pb-16 md:pb-0">

        {/* Configuration warning banner */}
        {configWarn.length > 0 && !warnDismissed && (
          <div className="no-print bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-800 mb-0.5">Setup incomplete</p>
              {configWarn.map(w => (
                <p key={w} className="text-xs text-amber-700">⚠ {w}</p>
              ))}
              <div className="flex gap-3 mt-1">
                <Link href="/ai-setup" className="text-xs text-amber-800 underline font-semibold">Fix AI Setup →</Link>
                <Link href="/setup"    className="text-xs text-amber-700 underline">Setup Guide</Link>
              </div>
            </div>
            <button onClick={() => setWarnDismissed(true)}
              className="text-amber-500 hover:text-amber-700 flex-shrink-0 p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {children}
      </main>
      <MobileNav/>
    </div>
  )
}
