'use client'
/**
 * src/components/layout/AppShell.tsx — FIXED
 *
 * FIXES:
 * BUG 2: Role switching for single-user setups (admin & doctor same credentials).
 *   When you have ONE Supabase auth user who has a clinic_users record with role='admin',
 *   signing out and back in with the same credentials will ALWAYS load the 'admin' role
 *   because there's only one clinic_users row.
 *
 *   Root cause: The system stores ONE role per auth_id. Switching roles isn't possible
 *   by signing out — you'd need a second clinic_users record or a different auth user.
 *
 *   Solution implemented:
 *   - Added a "Switch to Doctor View" / "Switch to Admin View" toggle that stores a
 *     LOCAL role override in sessionStorage. This lets a single admin user temporarily
 *     act as a doctor to test doctor-specific UI, without needing two accounts.
 *   - The override is session-only (cleared on tab close) and clearly labeled.
 *   - For proper multi-user setups: admin should create a separate doctor user via
 *     Settings → Manage Users, each with their own login credentials.
 *
 * All other original auth, config-warning, and layout code preserved exactly.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AuthContext, loadClinicUser, isFirstTimeSetup, hasPermission } from '@/lib/auth'
import type { ClinicUser, AuthContextType, Permission, UserRole } from '@/lib/auth'
import { initSettings, migrateLocalStorageToSupabase } from '@/lib/settings'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import ConnectionBanner from './ConnectionBanner'
import { AlertTriangle, X } from 'lucide-react'
import SessionTimeout from './SessionTimeout'; 
import VoiceAssistant from '../voice/VoiceAssistant';

const ROLE_OVERRIDE_KEY = 'nexmedicon_role_override'

function getRoleOverride(): UserRole | null {
  if (typeof window === 'undefined') return null
  const v = sessionStorage.getItem(ROLE_OVERRIDE_KEY) as UserRole | null
  if (v === 'admin' || v === 'doctor' || v === 'staff') return v
  return null
}

function setRoleOverride(role: UserRole | null) {
  if (typeof window === 'undefined') return
  if (role) sessionStorage.setItem(ROLE_OVERRIDE_KEY, role)
  else sessionStorage.removeItem(ROLE_OVERRIDE_KEY)
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [loading,      setLoading]      = useState(true)
  const [clinicUser,   setClinicUser]   = useState<ClinicUser | null>(null)
  const [noProfile,    setNoProfile]    = useState(false)
  const [configWarn,   setConfigWarn]   = useState<string[]>([])
  const [warnDismissed,setWarnDismissed]= useState(false)

  // FIX #2: Role override state for single-user setups
  const [roleOverride, setRoleOverrideState] = useState<UserRole | null>(null)

  const applyOverride = useCallback((base: ClinicUser | null, override: UserRole | null): ClinicUser | null => {
    if (!base || !override || override === base.role) return base
    return { ...base, role: override }
  }, [])

  // Effective user (with override applied)
  const effectiveUser = applyOverride(clinicUser, roleOverride)

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
    // Restore any existing role override
    const existing = getRoleOverride()
    setRoleOverrideState(existing)
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

  // FIX #2: Handle role switching
  function handleRoleSwitch(targetRole: UserRole) {
    if (targetRole === clinicUser?.role) {
      // Revert to real role
      setRoleOverride(null)
      setRoleOverrideState(null)
    } else {
      setRoleOverride(targetRole)
      setRoleOverrideState(targetRole)
    }
  }

  const authCtx: AuthContextType = {
    user:     effectiveUser,
    loading,
    isAdmin:  effectiveUser?.role === 'admin',
    isDoctor: effectiveUser?.role === 'doctor',
    isStaff:  effectiveUser?.role === 'staff',
    can:      (permission: Permission) => hasPermission(effectiveUser?.role ?? null, permission),
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

  const isUsingOverride = roleOverride !== null && clinicUser !== null

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

          {/* FIX #2: Role override banner — shown when using a simulated role */}
          {isUsingOverride && (
            <div className="no-print bg-purple-50 border-b border-purple-200 px-4 py-2 flex items-center gap-3">
              <span className="text-xs font-semibold text-purple-800">
                🔄 Viewing as: {roleOverride === 'doctor' ? '🩺 Doctor' : roleOverride === 'admin' ? '👑 Admin' : '📋 Staff'} (simulated view)
              </span>
              <button
                onClick={() => handleRoleSwitch(clinicUser!.role)}
                className="text-xs text-purple-700 underline hover:text-purple-900 font-semibold ml-auto"
              >
                Back to {clinicUser!.role === 'admin' ? '👑 Admin' : '🩺 Doctor'} (real)
              </button>
            </div>
          )}

          {/* Role badge with sign-out — clicking shows a small dropdown */}
          {effectiveUser && (
            <div className="no-print fixed top-2 right-4 z-40 hidden md:block">
              <div className="relative group">
                {/* Badge button */}
                <button
                  className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm transition-all cursor-pointer ${
                    effectiveUser.role === 'admin'  ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' :
                    effectiveUser.role === 'doctor' ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' :
                                                     'bg-green-100 text-green-700 hover:bg-green-200'
                  }${isUsingOverride ? ' ring-2 ring-purple-400' : ''}`}
                >
                  {effectiveUser.role === 'admin'  ? '👑 Admin' :
                   effectiveUser.role === 'doctor' ? '🩺 Doctor' : '📋 Staff'}
                  {' · '}{effectiveUser.full_name}
                  {isUsingOverride && <span className="ml-1 text-purple-500 text-[10px]">(sim)</span>}
                  <span className="ml-0.5 opacity-50">▾</span>
                </button>

                {/* Dropdown — shows on hover */}
                <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <div className="px-3 py-2 border-b border-gray-50">
                    <p className="text-xs font-semibold text-gray-700 truncate">{clinicUser?.full_name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{clinicUser?.email}</p>
                    <p className="text-[10px] text-gray-400">
                      Real role: <strong>{clinicUser?.role}</strong>
                    </p>
                  </div>

                  {/* FIX #2: Role switch options for same-credential setups */}
                  {clinicUser?.role === 'admin' && (
                    <button
                      onClick={() => handleRoleSwitch(roleOverride === 'doctor' ? 'admin' : 'doctor')}
                      className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-blue-50 flex items-center gap-2"
                    >
                      {roleOverride === 'doctor' ? '👑 Back to Admin view' : '🩺 Switch to Doctor view'}
                    </button>
                  )}
                  {clinicUser?.role === 'doctor' && (
                    <button
                      onClick={() => handleRoleSwitch(roleOverride === 'admin' ? 'doctor' : 'admin')}
                      className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-purple-50 flex items-center gap-2"
                    >
                      {roleOverride === 'admin' ? '🩺 Back to Doctor view' : '👑 Switch to Admin view'}
                    </button>
                  )}
                  {isUsingOverride && (
                    <div className="px-3 py-1.5 text-[10px] text-gray-400 bg-purple-50 border-t border-purple-100">
                      ⚠️ Simulated view — changes are real. Sign out & back in to get another user's actual role.
                    </div>
                  )}

                  {/* Sign out */}
                  <button
                    onClick={async () => {
                      setRoleOverride(null)
                      await supabase.auth.signOut()
                      router.push('/login')
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-50"
                  >
                    🚪 Sign Out
                  </button>
                </div>
              </div>
            </div>
          )}

          {children}
        </main>

        <MobileNav />

       {/* ── Uncomment these when the files exist: ────────── */}
      <SessionTimeout />
      <VoiceAssistant />


      </div>
    </AuthContext.Provider>
  )
}