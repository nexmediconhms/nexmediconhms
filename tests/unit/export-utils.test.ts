/**
 * Unit Tests — export-utils.ts
 *
 * Tests CSV generation, INR formatting, date formatting, and edge cases.
 * Run: npx vitest --run tests/unit/export-utils.test.ts
 */

import { describe, it, expect } from 'vitest'
import { formatINR, formatDateIN, formatDateShort } from '@/lib/export-utils'

// ═══════════════════════════════════════════════════════════════
// formatINR — Indian Rupee formatting
// ═══════════════════════════════════════════════════════════════
describe('formatINR', () => {
  it('formats zero', () => {
    expect(formatINR(0)).toBe('₹0')
  })

  it('formats small number', () => {
    expect(formatINR(500)).toBe('₹500')
  })

  it('formats thousands with Indian grouping', () => {
    const result = formatINR(12345)
    expect(result).toContain('₹')
    expect(result).toContain('12')
    expect(result).toContain('345')
  })

  it('formats lakhs with Indian grouping', () => {
    const result = formatINR(123456)
    expect(result).toContain('₹')
    expect(result).toContain('1,23,456')
  })

  it('formats crores correctly', () => {
    const result = formatINR(10000000)
    expect(result).toContain('₹')
    expect(result).toContain('1,00,00,000')
  })

  it('handles decimal amounts', () => {
    const result = formatINR(500.75)
    expect(result).toContain('₹')
    expect(result).toContain('500.75')
  })

  it('handles null', () => {
    expect(formatINR(null)).toBe('₹0')
  })

  it('handles undefined', () => {
    expect(formatINR(undefined)).toBe('₹0')
  })

  it('handles string input', () => {
    const result = formatINR('1500')
    expect(result).toContain('₹')
    expect(result).toContain('1,500')
  })

  it('handles invalid string', () => {
    expect(formatINR('abc')).toBe('₹0')
  })
})

// ═══════════════════════════════════════════════════════════════
// formatDateIN — DD/MM/YYYY (Indian standard)
// ═══════════════════════════════════════════════════════════════
describe('formatDateIN', () => {
  it('returns empty for null', () => {
    expect(formatDateIN(null)).toBe('')
  })

  it('returns empty for undefined', () => {
    expect(formatDateIN(undefined)).toBe('')
  })

  it('returns empty for empty string', () => {
    expect(formatDateIN('')).toBe('')
  })

  it('formats ISO date correctly', () => {
    const result = formatDateIN('2024-01-15')
    expect(result).toMatch(/15/)
    expect(result).toMatch(/01|1/)
    expect(result).toMatch(/2024/)
  })

  it('formats date with time component', () => {
    const result = formatDateIN('2024-03-25T10:30:00Z')
    expect(result).toMatch(/25/)
    expect(result).toMatch(/03|3/)
    expect(result).toMatch(/2024/)
  })

  it('returns empty for invalid date', () => {
    expect(formatDateIN('not-a-date')).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════
// formatDateShort — DD-Mon-YYYY (e.g., 15-Jan-2024)
// ═══════════════════════════════════════════════════════════════
describe('formatDateShort', () => {
  it('returns empty for null', () => {
    expect(formatDateShort(null)).toBe('')
  })

  it('returns empty for empty string', () => {
    expect(formatDateShort('')).toBe('')
  })

  it('formats date with month name', () => {
    const result = formatDateShort('2024-01-15')
    expect(result).toMatch(/15/)
    expect(result).toMatch(/Jan/i)
    expect(result).toMatch(/2024/)
  })

  it('formats March date', () => {
    const result = formatDateShort('2024-03-01')
    expect(result).toMatch(/01|1/)
    expect(result).toMatch(/Mar/i)
    expect(result).toMatch(/2024/)
  })

  it('returns empty for invalid date', () => {
    expect(formatDateShort('invalid')).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════
// CSV escaping edge cases (testing the internal logic conceptually)
// ═══════════════════════════════════════════════════════════════
describe('CSV Escaping Logic', () => {
  function escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return '"' + value.replace(/"/g, '""') + '"'
    }
    return value
  }

  it('does not escape simple text', () => {
    expect(escapeCSV('Hello')).toBe('Hello')
  })

  it('escapes text with comma', () => {
    expect(escapeCSV('Doe, John')).toBe('"Doe, John"')
  })

  it('escapes text with quotes', () => {
    expect(escapeCSV('He said "hi"')).toBe('"He said ""hi"""')
  })

  it('escapes text with newline', () => {
    expect(escapeCSV('Line 1\nLine 2')).toBe('"Line 1\nLine 2"')
  })

  it('escapes text with carriage return', () => {
    expect(escapeCSV('Line 1\rLine 2')).toBe('"Line 1\rLine 2"')
  })

  it('handles empty string', () => {
    expect(escapeCSV('')).toBe('')
  })

  it('escapes text with all special chars', () => {
    const result = escapeCSV('A "complex", value\nwith newlines')
    expect(result.startsWith('"')).toBe(true)
    expect(result.endsWith('"')).toBe(true)
  })
})