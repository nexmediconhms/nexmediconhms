'use client'
/**
 * src/components/layout/AppShell.tsx — SIMPLIFIED
 *
 * Removed:
 * - Runtime bootstrap UI (first-time admin setup screen)
 * - handleEmergencyBootstrap / handleFirstTimeSetup
 * - "Access Not Configured" fallback with setup link
 *
 * Now:
 * - If no profile found → shows clean "No Access" message with Sign Out
 * - Admin is pre-created via SQL during deployment (not at runtime)
 * - Role override preview mode for admins is preserved
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AuthContext, loadClinicUser, hasPermission } from '@/lib/auth'
import type { ClinicUser, AuthContextType, Permission, UserRole } from '@/lib/auth'
import { initSettings } from '@/lib/settings'
import { initABDMConfig } from '@/lib/abdm'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import ConnectionBanner from './ConnectionBanner'
import { AlertTriangle, X } from 'lucide-react'
import SessionTimeout from './SessionTimeout';
import VoiceAssistant from '../voice/VoiceAssistant';
import NotificationPanel from './NotificationPanel';

const ROLE_OVERRIDE_KEY = 'nexmedicon_role_override'

function getRoleOverride(): UserRole | null {
  if (typeof window === 'undefined') return null
  const v = sessionStorage.getItem(ROLE_OVERRIDE_KEY) as UserRole | null
  if (v === 'admin' || v === 'doctor' || v === 'staff' || v === 'lab_partner') return v
  return null
}

function setRoleOverride(role: UserRole | null) {
  if (typeof window === 'undefined') return
  if (role) sessionStorage.setItem(ROLE_OVERRIDE_KEY, role)
  else sessionStorage.removeItem(ROLE_OVERRIDE_KEY)
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [clinicUser, setClinicUser] = useState<ClinicUser | null>(null)
  const [noProfile, setNoProfile] = useState(false)
  const [configWarn, setConfigWarn] = useState<string[]>([])
  const [warnDismissed, setWarnDismissed] = useState(false)

  // Role override state for single-user setups (admin preview mode)
  const [roleOverride, setRoleOverrideState] = useState<UserRole | null>(null)

  const applyOverride = useCallback((base: ClinicUser | null, override: UserRole | null): ClinicUser | null => {
    if (!base || !override || override === base.role) return base
    return { ...base, role: override }
  }, [])

  const effectiveUser = applyOverride(clinicUser, roleOverride)

  const loadUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }

    // FIX: Add timeout to prevent infinite loading spinner
    const timeoutId = setTimeout(() => {
      console.warn('[AppShell] User loading timed out after 10s')
      setNoProfile(true)
      setLoading(false)
    }, 10000) // 10 second timeout

    // Try loading user profile
    let user = await loadClinicUser()

    // Fallback: try /api/me (bypasses RLS via service_role)
    if (!user) {
      try {
        const res = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok) {
          const body = await res.json()
          if (body.user) {
            user = {
              id:          body.user.id,
              auth_id:     body.user.auth_id,
              email:       body.user.email,
              full_name:   body.user.full_name,
              role:        body.user.role,
              is_active:   body.user.is_active,
              phone:       body.user.phone,
              specialty:   body.user.specialty,
              med_reg_no:  body.user.med_reg_no,
            }
          }
        }
      } catch { /* network error — will show noProfile */ }
    }

    clearTimeout(timeoutId) // Clear timeout — we got a response

    if (!user) { setNoProfile(true); setLoading(false); return }

    try {
      await initSettings()
      await initABDMConfig()
    } catch { /* non-fatal */ }

    setClinicUser(user)
    const existing = getRoleOverride()
    setRoleOverrideState(existing)
    setLoading(false)
  }, [router])

  useEffect(() => { loadUser() }, [loadUser])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyboard(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.altKey) {
        switch (e.key) {
          case 'n': e.preventDefault(); router.push('/patients/new'); break
          case 'd': e.preventDefault(); router.push('/dashboard'); break
          case 'p': e.preventDefault(); window.print(); break
          case '/': e.preventDefault();
            document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="Search"]')?.focus()
            break
        }
      }
      if (e.key === 'Escape') {
        const modal = document.querySelector('[role="dialog"]')
        if (modal) {
          (modal.querySelector('button[aria-label="Close"]') as HTMLButtonElement)?.click()
        }
      }
    }
    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [router])

  // Config warnings
  useEffect(() => {
    fetch('/api/check-config')
      .then(r => r.json())
      .then(({ anthropicOk, supabaseOk }) => {
        const w: string[] = []
        if (!supabaseOk) w.push('Supabase not configured — patient data won\'t save')
        if (!anthropicOk) w.push('AI API key missing — OCR, summaries and voice won\'t work')
        setConfigWarn(w)
      })
      .catch(() => { })
  }, [])

  // Role switching (ADMIN ONLY — UI preview)
  function handleRoleSwitch(targetRole: UserRole) {
    if (clinicUser?.role !== 'admin') return
    if (targetRole === clinicUser?.role) {
      setRoleOverride(null)
      setRoleOverrideState(null)
    } else {
      setRoleOverride(targetRole)
      setRoleOverrideState(targetRole)
    }
  }

  function handleSignOut() {
    setRoleOverride(null)
    setRoleOverrideState(null)
    supabase.auth.signOut().then(() => { router.push('/login') })
  }

  const authCtx: AuthContextType = {
    user: effectiveUser,
    loading,
    isAdmin: effectiveUser?.role === 'admin',
    isDoctor: effectiveUser?.role === 'doctor',
    isStaff: effectiveUser?.role === 'staff',
    can: (permission: Permission) => hasPermission(effectiveUser?.role ?? null, permission),
    reload: loadUser,
  }

  // ── Loading state
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

  // ── No profile found — simple message, no bootstrap UI
  if (noProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Access Not Configured</h2>
          <p className="text-gray-500 mb-6">
            Your account exists but hasn&apos;t been assigned a role yet.
            Please contact your clinic administrator to add your email
            in <strong>Settings → Manage Users</strong>.
          </p>
          <button
            onClick={handleSignOut}
            className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    )
  }

  // ── Main app layout
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
              <button onClick={() => setWarnDismissed(true)}
                className="text-amber-500 hover:text-amber-700 flex-shrink-0 p-0.5">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Role override banner */}
          {isUsingOverride && (
            <div className="no-print bg-purple-50 border-b border-purple-200 px-4 py-2 flex items-center gap-3">
              <span className="text-xs font-semibold text-purple-800">
                PREVIEW MODE: Viewing as {roleOverride === 'doctor' ? 'Doctor' : roleOverride === 'staff' ? 'Staff' : roleOverride}. Your real role is Admin.
              </span>
              <button onClick={() => handleRoleSwitch(clinicUser!.role)}
                className="text-xs text-purple-700 underline hover:text-purple-900 font-semibold ml-auto">
                Exit Preview
              </button>
            </div>
          )}

          {/* Role badge + dropdown */}
          {effectiveUser && (
            <div className="no-print fixed top-2 right-4 z-40 hidden md:flex items-center gap-2">
              <NotificationPanel />
              <div className="relative group">
                <button
                  className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm transition-all cursor-pointer ${
                    effectiveUser.role === 'admin' ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' :
                    effectiveUser.role === 'doctor' ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' :
                    'bg-green-100 text-green-700 hover:bg-green-200'
                  }${isUsingOverride ? ' ring-2 ring-purple-400' : ''}`}
                >
                  {effectiveUser.role === 'admin' ? 'Admin' :
                   effectiveUser.role === 'doctor' ? 'Doctor' : 'Staff'}
                  {' · '}{effectiveUser.full_name}
                  <span className="ml-0.5 opacity-50">▾</span>
                </button>

                <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <div className="px-3 py-2 border-b border-gray-50">
                    <p className="text-xs font-semibold text-gray-700 truncate">{clinicUser?.full_name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{clinicUser?.email}</p>
                    <p className="text-[10px] text-gray-400">Role: <strong>{clinicUser?.role}</strong></p>
                  </div>

                  {clinicUser?.role === 'admin' && (
                    <>
                      <button onClick={() => handleRoleSwitch(roleOverride === 'doctor' ? 'admin' : 'doctor')}
                        className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-blue-50">
                        {roleOverride === 'doctor' ? 'Back to Admin view' : 'Preview as Doctor'}
                      </button>
                      <button onClick={() => handleRoleSwitch(roleOverride === 'staff' ? 'admin' : 'staff')}
                        className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-green-50">
                        {roleOverride === 'staff' ? 'Back to Admin view' : 'Preview as Staff'}
                      </button>
                    </>
                  )}

                  <button onClick={handleSignOut}
                    className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 border-t border-gray-50">
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
          )}

          {children}
        </main>

        <MobileNav />
        <SessionTimeout />
        <VoiceAssistant />
      </div>
    </AuthContext.Provider>
  )
}
