/**
 * tests/unit/date-utils.test.ts
 * 
 * Unit tests for IST date utilities.
 * These tests ensure Bug #19 (UTC vs IST date) stays FIXED.
 * 
 * The key insight: between midnight and 5:30 AM IST, the UTC date
 * is YESTERDAY. Our getTodayIST() must always return the Indian date.
 * 
 * Run with: npx vitest --run tests/unit/date-utils.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getTodayIST, toISTDateString, getISTDayBoundsUTC, getTomorrowIST, isTodayIST } from '@/lib/date-utils'

describe('getTodayIST', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns correct IST date at 2:00 AM IST (when UTC is still yesterday)', () => {
    // 2:00 AM IST on Jan 15 = 8:30 PM UTC on Jan 14
    vi.setSystemTime(new Date('2025-01-14T20:30:00.000Z'))
    expect(getTodayIST()).toBe('2025-01-15')
  })

  it('returns correct IST date at 5:29 AM IST (edge case: last minute before UTC catches up)', () => {
    // 5:29 AM IST on Jan 15 = 11:59 PM UTC on Jan 14
    vi.setSystemTime(new Date('2025-01-14T23:59:00.000Z'))
    expect(getTodayIST()).toBe('2025-01-15')
  })

  it('returns correct IST date at 5:30 AM IST (UTC date matches)', () => {
    // 5:30 AM IST on Jan 15 = 12:00 AM UTC on Jan 15
    vi.setSystemTime(new Date('2025-01-15T00:00:00.000Z'))
    expect(getTodayIST()).toBe('2025-01-15')
  })

  it('returns correct IST date at noon IST', () => {
    // 12:00 PM IST on Jan 15 = 6:30 AM UTC on Jan 15
    vi.setSystemTime(new Date('2025-01-15T06:30:00.000Z'))
    expect(getTodayIST()).toBe('2025-01-15')
  })

  it('returns correct IST date at 11:59 PM IST', () => {
    // 11:59 PM IST on Jan 15 = 6:29 PM UTC on Jan 15
    vi.setSystemTime(new Date('2025-01-15T18:29:00.000Z'))
    expect(getTodayIST()).toBe('2025-01-15')
  })

  it('rolls over to next day at IST midnight', () => {
    // 12:00 AM IST on Jan 16 = 6:30 PM UTC on Jan 15
    vi.setSystemTime(new Date('2025-01-15T18:30:00.000Z'))
    expect(getTodayIST()).toBe('2025-01-16')
  })
})

describe('getISTDayBoundsUTC', () => {
  it('returns correct UTC bounds for a given IST date', () => {
    const bounds = getISTDayBoundsUTC('2025-01-15')
    
    // Midnight IST = 18:30 UTC previous day
    expect(bounds.start).toBe('2025-01-14T18:30:00.000Z')
    // Next midnight IST = 18:30 UTC same day
    expect(bounds.end).toBe('2025-01-15T18:30:00.000Z')
  })

  it('start and end are exactly 24 hours apart', () => {
    const bounds = getISTDayBoundsUTC('2025-06-20')
    const startMs = new Date(bounds.start).getTime()
    const endMs = new Date(bounds.end).getTime()
    expect(endMs - startMs).toBe(24 * 60 * 60 * 1000)
  })
})

describe('getTomorrowIST', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns tomorrow in IST when today IST is Jan 15', () => {
    vi.setSystemTime(new Date('2025-01-15T06:30:00.000Z')) // Noon IST Jan 15
    expect(getTomorrowIST()).toBe('2025-01-16')
  })

  it('handles month boundary correctly', () => {
    vi.setSystemTime(new Date('2025-01-31T06:30:00.000Z')) // Noon IST Jan 31
    expect(getTomorrowIST()).toBe('2025-02-01')
  })
})

describe('isTodayIST', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns true for today date string', () => {
    vi.setSystemTime(new Date('2025-01-15T06:30:00.000Z'))
    expect(isTodayIST('2025-01-15')).toBe(true)
  })

  it('returns false for yesterday', () => {
    vi.setSystemTime(new Date('2025-01-15T06:30:00.000Z'))
    expect(isTodayIST('2025-01-14')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isTodayIST('')).toBe(false)
  })
})
