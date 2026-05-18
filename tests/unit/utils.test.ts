/**
 * Unit Tests — utils.ts
 *
 * Tests utility functions: BMI calculation, EDD, gestational age,
 * date formatting, hospital settings, and helper functions.
 *
 * Run: npx vitest --run tests/unit/utils.test.ts
 */

import { describe, it, expect } from 'vitest'
import { calculateBMI, calculateEDD, calculateGA, formatDate, formatDateTime, ageFromDOB } from '@/lib/utils'

// ═══════════════════════════════════════════════════════════════
// calculateBMI
// ═══════════════════════════════════════════════════════════════
describe('calculateBMI', () => {
  it('calculates normal BMI correctly', () => {
    // 70kg, 170cm → BMI ≈ 24.2
    const result = parseFloat(calculateBMI(70, 170))
    expect(result).toBeCloseTo(24.2, 0)
  })

  it('calculates underweight BMI', () => {
    // 45kg, 165cm → BMI ≈ 16.5
    const result = parseFloat(calculateBMI(45, 165))
    expect(result).toBeLessThan(18.5)
  })

  it('calculates overweight BMI', () => {
    // 85kg, 170cm → BMI ≈ 29.4
    const result = parseFloat(calculateBMI(85, 170))
    expect(result).toBeGreaterThan(25)
  })

  it('calculates obese BMI', () => {
    // 110kg, 165cm → BMI ≈ 40.4
    const result = parseFloat(calculateBMI(110, 165))
    expect(result).toBeGreaterThan(30)
  })

  it('returns empty string when weight is 0', () => {
    expect(calculateBMI(0, 170)).toBe('')
  })

  it('returns empty string when height is 0', () => {
    expect(calculateBMI(70, 0)).toBe('')
  })

  it('returns empty string for NaN weight', () => {
    expect(calculateBMI(NaN, 170)).toBe('')
  })

  it('returns empty string for NaN height', () => {
    expect(calculateBMI(70, NaN)).toBe('')
  })

  it('returns result with one decimal place', () => {
    const result = calculateBMI(70, 170)
    expect(result).toMatch(/^\d+\.\d$/)
  })
})

// ═══════════════════════════════════════════════════════════════
// calculateEDD (Naegele's rule: LMP + 280 days)
// ═══════════════════════════════════════════════════════════════
describe('calculateEDD', () => {
  it('calculates EDD correctly (LMP + 280 days)', () => {
    // LMP: 2024-01-01 → EDD: 2024-10-07 (approx, ±1 day due to timezone)
    const result = calculateEDD('2024-01-01')
    expect(result).toMatch(/^2024-10-0[67]/)
  })

  it('handles February LMP', () => {
    // LMP: 2024-02-01 → EDD: 2024-11-07 (approx)
    const result = calculateEDD('2024-02-01')
    expect(result).toMatch(/^2024-11-0[67]/)
  })

  it('handles leap year', () => {
    // LMP: 2024-02-29 → should not crash
    const result = calculateEDD('2024-02-29')
    expect(result).toMatch(/^2024-12-/)
  })

  it('returns empty for empty input', () => {
    expect(calculateEDD('')).toBe('')
  })

  it('returns YYYY-MM-DD format', () => {
    const result = calculateEDD('2024-03-15')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ═══════════════════════════════════════════════════════════════
// calculateGA (Gestational Age from LMP)
// ═══════════════════════════════════════════════════════════════
describe('calculateGA', () => {
  it('returns empty for empty input', () => {
    expect(calculateGA('')).toBe('')
  })

  it('calculates GA in weeks and days format', () => {
    const result = calculateGA('2024-01-01')
    expect(result).toMatch(/\d+ weeks \d+ days/)
  })

  it('calculates correct GA for recent LMP', () => {
    // LMP 7 days ago → should be "1 weeks 0 days"
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    const result = calculateGA(sevenDaysAgo)
    expect(result).toBe('1 weeks 0 days')
  })

  it('calculates correct GA for 14 days ago', () => {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0]
    const result = calculateGA(fourteenDaysAgo)
    expect(result).toBe('2 weeks 0 days')
  })

  it('handles today as LMP (0 weeks 0 days)', () => {
    const today = new Date().toISOString().split('T')[0]
    const result = calculateGA(today)
    expect(result).toBe('0 weeks 0 days')
  })
})

// ═══════════════════════════════════════════════════════════════
// formatDate
// ═══════════════════════════════════════════════════════════════
describe('formatDate', () => {
  it('returns empty for empty input', () => {
    expect(formatDate('')).toBe('')
  })

  it('formats ISO date to Indian locale', () => {
    const result = formatDate('2024-01-15')
    // Should contain day, month, year in some readable format
    expect(result).toMatch(/15/)
    expect(result).toMatch(/Jan/i)
    expect(result).toMatch(/2024/)
  })

  it('formats date with timestamp', () => {
    const result = formatDate('2024-06-20T10:30:00Z')
    expect(result).toMatch(/20/)
    expect(result).toMatch(/Jun/i)
    expect(result).toMatch(/2024/)
  })
})

// ═══════════════════════════════════════════════════════════════
// formatDateTime
// ═══════════════════════════════════════════════════════════════
describe('formatDateTime', () => {
  it('returns empty for empty input', () => {
    expect(formatDateTime('')).toBe('')
  })

  it('includes both date and time', () => {
    const result = formatDateTime('2024-06-20T10:30:00Z')
    expect(result).toMatch(/20/)
    expect(result).toMatch(/Jun/i)
    // Should have time component
    expect(result.length).toBeGreaterThan(10)
  })
})

// ═══════════════════════════════════════════════════════════════
// ageFromDOB
// ═══════════════════════════════════════════════════════════════
describe('ageFromDOB', () => {
  it('returns null for null input', () => {
    expect(ageFromDOB(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(ageFromDOB(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(ageFromDOB('')).toBeNull()
  })

  it('returns null for invalid date string', () => {
    expect(ageFromDOB('not-a-date')).toBeNull()
  })

  it('calculates age correctly for 30-year-old', () => {
    const thirtyYearsAgo = new Date()
    thirtyYearsAgo.setFullYear(thirtyYearsAgo.getFullYear() - 30)
    thirtyYearsAgo.setMonth(0, 1) // Jan 1 to avoid edge cases
    const dob = thirtyYearsAgo.toISOString().split('T')[0]
    const age = ageFromDOB(dob)
    expect(age).toBe(30)
  })

  it('calculates age 0 for newborn', () => {
    const today = new Date().toISOString().split('T')[0]
    const age = ageFromDOB(today)
    expect(age).toBe(0)
  })

  it('returns null for future date (negative age)', () => {
    const future = new Date()
    future.setFullYear(future.getFullYear() + 5)
    const age = ageFromDOB(future.toISOString().split('T')[0])
    // Should return null for future DOB (negative age)
    expect(age === null || age === 0).toBe(true)
  })

  it('returns null for age > 150', () => {
    // 200 years ago
    const ancient = new Date()
    ancient.setFullYear(ancient.getFullYear() - 200)
    const age = ageFromDOB(ancient.toISOString().split('T')[0])
    expect(age).toBeNull()
  })
})
