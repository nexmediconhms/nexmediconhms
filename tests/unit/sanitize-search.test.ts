/**
 * tests/unit/sanitize-search.test.ts
 * 
 * Unit tests for the SQL pattern injection sanitizer.
 * These tests ensure Bug #9 (SQL injection via ilike) stays FIXED
 * even as the codebase evolves.
 * 
 * Run with: npx vitest --run tests/unit/sanitize-search.test.ts
 */

import { describe, it, expect } from 'vitest'
import { sanitizeSearchInput } from '@/lib/sanitize-search'

describe('sanitizeSearchInput', () => {
  // ═══════════════════════════════════════════════════════════════
  // POSITIVE CASES: Normal inputs pass through unchanged
  // ═══════════════════════════════════════════════════════════════

  it('passes normal English text unchanged', () => {
    expect(sanitizeSearchInput('Priya Sharma')).toBe('Priya Sharma')
  })

  it('passes phone numbers unchanged', () => {
    expect(sanitizeSearchInput('9876543210')).toBe('9876543210')
  })

  it('passes MRN codes unchanged', () => {
    expect(sanitizeSearchInput('MRN00123')).toBe('MRN00123')
  })

  it('passes Gujarati text unchanged', () => {
    expect(sanitizeSearchInput('પ્રિયા શર્મા')).toBe('પ્રિયા શર્મા')
  })

  it('passes Hindi text unchanged', () => {
    expect(sanitizeSearchInput('प्रिया शर्मा')).toBe('प्रिया शर्मा')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeSearchInput('')).toBe('')
  })

  it('returns empty string for undefined-like input', () => {
    // @ts-expect-error testing runtime safety
    expect(sanitizeSearchInput(undefined)).toBe('')
    // @ts-expect-error testing runtime safety
    expect(sanitizeSearchInput(null)).toBe('')
  })

  // ═══════════════════════════════════════════════════════════════
  // NEGATIVE CASES: Dangerous patterns are escaped
  // ═══════════════════════════════════════════════════════════════

  it('escapes % wildcard (matches any sequence)', () => {
    expect(sanitizeSearchInput('%')).toBe('\\%')
  })

  it('escapes % within text', () => {
    expect(sanitizeSearchInput('100%')).toBe('100\\%')
    expect(sanitizeSearchInput('Dr. 100% sure')).toBe('Dr. 100\\% sure')
  })

  it('escapes _ wildcard (matches single character)', () => {
    expect(sanitizeSearchInput('_')).toBe('\\_')
    expect(sanitizeSearchInput('test_user')).toBe('test\\_user')
  })

  it('escapes backslash (escape character itself)', () => {
    expect(sanitizeSearchInput('\\')).toBe('\\\\')
    expect(sanitizeSearchInput('path\\file')).toBe('path\\\\file')
  })

  it('escapes multiple special characters together', () => {
    expect(sanitizeSearchInput('%_\\')).toBe('\\%\\_\\\\')
  })

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASES: Real-world attack patterns
  // ═══════════════════════════════════════════════════════════════

  it('neutralizes "show all records" attack (%)', () => {
    // Attacker types just "%" in search to bypass limit and see all patients
    const result = sanitizeSearchInput('%')
    expect(result).toBe('\\%')
    // When used in query: ilike.%\%% — matches only rows containing literal %
  })

  it('neutralizes wildcard scanning (_____)', () => {
    // Attacker types underscores to enumerate patients by name length
    const result = sanitizeSearchInput('_____')
    expect(result).toBe('\\_\\_\\_\\_\\_')
  })

  it('handles combination injection attempt', () => {
    const result = sanitizeSearchInput('%admin%')
    expect(result).toBe('\\%admin\\%')
  })

  it('preserves spaces and normal punctuation', () => {
    expect(sanitizeSearchInput('Dr. R.K. Patel (OBG)')).toBe('Dr. R.K. Patel (OBG)')
  })
})
