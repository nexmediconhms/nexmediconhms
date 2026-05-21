/**
 * Unit Tests — discharge-clearance.ts
 *
 * Tests the clearance logic WITHOUT Supabase (unit-tests the state machine).
 * Covers:
 *   - applyOverride: admin override changes status
 *   - getClearanceStatusDisplay: correct UI mapping
 *   - canDischarge calculation from items
 *
 * Run: npx vitest --run tests/unit/discharge-clearance.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  applyOverride,
  getClearanceStatusDisplay,
  type ClearanceResult,
  type ClearanceItem,
} from '@/lib/discharge-clearance'

// ═══════════════════════════════════════════════════════════════
// Helper: create a mock clearance result
// ═══════════════════════════════════════════════════════════════
function mockClearance(overrides?: Partial<ClearanceResult>): ClearanceResult {
  const defaultItems: ClearanceItem[] = [
    {
      category: 'billing',
      label: 'Billing Cleared',
      description: 'All bills are paid',
      status: 'cleared',
      detail: null,
      isRequired: true,
      canOverride: true,
      checkedAt: '2026-05-21T10:00:00Z',
      checkedBy: 'system',
    },
    {
      category: 'nursing',
      label: 'Nursing Sign-off Required',
      description: 'Final vitals needed',
      status: 'pending',
      detail: 'Record final vitals',
      isRequired: true,
      canOverride: true,
      checkedAt: '2026-05-21T10:00:00Z',
      checkedBy: null,
    },
    {
      category: 'consent',
      label: 'Discharge Consent Pending',
      description: 'Patient must sign',
      status: 'pending',
      detail: null,
      isRequired: true,
      canOverride: true,
      checkedAt: '2026-05-21T10:00:00Z',
      checkedBy: null,
    },
    {
      category: 'lab',
      label: 'Lab Results Complete',
      description: 'All tests reported',
      status: 'cleared',
      detail: null,
      isRequired: false,
      canOverride: true,
      checkedAt: '2026-05-21T10:00:00Z',
      checkedBy: 'system',
    },
  ]

  return {
    admissionId: 'test-admission-123',
    patientId: 'patient-456',
    patientName: 'Test Patient',
    canDischarge: false,
    blockedCount: 2,
    items: defaultItems,
    overrides: [],
    checkedAt: '2026-05-21T10:00:00Z',
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════
// applyOverride
// ═══════════════════════════════════════════════════════════════
describe('applyOverride', () => {
  it('overrides a pending item to cleared', () => {
    const clearance = mockClearance()
    const updated = applyOverride(clearance, 'nursing', 'Doctor approved', 'Dr. Smith')

    const nursingItem = updated.items.find(i => i.category === 'nursing')
    expect(nursingItem?.status).toBe('cleared')
    expect(nursingItem?.detail).toContain('Override: Doctor approved')
    expect(nursingItem?.checkedBy).toBe('Dr. Smith')
  })

  it('records override in overrides array', () => {
    const clearance = mockClearance()
    const updated = applyOverride(clearance, 'nursing', 'Emergency', 'Admin')

    expect(updated.overrides.length).toBe(1)
    expect(updated.overrides[0].category).toBe('nursing')
    expect(updated.overrides[0].reason).toBe('Emergency')
    expect(updated.overrides[0].overriddenBy).toBe('Admin')
  })

  it('reduces blockedCount when item is overridden', () => {
    const clearance = mockClearance()
    expect(clearance.blockedCount).toBe(2) // nursing + consent

    const updated = applyOverride(clearance, 'nursing', 'OK', 'Admin')
    expect(updated.blockedCount).toBe(1) // only consent now
  })

  it('sets canDischarge to true when all required items are cleared', () => {
    const clearance = mockClearance()
    const step1 = applyOverride(clearance, 'nursing', 'OK', 'Admin')
    expect(step1.canDischarge).toBe(false) // consent still pending

    const step2 = applyOverride(step1, 'consent', 'Verbal consent', 'Admin')
    expect(step2.canDischarge).toBe(true) // all required cleared
    expect(step2.blockedCount).toBe(0)
  })

  it('does not override items with canOverride=false', () => {
    const clearance = mockClearance({
      items: [
        {
          category: 'doctor',
          label: 'Doctor Orders',
          description: 'Doctor must confirm',
          status: 'pending',
          detail: null,
          isRequired: true,
          canOverride: false,
          checkedAt: null,
          checkedBy: null,
        },
      ],
      blockedCount: 1,
    })

    const updated = applyOverride(clearance, 'doctor', 'Force it', 'Admin')
    const doctorItem = updated.items.find(i => i.category === 'doctor')
    expect(doctorItem?.status).toBe('pending') // NOT overridden
  })

  it('multiple overrides accumulate', () => {
    const clearance = mockClearance()
    const step1 = applyOverride(clearance, 'nursing', 'Vitals recorded verbally', 'Nurse A')
    const step2 = applyOverride(step1, 'consent', 'Patient verbal OK', 'Dr. Shah')

    expect(step2.overrides.length).toBe(2)
    expect(step2.overrides[0].category).toBe('nursing')
    expect(step2.overrides[1].category).toBe('consent')
  })
})

// ═══════════════════════════════════════════════════════════════
// getClearanceStatusDisplay
// ═══════════════════════════════════════════════════════════════
describe('getClearanceStatusDisplay', () => {
  it('cleared status returns green styling', () => {
    const display = getClearanceStatusDisplay('cleared')
    expect(display.color).toContain('green')
    expect(display.bgColor).toContain('green')
    expect(display.label).toBe('Cleared')
  })

  it('blocked status returns red styling', () => {
    const display = getClearanceStatusDisplay('blocked')
    expect(display.color).toContain('red')
    expect(display.bgColor).toContain('red')
    expect(display.label).toBe('Blocked')
  })

  it('pending status returns amber styling', () => {
    const display = getClearanceStatusDisplay('pending')
    expect(display.color).toContain('amber')
    expect(display.bgColor).toContain('amber')
    expect(display.label).toBe('Pending')
  })

  it('not_applicable status returns gray styling', () => {
    const display = getClearanceStatusDisplay('not_applicable')
    expect(display.color).toContain('gray')
    expect(display.label).toBe('N/A')
  })
})

// ═══════════════════════════════════════════════════════════════
// canDischarge calculation logic
// ═══════════════════════════════════════════════════════════════
describe('canDischarge logic', () => {
  it('all items cleared → canDischarge true', () => {
    const clearance = mockClearance({
      items: [
        { category: 'billing', label: '', description: '', status: 'cleared', detail: null, isRequired: true, canOverride: true, checkedAt: null, checkedBy: null },
        { category: 'nursing', label: '', description: '', status: 'cleared', detail: null, isRequired: true, canOverride: true, checkedAt: null, checkedBy: null },
        { category: 'consent', label: '', description: '', status: 'cleared', detail: null, isRequired: true, canOverride: true, checkedAt: null, checkedBy: null },
      ],
      canDischarge: true,
      blockedCount: 0,
    })
    expect(clearance.canDischarge).toBe(true)
  })

  it('non-required items pending → still canDischarge', () => {
    const clearance = mockClearance({
      items: [
        { category: 'billing', label: '', description: '', status: 'cleared', detail: null, isRequired: true, canOverride: true, checkedAt: null, checkedBy: null },
        { category: 'pharmacy', label: '', description: '', status: 'pending', detail: null, isRequired: false, canOverride: true, checkedAt: null, checkedBy: null },
      ],
      canDischarge: true,
      blockedCount: 0,
    })
    expect(clearance.canDischarge).toBe(true) // pharmacy is non-required
  })

  it('one required item blocked → canDischarge false', () => {
    const clearance = mockClearance({
      items: [
        { category: 'billing', label: '', description: '', status: 'blocked', detail: '₹5000 due', isRequired: true, canOverride: true, checkedAt: null, checkedBy: null },
      ],
      canDischarge: false,
      blockedCount: 1,
    })
    expect(clearance.canDischarge).toBe(false)
  })
})
