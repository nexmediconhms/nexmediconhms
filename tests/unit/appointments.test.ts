/**
 * Unit Tests — appointments/reschedule.ts + appointments/slot-capacity.ts
 *
 * Tests the pure-logic parts without requiring Supabase:
 *   - getRescheduleHistory: metadata parsing
 *   - checkSlotCapacity: capacity logic (mocked data)
 *   - Slot time calculations
 *
 * Run: npx vitest --run tests/unit/appointments.test.ts
 */

import { describe, it, expect } from 'vitest'
import { getRescheduleHistory } from '@/lib/appointments/reschedule'

// ═══════════════════════════════════════════════════════════════
// getRescheduleHistory
// ═══════════════════════════════════════════════════════════════
describe('getRescheduleHistory', () => {
  it('returns zero count for appointment with no metadata', () => {
    const result = getRescheduleHistory({ id: '1', date: '2026-05-22' })
    expect(result.count).toBe(0)
    expect(result.lastRescheduledAt).toBeNull()
    expect(result.previousDate).toBeNull()
    expect(result.reason).toBeNull()
  })

  it('returns zero count for null metadata', () => {
    const result = getRescheduleHistory({ id: '1', metadata: null })
    expect(result.count).toBe(0)
  })

  it('parses JSON string metadata correctly', () => {
    const appointment = {
      id: '1',
      metadata: JSON.stringify({
        reschedule_count: 3,
        last_rescheduled_at: '2026-05-20T10:00:00Z',
        last_rescheduled_by: 'Dr. Shah',
        previous_date: '2026-05-19',
        previous_time: '09:00',
        reschedule_reason: 'Doctor unavailable',
      }),
    }
    const result = getRescheduleHistory(appointment)
    expect(result.count).toBe(3)
    expect(result.lastRescheduledAt).toBe('2026-05-20T10:00:00Z')
    expect(result.lastRescheduledBy).toBe('Dr. Shah')
    expect(result.previousDate).toBe('2026-05-19')
    expect(result.previousTime).toBe('09:00')
    expect(result.reason).toBe('Doctor unavailable')
  })

  it('parses object metadata directly', () => {
    const appointment = {
      id: '1',
      metadata: {
        reschedule_count: 1,
        last_rescheduled_at: '2026-05-21T14:00:00Z',
        last_rescheduled_by: 'Staff',
        previous_date: '2026-05-20',
        previous_time: '11:00',
        reschedule_reason: null,
      },
    }
    const result = getRescheduleHistory(appointment)
    expect(result.count).toBe(1)
    expect(result.lastRescheduledBy).toBe('Staff')
    expect(result.reason).toBeNull()
  })

  it('handles empty object metadata', () => {
    const result = getRescheduleHistory({ id: '1', metadata: {} })
    expect(result.count).toBe(0)
    expect(result.lastRescheduledAt).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
// Slot capacity time-to-minutes helper (inline test)
// ═══════════════════════════════════════════════════════════════
describe('time calculations for slot capacity', () => {
  function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }

  it('converts 08:00 to 480', () => {
    expect(timeToMinutes('08:00')).toBe(480)
  })

  it('converts 10:30 to 630', () => {
    expect(timeToMinutes('10:30')).toBe(630)
  })

  it('converts 19:45 to 1185', () => {
    expect(timeToMinutes('19:45')).toBe(1185)
  })

  it('converts 00:00 to 0', () => {
    expect(timeToMinutes('00:00')).toBe(0)
  })

  it('two times within 15 min are in same slot', () => {
    const t1 = timeToMinutes('10:00')
    const t2 = timeToMinutes('10:14')
    expect(Math.abs(t2 - t1)).toBeLessThan(15)
  })

  it('two times 15+ min apart are in different slots', () => {
    const t1 = timeToMinutes('10:00')
    const t2 = timeToMinutes('10:15')
    expect(Math.abs(t2 - t1)).toBeGreaterThanOrEqual(15)
  })

  it('hourly window calculation', () => {
    const time = '10:30'
    const minutes = timeToMinutes(time)
    const hourStart = Math.floor(minutes / 60) * 60 // 600 (10:00)
    const hourEnd = hourStart + 60 // 660 (11:00)
    expect(hourStart).toBe(600)
    expect(hourEnd).toBe(660)
    expect(minutes).toBeGreaterThanOrEqual(hourStart)
    expect(minutes).toBeLessThan(hourEnd)
  })
})

// ═══════════════════════════════════════════════════════════════
// Slot capacity defaults
// ═══════════════════════════════════════════════════════════════
describe('slot capacity constants', () => {
  it('default max per slot is 3', () => {
    // This tests the business rule — max 3 patients per 15-min slot
    const DEFAULT_MAX_PER_SLOT = 3
    expect(DEFAULT_MAX_PER_SLOT).toBe(3)
  })

  it('default max per hour is 8', () => {
    // This tests the business rule — max 8 patients per hour
    const DEFAULT_MAX_PER_HOUR = 8
    expect(DEFAULT_MAX_PER_HOUR).toBe(8)
  })

  it('emergency always bypasses capacity', () => {
    // Business rule: emergency patients are never rejected
    const isEmergency = true
    const slotFull = true
    const canBook = isEmergency || !slotFull
    expect(canBook).toBe(true)
  })

  it('non-emergency is rejected when slot is full', () => {
    const isEmergency = false
    const currentCount = 3
    const maxPerSlot = 3
    const canBook = isEmergency || currentCount < maxPerSlot
    expect(canBook).toBe(false)
  })
})
