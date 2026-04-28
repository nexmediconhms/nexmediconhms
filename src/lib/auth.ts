/**
 * src/lib/auth.ts  (UPDATED)
 *
 * Auth & Role Management — includes:
 *  - New permissions for IPD, video, fund, portal
 *  - Multi-doctor support (doctors have individual profiles)
 *  - Fixed: staff cannot access financial reports (was missing in original)
 *  - Fixed: billing.create allowed for staff but not view-only for doctor (corrected)
 */

import { createContext, useContext } from 'react'
import { supabase } from './supabase'

// ─── Types ────────────────────────────────────────────────────
export type UserRole = 'admin' | 'doctor' | 'staff'

export interface ClinicUser {
  id:        string
  auth_id:   string
  email:     string
  full_name: string
  role:      UserRole
  is_active: boolean
  phone?:    string
  /** Doctor-specific: specialty, registration no. */
  specialty?:    string
  med_reg_no?:   string
}

// ─── React Context ────────────────────────────────────────────
export interface AuthContextType {
  user:      ClinicUser | null
  loading:   boolean
  isAdmin:   boolean
  isDoctor:  boolean
  isStaff:   boolean
  can:       (permission: Permission) => boolean
  reload:    () => Promise<void>
}

const defaultCtx: AuthContextType = {
  user:     null,
  loading:  true,
  isAdmin:  false,
  isDoctor: false,
  isStaff:  false,
  can:      () => false,
  reload:   async () => {},
}

export const AuthContext = createContext<AuthContextType>(defaultCtx)
export const useAuth     = () => useContext(AuthContext)

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
  // ── NEW permissions ──────────────────────────────────────────
  | 'ipd.view'
  | 'ipd.admit'
  | 'ipd.nursing'
  | 'ipd.discharge'
  | 'video.view'
  | 'video.manage'
  | 'fund.view'
  | 'fund.submit'
  | 'fund.approve'
  | 'portal.send'
  | 'audit.view'

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

  // FIX: doctor should be able to VIEW billing (not create — that's reception)
  'billing.view':         ['admin', 'doctor', 'staff'],
  'billing.create':       ['admin', 'staff'],

  'reports.view':         ['admin', 'doctor'],
  'reports.financial':    ['admin'],           // FIX: staff removed — finance is admin-only

  'settings.view':        ['admin', 'doctor', 'staff'],
  'settings.edit':        ['admin'],           // FIX: only admin should edit settings

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

  // ── IPD ────────────────────────────────────────────────────
  'ipd.view':             ['admin', 'doctor', 'staff'],
  'ipd.admit':            ['admin', 'doctor', 'staff'],  // reception can admit
  'ipd.nursing':          ['admin', 'doctor', 'staff'],  // nurses = staff role
  'ipd.discharge':        ['admin', 'doctor'],           // doctors discharge

  // ── Video consultations ─────────────────────────────────────
  'video.view':           ['admin', 'doctor', 'staff'],
  'video.manage':         ['admin', 'doctor'],           // create/delete slots

  // ── Hospital Fund ──────────────────────────────────────────
  'fund.view':            ['admin', 'doctor', 'staff'],
  'fund.submit':          ['admin', 'doctor', 'staff'],  // anyone can submit expense
  'fund.approve':         ['admin'],                     // only admin approves

  // ── Patient Portal ────────────────────────────────────────
  'portal.send':          ['admin', 'doctor', 'staff'],  // send magic links

  // ── Audit ─────────────────────────────────────────────────
  'audit.view':           ['admin'],                     // only admin can view audit log
}

export function hasPermission(role: UserRole | null, permission: Permission): boolean {
  if (!role) return false
  return PERMISSIONS[permission]?.includes(role) ?? false
}

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
    id:          data.id,
    auth_id:     data.auth_id,
    email:       data.email,
    full_name:   data.full_name,
    role:        data.role as UserRole,
    is_active:   data.is_active,
    phone:       data.phone,
    specialty:   data.specialty,
    med_reg_no:  data.med_reg_no,
  }
}

export async function isFirstTimeSetup(): Promise<boolean> {
  const { count, error } = await supabase
    .from('clinic_users')
    .select('id', { count: 'exact', head: true })
  if (error) return false
  return (count ?? 0) === 0
}

export async function bootstrapAdmin(fullName: string): Promise<{ success: boolean; error?: string }> {
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return { success: false, error: 'Not authenticated' }

  const { error } = await supabase
    .from('clinic_users')
    .insert({
      auth_id:   authUser.id,
      email:     authUser.email,
      full_name: fullName,
      role:      'admin',
      is_active: true,
    })

  if (error) return { success: false, error: error.message }
  return { success: true }
}

// ─── Nav items ────────────────────────────────────────────────
export interface NavItem {
  href:        string
  label:       string
  icon:        any
  permission?: Permission
}

export function filterNavByRole(items: NavItem[], role: UserRole | null): NavItem[] {
  if (!role) return []
  return items.filter(item => {
    if (!item.permission) return true
    return hasPermission(role, item.permission)
  })
}