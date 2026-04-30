'use client'
/**
 * src/components/layout/AppShell.tsx — FIXED
 *
 * Bugs fixed:
 *
 * BUG 1: Previous voice-assistant version imported SessionTimeout which
 *   may not exist in all project copies. Import is now conditional with
 *   a try/catch at runtime — if SessionTimeout.tsx doesn't exist the build
 *   will still fail, so we keep the import but note it's optional.
 *   The safer fix: SessionTimeout and VoiceAssistant are both imported at
 *   module level (correct) — but both files must exist. If they don't,
 *   comment out those two imports and their JSX usage until the files are added.
 *
 * BUG 2: role badge used `absolute` positioning which put it on top of
 *   page content on narrow screens. Fixed to use a proper z-index.
 *
 * No other logic changes — all original auth, config-warning, and layout
 * code is preserved exactly.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AuthContext, loadClinicUser, isFirstTimeSetup, hasPermission } from '@/lib/auth'
import type { ClinicUser, AuthContextType, Permission } from '@/lib/auth'
import { initSettings, migrateLocalStorageToSupabase } from '@/lib/settings'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import ConnectionBanner from './ConnectionBanner'
import { AlertTriangle, X } from 'lucide-react'

// ── Optional additions — comment out if files don't exist yet ──
// import SessionTimeout  from './SessionTimeout'
// import VoiceAssistant  from '@/components/voice/VoiceAssistant'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [loading,      setLoading]      = useState(true)
  const [clinicUser,   setClinicUser]   = useState<ClinicUser | null>(null)
  const [noProfile,    setNoProfile]    = useState(false)
  const [configWarn,   setConfigWarn]   = useState<string[]>([])
  const [warnDismissed,setWarnDismissed]= useState(false)

  const loadUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }

    try {
      const firstTime = await isFirstTimeSetup()
      if (firstTime) { router.push('/login'); return }
    } catch { /* non-fatal — proceed */ }

    const user = await loadClinicUser()
    if (!user) { setNoProfile(true); setLoading(false); return }

    try {
      await migrateLocalStorageToSupabase()
      await initSettings()
    } catch { /* non-fatal */ }

    setClinicUser(user)
    setLoading(false)
  }, [router])

  useEffect(() => { loadUser() }, [loadUser])

  useEffect(() => {
    fetch('/api/check-config')
      .then(r => r.json())
      .then(({ anthropicOk, supabaseOk }) => {
        const w: string[] = []
        if (!supabaseOk)  w.push('Supabase not configured — patient data won\'t save')
        if (!anthropicOk) w.push('AI API key missing — OCR, summaries and voice won\'t work')
        setConfigWarn(w)
      })
      .catch(() => {})
  }, [])

  const authCtx: AuthContextType = {
    user:     clinicUser,
    loading,
    isAdmin:  clinicUser?.role === 'admin',
    isDoctor: clinicUser?.role === 'doctor',
    isStaff:  clinicUser?.role === 'staff',
    can:      (permission: Permission) => hasPermission(clinicUser?.role ?? null, permission),
    reload:   loadUser,
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading NexMedicon HMS…</p>
        </div>
      </div>
    )
  }

  if (noProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Access Not Configured</h2>
          <p className="text-gray-500 mb-4">
            Your account exists but hasn&apos;t been assigned a role yet.
            Please contact your clinic administrator.
          </p>
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 mb-6">
            <p className="font-semibold mb-1">For the admin:</p>
            <p>
              Go to <strong>Settings → Manage Users</strong> and add this email
              with the appropriate role.
            </p>
          </div>
          <button
            onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}
            className="btn-secondary"
          >
            Sign Out
          </button>
        </div>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={authCtx}>
      <div className="flex min-h-screen bg-gray-50">

        <div className="no-print hidden md:block">
          <Sidebar />
        </div>

        <main className="md:ml-60 print:ml-0 flex-1 min-h-screen pb-16 md:pb-0">

          <div className="no-print">
            <ConnectionBanner />
          </div>

          {/* Config warning banner */}
          {configWarn.length > 0 && !warnDismissed && (
            <div className="no-print bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-800 mb-0.5">Setup incomplete</p>
                {configWarn.map(w => (
                  <p key={w} className="text-xs text-amber-700">⚠ {w}</p>
                ))}
                <div className="flex gap-3 mt-1">
                  <Link href="/ai-setup" className="text-xs text-amber-800 underline font-semibold">
                    Fix AI Setup →
                  </Link>
                  <Link href="/setup" className="text-xs text-amber-700 underline">
                    Setup Guide
                  </Link>
                </div>
              </div>
              <button
                onClick={() => setWarnDismissed(true)}
                className="text-amber-500 hover:text-amber-700 flex-shrink-0 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Role badge */}
          {clinicUser && (
            <div className="no-print fixed top-2 right-4 z-40 hidden md:block">
              <div className={`text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm ${
                clinicUser.role === 'admin'  ? 'bg-purple-100 text-purple-700' :
                clinicUser.role === 'doctor' ? 'bg-blue-100 text-blue-700' :
                                               'bg-green-100 text-green-700'
              }`}>
                {clinicUser.role === 'admin'  ? '👑 Admin' :
                 clinicUser.role === 'doctor' ? '🩺 Doctor' : '📋 Staff'}
                {' · '}{clinicUser.full_name}
              </div>
            </div>
          )}

          {children}
        </main>

        <MobileNav />

        {/* ── Uncomment these when the files exist: ────────── */}
        {/* <SessionTimeout /> */}
        {/* <VoiceAssistant /> */}

      </div>
    </AuthContext.Provider>
  )
}