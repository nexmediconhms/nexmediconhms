/**
 * Auth & Role Management for NexMedicon HMS
 *
 * Provides:
 * - Role types and permission checks
 * - React context for current user info
 * - Helper to load user profile from clinic_users table
 * - Permission matrix for UI visibility
 */

import { createContext, useContext } from 'react'
import { supabase } from './supabase'

// ─── Types ────────────────────────────────────────────────────
export type UserRole = 'admin' | 'doctor' | 'staff'

export interface ClinicUser {
  id: string
  auth_id: string
  email: string
  full_name: string
  role: UserRole
  is_active: boolean
  phone?: string
}

// ─── React Context ────────────────────────────────────────────
export interface AuthContextType {
  user: ClinicUser | null
  loading: boolean
  isAdmin: boolean
  isDoctor: boolean
  isStaff: boolean
  can: (permission: Permission) => boolean
  reload: () => Promise<void>
}

const defaultCtx: AuthContextType = {
  user: null,
  loading: true,
  isAdmin: false,
  isDoctor: false,
  isStaff: false,
  can: () => false,
  reload: async () => {},
}

export const AuthContext = createContext<AuthContextType>(defaultCtx)
export const useAuth = () => useContext(AuthContext)

// ─── Permissions ──────────────────────────────────────────────
export type Permission =
  | 'patients.view'
  | 'patients.create'
  | 'patients.edit'
  | 'patients.delete'
  | 'encounters.view'
  | 'encounters.create'
  | 'encounters.edit'
  | 'prescriptions.view'
  | 'prescriptions.create'
  | 'prescriptions.edit'
  | 'beds.view'
  | 'beds.manage'
  | 'billing.view'
  | 'billing.create'
  | 'reports.view'
  | 'reports.financial'
  | 'settings.view'
  | 'settings.edit'
  | 'users.manage'
  | 'queue.view'
  | 'queue.manage'
  | 'forms.view'
  | 'forms.scan'
  | 'anc.view'
  | 'anc.edit'
  | 'labs.view'
  | 'labs.edit'
  | 'discharge.view'
  | 'discharge.create'
  | 'discharge.edit'

// Permission matrix: which roles can do what
const PERMISSIONS: Record<Permission, UserRole[]> = {
  'patients.view':        ['admin', 'doctor', 'staff'],
  'patients.create':      ['admin', 'doctor', 'staff'],
  'patients.edit':        ['admin', 'doctor', 'staff'],
  'patients.delete':      ['admin'],

  'encounters.view':      ['admin', 'doctor', 'staff'],
  'encounters.create':    ['admin', 'doctor'],
  'encounters.edit':      ['admin', 'doctor'],

  'prescriptions.view':   ['admin', 'doctor', 'staff'],
  'prescriptions.create': ['admin', 'doctor'],
  'prescriptions.edit':   ['admin', 'doctor'],

  'beds.view':            ['admin', 'doctor', 'staff'],
  'beds.manage':          ['admin', 'doctor', 'staff'],

  'billing.view':         ['admin', 'doctor', 'staff'],
  'billing.create':       ['admin', 'staff'],

  'reports.view':         ['admin', 'doctor'],
  'reports.financial':    ['admin'],

  'settings.view':        ['admin', 'doctor', 'staff'],
  'settings.edit':        ['admin', 'doctor'],
  'users.manage':         ['admin'],

  'queue.view':           ['admin', 'doctor', 'staff'],
  'queue.manage':         ['admin', 'doctor', 'staff'],

  'forms.view':           ['admin', 'doctor', 'staff'],
  'forms.scan':           ['admin', 'doctor', 'staff'],

  'anc.view':             ['admin', 'doctor', 'staff'],
  'anc.edit':             ['admin', 'doctor'],

  'labs.view':            ['admin', 'doctor', 'staff'],
  'labs.edit':            ['admin', 'doctor'],

  'discharge.view':       ['admin', 'doctor', 'staff'],
  'discharge.create':     ['admin', 'doctor'],
  'discharge.edit':       ['admin', 'doctor'],
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole | null, permission: Permission): boolean {
  if (!role) return false
  return PERMISSIONS[permission]?.includes(role) ?? false
}

/**
 * Load the current user's clinic profile from the database.
 * Returns null if the user doesn't have a clinic_users record.
 */
export async function loadClinicUser(): Promise<ClinicUser | null> {
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return null

  const { data, error } = await supabase
    .from('clinic_users')
    .select('*')
    .eq('auth_id', authUser.id)
    .eq('is_active', true)
    .single()

  if (error || !data) return null

  return {
    id: data.id,
    auth_id: data.auth_id,
    email: data.email,
    full_name: data.full_name,
    role: data.role as UserRole,
    is_active: data.is_active,
    phone: data.phone,
  }
}

/**
 * Check if the clinic_users table is empty (first-time setup).
 * If so, the current user should be prompted to set up as admin.
 */
export async function isFirstTimeSetup(): Promise<boolean> {
  const { count, error } = await supabase
    .from('clinic_users')
    .select('id', { count: 'exact', head: true })

  if (error) return false
  return (count ?? 0) === 0
}

/**
 * Create the first admin user (bootstrap).
 * Only works when clinic_users table is empty.
 */
export async function bootstrapAdmin(fullName: string): Promise<{ success: boolean; error?: string }> {
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return { success: false, error: 'Not authenticated' }

  const { error } = await supabase
    .from('clinic_users')
    .insert({
      auth_id: authUser.id,
      email: authUser.email,
      full_name: fullName,
      role: 'admin',
      is_active: true,
    })

  if (error) {
    return { success: false, error: error.message }
  }
  return { success: true }
}

// ─── Sidebar nav items filtered by role ───────────────────────
export interface NavItem {
  href: string
  label: string
  icon: any
  permission?: Permission
}

/**
 * Filter navigation items based on user role
 */
export function filterNavByRole(items: NavItem[], role: UserRole | null): NavItem[] {
  if (!role) return []
  return items.filter(item => {
    if (!item.permission) return true  // no permission required = visible to all
    return hasPermission(role, item.permission)
  })
}
