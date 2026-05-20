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
import { AuthContext, loadClinicUser, isFirstTimeSetup, bootstrapAdmin, hasPermission } from '@/lib/auth'
import type { ClinicUser, AuthContextType, Permission, UserRole } from '@/lib/auth'
import { initSettings } from '@/lib/settings'
import { initABDMConfig } from '@/lib/abdm'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import ConnectionBanner from './ConnectionBanner'
import { AlertTriangle, X, UserPlus, Loader2, CheckCircle2 } from 'lucide-react'
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
  const [showFirstTimeSetup, setShowFirstTimeSetup] = useState(false)
  const [configWarn, setConfigWarn] = useState<string[]>([])
  const [warnDismissed, setWarnDismissed] = useState(false)

  // First-time setup form state
  const [setupName, setSetupName] = useState('')
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [setupDone, setSetupDone] = useState(false)

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

    // Try loading user — first via direct query, then via /api/me (bypasses RLS)
    let user = await loadClinicUser()

    // If loadClinicUser() already succeeded (direct or via /api/me fallback), use it
    if (!user) {
      // Last resort: the /api/me endpoint also handles auto-bootstrapping
      // (creates admin if clinic_users is empty) and fixes auth_id mismatches.
      // This covers the case where loadClinicUser's own /api/me call failed
      // (e.g., network timing issue on first load).
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
        } else {
          const body = await res.json().catch(() => ({}))
          console.error('[AppShell] /api/me returned:', res.status, body)
        }
      } catch (err: any) {
        console.error('[AppShell] /api/me fetch failed:', err.message)
      }
    }

    if (!user) { setNoProfile(true); setLoading(false); return }

    try {
      await initSettings()
      await initABDMConfig()
    } catch { /* non-fatal */ }

    setClinicUser(user)
    // Restore any existing role override
    const existing = getRoleOverride()
    setRoleOverrideState(existing)
    setLoading(false)
  }, [router])

  useEffect(() => { loadUser() }, [loadUser])
  useEffect(() => {
    function handleKeyboard(e: KeyboardEvent) {
      // Don't trigger shortcuts when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.altKey) {
        switch (e.key) {
          case 'n': e.preventDefault(); router.push('/patients/new'); break
          case 'd': e.preventDefault(); router.push('/dashboard'); break
          case 'p': e.preventDefault(); window.print(); break
          case '/': e.preventDefault();
            // Focus the search input if it exists on this page
            document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="Search"]')?.focus()
            break
        }
      }
      if (e.key === 'Escape') {
        // Close any open modal or go back
        const modal = document.querySelector('[role="dialog"]')
        if (modal) {
          (modal.querySelector('button[aria-label="Close"]') as HTMLButtonElement)?.click()
        }
      }
    }

    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [router])


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

  // FIX #2: Handle role switching (ADMIN ONLY — preview mode)
  // Only admins can simulate other roles. This is a UI-only preview;
  // actual permissions are still enforced server-side via RLS.
  function handleRoleSwitch(targetRole: UserRole) {
    // Security: only admin can simulate other roles
    if (clinicUser?.role !== 'admin') return

    if (targetRole === clinicUser?.role) {
      // Revert to real role
      setRoleOverride(null)
      setRoleOverrideState(null)
    } else {
      setRoleOverride(targetRole)
      setRoleOverrideState(targetRole)
    }
  }

  // Always clear role override when signing out — prevents "stuck in doctor view"
  function handleSignOut() {
    setRoleOverride(null)
    setRoleOverrideState(null)
    supabase.auth.signOut().then(() => {
      router.push('/login')
    })
  }

  // Handler for first-time setup form submission
  async function handleFirstTimeSetup(e: React.FormEvent) {
    e.preventDefault()
    if (!setupName.trim()) { setSetupError('Please enter your name.'); return }
    setSetupLoading(true)
    setSetupError('')

    const result = await bootstrapAdmin(setupName.trim())
    setSetupLoading(false)

    if (result.success) {
      setSetupDone(true)
      setTimeout(() => {
        setShowFirstTimeSetup(false)
        setLoading(true)
        loadUser()
      }, 1500)
    } else {
      setSetupError(result.error || 'Failed to create admin account.')
    }
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
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 mb-4">
            <p className="font-semibold mb-1">For the admin:</p>
            <p>
              Go to <strong>Settings → Manage Users</strong> and add this email
              with the appropriate role.
            </p>
          </div>

          {/* First-time setup fallback */}
          <div className="border-t border-gray-200 pt-4 mb-4">
            <p className="text-xs text-gray-400 mb-2">
              First time setting up? No admin exists yet?
            </p>
            <button
              onClick={() => {
                setNoProfile(false)
                setShowFirstTimeSetup(true)
              }}
              className="text-sm text-blue-600 hover:text-blue-800 font-semibold underline"
            >
              → Set up as Admin (first-time only)
            </button>
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

  // First-time setup screen
  if (showFirstTimeSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-xl mb-4">
              <UserPlus className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-white">Welcome to NexMedicon</h1>
            <p className="text-blue-200 text-sm mt-2">First-time setup — you&apos;ll be the clinic admin</p>
          </div>
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            {setupDone ? (
              <div className="text-center py-4">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h2 className="text-lg font-bold text-gray-900 mb-1">Admin Account Created!</h2>
                <p className="text-sm text-gray-500">Loading your dashboard…</p>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Create Admin Account</h2>
                <p className="text-sm text-gray-500 mb-6">
                  Enter your name to become the first admin.
                </p>
                {setupError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                    {setupError}
                  </div>
                )}
                <form onSubmit={handleFirstTimeSetup} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Your Full Name</label>
                    <input
                      type="text"
                      value={setupName}
                      onChange={e => setSetupName(e.target.value)}
                      placeholder="Dr. Your Name"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      autoFocus
                      disabled={setupLoading}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={setupLoading || !setupName.trim()}
                    className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {setupLoading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>) : 'Create Admin Account & Continue'}
                  </button>
                </form>
                <button
                  onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}
                  className="w-full mt-4 text-sm text-gray-400 hover:text-gray-600 text-center"
                >
                  Sign Out
                </button>
              </>
            )}
          </div>
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

          {/* FIX #2: Role override banner — shown when admin is previewing another role */}
          {isUsingOverride && (
            <div className="no-print bg-purple-50 border-b border-purple-200 px-4 py-2 flex items-center gap-3">
              <span className="text-xs font-semibold text-purple-800">
                👁️ PREVIEW MODE: You are viewing the app as {roleOverride === 'doctor' ? '🩺 Doctor' : '📋 Staff'} would see it. Your actual role is still Admin — all actions use admin permissions.
              </span>
              <button
                onClick={() => handleRoleSwitch(clinicUser!.role)}
                className="text-xs text-purple-700 underline hover:text-purple-900 font-semibold ml-auto flex-shrink-0"
              >
                ✕ Exit Preview
              </button>
            </div>
          )}

          {/* Role badge with sign-out — clicking shows a small dropdown */}
          {effectiveUser && (
            <div className="no-print fixed top-2 right-4 z-40 hidden md:flex items-center gap-2">
              {/* Notification Bell */}
              <NotificationPanel />

              <div className="relative group">
                {/* Badge button */}
                <button
                  className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm transition-all cursor-pointer ${effectiveUser.role === 'admin' ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' :
                      effectiveUser.role === 'doctor' ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' :
                        'bg-green-100 text-green-700 hover:bg-green-200'
                    }${isUsingOverride ? ' ring-2 ring-purple-400' : ''}`}
                >
                  {effectiveUser.role === 'admin' ? '👑 Admin' :
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

                  {/* FIX #2: Role switch options — ADMIN ONLY can preview other roles */}
                  {clinicUser?.role === 'admin' && (
                    <>
                      <button
                        onClick={() => handleRoleSwitch(roleOverride === 'doctor' ? 'admin' : 'doctor')}
                        className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-blue-50 flex items-center gap-2"
                      >
                        {roleOverride === 'doctor' ? '👑 Back to Admin view' : '🩺 Preview as Doctor'}
                      </button>
                      <button
                        onClick={() => handleRoleSwitch(roleOverride === 'staff' ? 'admin' : 'staff')}
                        className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-green-50 flex items-center gap-2"
                      >
                        {roleOverride === 'staff' ? '👑 Back to Admin view' : '📋 Preview as Staff'}
                      </button>
                    </>
                  )}
                  {isUsingOverride && (
                    <div className="px-3 py-1.5 text-[10px] text-gray-400 bg-purple-50 border-t border-purple-100">
                      ⚠️ Simulated view — changes are real. Sign out & back in to get another user's actual role.
                    </div>
                  )}

                  {/* Sign out */}
                  <button
                    onClick={handleSignOut}
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