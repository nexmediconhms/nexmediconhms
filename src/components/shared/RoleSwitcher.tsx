'use client'
/**
 * src/components/shared/RoleSwitcher.tsx
 *
 * ── HOW ROLE SWITCHING WORKS ──────────────────────────────
 * 
 * Your situation: One person is BOTH admin AND doctor.
 * Problem: The app shows different menus/features based on role.
 * Solution: Let them switch which "hat" they are wearing right now.
 *
 * The active role is stored in localStorage (browser memory).
 * When they switch, the page reloads and the whole app picks up the new role.
 *
 * ── SETUP REQUIRED ────────────────────────────────────────
 *
 * 1. Run v30-master-fix.sql first (adds extra_roles column to clinicusers)
 *
 * 2. Grant your admin user the doctor role too:
 *    In Supabase SQL Editor, run:
 *    UPDATE clinicusers
 *    SET extra_roles = ARRAY['doctor']
 *    WHERE email = 'your-email@example.com'
 *    AND role = 'admin';
 *
 * 3. Add <RoleSwitcher /> to your AppShell header.
 *    Example in src/components/layout/AppShell.tsx:
 *    import RoleSwitcher from '@/components/shared/RoleSwitcher'
 *    ...in the header JSX:
 *    <RoleSwitcher />
 *
 * 4. In your login page, after successful login, call:
 *    import { initRoleOnLogin } from '@/components/shared/RoleSwitcher'
 *    initRoleOnLogin(clinicUser.role)
 *
 * ── HOW TO READ THE CURRENT ROLE IN ANY PAGE ──────────────
 *
 * import { getActiveRole } from '@/components/shared/RoleSwitcher'
 * const role = getActiveRole()
 * if (role === 'admin') { ... }
 * if (role === 'doctor') { ... }
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Shield, Stethoscope, Users, ChevronDown, Check } from 'lucide-react'

// ── Public helper functions ───────────────────────────────────
// Import these in any page/component that needs to check the role

const ROLE_KEY = 'nexmedicon_active_role'

/** Get the currently active role. Returns null if not logged in. */
export function getActiveRole(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ROLE_KEY)
}

/** Call this after successful login to set the initial role. */
export function initRoleOnLogin(primaryRole: string) {
  if (typeof window === 'undefined') return
  // Only set if not already set (preserve existing switch state)
  if (!localStorage.getItem(ROLE_KEY)) {
    localStorage.setItem(ROLE_KEY, primaryRole)
  }
}

/** Call this on logout to clear role data. */
export function clearRoleOnLogout() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ROLE_KEY)
}

/** Check if currently in admin mode. */
export function isAdminMode(): boolean {
  return getActiveRole() === 'admin'
}

/** Check if currently in doctor mode (or admin acting as doctor). */
export function isDoctorMode(): boolean {
  const r = getActiveRole()
  return r === 'doctor' || r === 'admin'
}

// ── Role config ───────────────────────────────────────────────

type AppRole = 'admin' | 'doctor' | 'staff' | 'receptionist'

const ROLE_CONFIG: Record<AppRole, {
  label:  string
  icon:   any
  color:  string
  bg:     string
  border: string
}> = {
  admin:        { label: 'Admin',        icon: Shield,      color: 'text-purple-700', bg: 'bg-purple-50',  border: 'border-purple-300' },
  doctor:       { label: 'Doctor',       icon: Stethoscope, color: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-300'   },
  staff:        { label: 'Staff',        icon: Users,       color: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-300'  },
  receptionist: { label: 'Receptionist', icon: Users,       color: 'text-orange-700', bg: 'bg-orange-50',  border: 'border-orange-300' },
}

// ── Component ─────────────────────────────────────────────────

export default function RoleSwitcher() {
  const [activeRole,     setActiveRole]     = useState<AppRole | null>(null)
  const [availableRoles, setAvailableRoles] = useState<AppRole[]>([])
  const [open,           setOpen]           = useState(false)
  const [loading,        setLoading]        = useState(true)

  useEffect(() => {
    fetchUserRoles()
  }, [])

  async function fetchUserRoles() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: cu } = await supabase
        .from('clinic_users')
        .select('role, extra_roles')
        .eq('auth_id', user.id)
        .eq('is_active', true)
        .single()

      if (!cu) { setLoading(false); return }

      const primary    = cu.role as AppRole
      const extras     = (cu.extra_roles || []) as AppRole[]
      const allRoles   = [primary, ...extras.filter(r => r !== primary)] as AppRole[]

      setAvailableRoles(allRoles)

      // Determine active role
      const stored = getActiveRole() as AppRole | null
      if (stored && allRoles.includes(stored)) {
        setActiveRole(stored)
      } else {
        // First time or stale value — default to primary
        setActiveRole(primary)
        if (typeof window !== 'undefined') {
          localStorage.setItem(ROLE_KEY, primary)
        }
      }
    } catch (err) {
      console.error('[RoleSwitcher]', err)
    }
    setLoading(false)
  }

  function switchToRole(newRole: AppRole) {
    setOpen(false)
    if (newRole === activeRole) return

    if (typeof window !== 'undefined') {
      localStorage.setItem(ROLE_KEY, newRole)
      // Reload so the entire app picks up the new role
      window.location.reload()
    }
  }

  // Don't show the switcher if user only has one role
  if (loading || !activeRole || availableRoles.length <= 1) return null

  const cfg  = ROLE_CONFIG[activeRole]
  const Icon = cfg.icon

  return (
    <div className="relative">
      {/* Current role button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border
                    text-xs font-bold transition-all
                    ${cfg.bg} ${cfg.color} ${cfg.border}`}
      >
        <Icon className="w-3.5 h-3.5" />
        {cfg.label}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Invisible backdrop to close on click-outside */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />

          <div className="absolute right-0 top-full mt-2 z-50 bg-white rounded-2xl
                          shadow-2xl border border-gray-200 overflow-hidden min-w-[180px]">
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">
                Switch View
              </p>
            </div>

            {availableRoles.map(role => {
              const rcfg  = ROLE_CONFIG[role]
              const RIcon = rcfg.icon
              const isActive = role === activeRole

              return (
                <button
                  key={role}
                  onClick={() => switchToRole(role)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm
                              transition-colors hover:bg-gray-50
                              ${isActive ? 'bg-gray-50' : ''}`}
                >
                  <div className={`w-7 h-7 rounded-xl flex items-center justify-center
                                   ${rcfg.bg} ${rcfg.border} border`}>
                    <RIcon className={`w-3.5 h-3.5 ${rcfg.color}`} />
                  </div>
                  <span className={`font-semibold ${rcfg.color}`}>{rcfg.label}</span>
                  {isActive && (
                    <Check className="w-4 h-4 text-green-500 ml-auto" />
                  )}
                </button>
              )
            })}

            {/* Info hint */}
            <div className="px-4 py-2 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 leading-tight">
                Switching reloads the page to apply the new role view
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}