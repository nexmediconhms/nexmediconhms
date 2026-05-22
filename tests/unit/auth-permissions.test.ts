/**
 * Unit Tests — auth.ts (Permission Matrix)
 *
 * Covers:
 *   - hasPermission: all roles × all permissions
 *   - Admin has all permissions
 *   - Staff cannot access financial reports
 *   - Doctor cannot manage users
 *   - Inactive user check (null role)
 *   - filterNavByRole
 *
 * Run: npx vitest --run tests/unit/auth-permissions.test.ts
 */

import { describe, it, expect } from 'vitest'
import { hasPermission, filterNavByRole, type Permission, type UserRole } from '@/lib/auth'

// ═══════════════════════════════════════════════════════════════
// hasPermission — Positive Cases (role HAS permission)
// ═══════════════════════════════════════════════════════════════
describe('hasPermission — positive cases', () => {
  it('admin has ALL permissions', () => {
    const adminPerms: Permission[] = [
      'patients.view', 'patients.create', 'patients.edit', 'patients.delete',
      'encounters.view', 'encounters.create', 'encounters.edit',
      'billing.view', 'billing.create',
      'reports.view', 'reports.financial',
      'settings.view', 'settings.edit',
      'users.manage',
      'ipd.view', 'ipd.admit', 'ipd.nursing', 'ipd.discharge',
      'fund.view', 'fund.submit', 'fund.approve',
      'audit.view',
    ]
    for (const perm of adminPerms) {
      expect(hasPermission('admin', perm)).toBe(true)
    }
  })

  it('doctor can view and create encounters', () => {
    expect(hasPermission('doctor', 'encounters.view')).toBe(true)
    expect(hasPermission('doctor', 'encounters.create')).toBe(true)
    expect(hasPermission('doctor', 'encounters.edit')).toBe(true)
  })

  it('doctor can view billing', () => {
    expect(hasPermission('doctor', 'billing.view')).toBe(true)
  })

  it('staff can create patients', () => {
    expect(hasPermission('staff', 'patients.view')).toBe(true)
    expect(hasPermission('staff', 'patients.create')).toBe(true)
    expect(hasPermission('staff', 'patients.edit')).toBe(true)
  })

  it('staff can create bills', () => {
    expect(hasPermission('staff', 'billing.create')).toBe(true)
  })

  it('staff can manage queue', () => {
    expect(hasPermission('staff', 'queue.view')).toBe(true)
    expect(hasPermission('staff', 'queue.manage')).toBe(true)
  })

  it('doctor can discharge IPD patients', () => {
    expect(hasPermission('doctor', 'ipd.discharge')).toBe(true)
  })

  it('staff can admit IPD patients (reception)', () => {
    expect(hasPermission('staff', 'ipd.admit')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// hasPermission — Negative Cases (role LACKS permission)
// ═══════════════════════════════════════════════════════════════
describe('hasPermission — negative cases', () => {
  it('staff CANNOT access financial reports', () => {
    expect(hasPermission('staff', 'reports.financial')).toBe(false)
  })

  it('staff CANNOT edit settings', () => {
    expect(hasPermission('staff', 'settings.edit')).toBe(false)
  })

  it('staff CANNOT manage users', () => {
    expect(hasPermission('staff', 'users.manage')).toBe(false)
  })

  it('staff CANNOT view audit log', () => {
    expect(hasPermission('staff', 'audit.view')).toBe(false)
  })

  it('doctor CANNOT manage users', () => {
    expect(hasPermission('doctor', 'users.manage')).toBe(false)
  })

  it('doctor CANNOT approve fund requests', () => {
    expect(hasPermission('doctor', 'fund.approve')).toBe(false)
  })

  it('staff CANNOT create encounters', () => {
    expect(hasPermission('staff', 'encounters.create')).toBe(false)
  })

  it('staff CANNOT discharge IPD', () => {
    expect(hasPermission('staff', 'ipd.discharge')).toBe(false)
  })

  it('doctor CANNOT delete patients', () => {
    expect(hasPermission('doctor', 'patients.delete')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
// hasPermission — Edge Cases
// ═══════════════════════════════════════════════════════════════
describe('hasPermission — edge cases', () => {
  it('null role returns false for everything', () => {
    expect(hasPermission(null, 'patients.view')).toBe(false)
    expect(hasPermission(null, 'billing.create')).toBe(false)
    expect(hasPermission(null, 'users.manage')).toBe(false)
  })

  it('invalid permission key returns false', () => {
    expect(hasPermission('admin', 'nonexistent.permission' as Permission)).toBe(false)
  })

  it('lab_partner role has limited access', () => {
    // lab_partner is not in most permission arrays
    expect(hasPermission('lab_partner', 'patients.view')).toBe(false)
    expect(hasPermission('lab_partner', 'billing.view')).toBe(false)
    expect(hasPermission('lab_partner', 'encounters.create')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
// filterNavByRole
// ═══════════════════════════════════════════════════════════════
describe('filterNavByRole', () => {
  const mockNavItems = [
    { href: '/dashboard', label: 'Dashboard', icon: null },
    { href: '/patients', label: 'Patients', icon: null, permission: 'patients.view' as Permission },
    { href: '/billing', label: 'Billing', icon: null, permission: 'billing.view' as Permission },
    { href: '/settings', label: 'Settings', icon: null, permission: 'settings.edit' as Permission },
    { href: '/users', label: 'Users', icon: null, permission: 'users.manage' as Permission },
  ]

  it('admin sees all items', () => {
    const filtered = filterNavByRole(mockNavItems, 'admin')
    expect(filtered.length).toBe(5)
  })

  it('doctor sees dashboard, patients, billing but NOT settings/users', () => {
    const filtered = filterNavByRole(mockNavItems, 'doctor')
    expect(filtered.map(i => i.href)).toContain('/dashboard')
    expect(filtered.map(i => i.href)).toContain('/patients')
    expect(filtered.map(i => i.href)).toContain('/billing')
    expect(filtered.map(i => i.href)).not.toContain('/settings')
    expect(filtered.map(i => i.href)).not.toContain('/users')
  })

  it('staff sees dashboard, patients but NOT billing (view) or settings', () => {
    const filtered = filterNavByRole(mockNavItems, 'staff')
    expect(filtered.map(i => i.href)).toContain('/dashboard')
    expect(filtered.map(i => i.href)).toContain('/patients')
    // staff has billing.create but NOT billing.view
    expect(filtered.map(i => i.href)).not.toContain('/billing')
    expect(filtered.map(i => i.href)).not.toContain('/settings')
    expect(filtered.map(i => i.href)).not.toContain('/users')
  })

  it('null role returns empty array', () => {
    const filtered = filterNavByRole(mockNavItems, null)
    expect(filtered.length).toBe(0)
  })

  it('items without permission are visible to all roles', () => {
    const filtered = filterNavByRole(mockNavItems, 'staff')
    expect(filtered.map(i => i.href)).toContain('/dashboard')
  })
})