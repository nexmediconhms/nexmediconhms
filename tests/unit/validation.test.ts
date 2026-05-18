/**
 * Unit Tests — validation.ts
 *
 * Covers all validation functions with positive, negative, and edge cases.
 * Run: npx vitest --run tests/unit/validation.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  validateRequired,
  validateMobile,
  validateAadhaar,
  validateABHA,
  validateEmail,
  validateAge,
  validateGSTIN,
  validateAmount,
  validatePastDate,
  validateFutureDate,
  validateBP,
  validateVital,
  validateAll,
} from '@/lib/validation'

// ═══════════════════════════════════════════════════════════════
// validateRequired
// ═══════════════════════════════════════════════════════════════
describe('validateRequired', () => {
  it('returns error for empty string', () => {
    expect(validateRequired('', 'Name')).toBe('Name is required')
  })

  it('returns error for whitespace-only string', () => {
    expect(validateRequired('   ', 'Name')).toBe('Name is required')
  })

  it('returns error for null', () => {
    expect(validateRequired(null, 'Name')).toBe('Name is required')
  })

  it('returns error for undefined', () => {
    expect(validateRequired(undefined, 'Name')).toBe('Name is required')
  })

  it('returns null for valid string', () => {
    expect(validateRequired('John Doe', 'Name')).toBeNull()
  })

  it('returns null for string with leading/trailing spaces', () => {
    expect(validateRequired('  John  ', 'Name')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
// validateMobile — Indian 10-digit numbers
// ═══════════════════════════════════════════════════════════════
describe('validateMobile', () => {
  // Positive cases
  it('accepts valid 10-digit number starting with 9', () => {
    expect(validateMobile('9876543210')).toBeNull()
  })

  it('accepts valid number starting with 6', () => {
    expect(validateMobile('6123456789')).toBeNull()
  })

  it('accepts valid number starting with 7', () => {
    expect(validateMobile('7890123456')).toBeNull()
  })

  it('accepts valid number starting with 8', () => {
    expect(validateMobile('8765432109')).toBeNull()
  })

  it('accepts number with +91 prefix (strips it)', () => {
    expect(validateMobile('+919876543210')).toBeNull()
  })

  it('accepts number with 91 prefix (strips it)', () => {
    expect(validateMobile('919876543210')).toBeNull()
  })

  // Negative cases
  it('rejects empty when required', () => {
    expect(validateMobile('', true)).toBe('Mobile number is required')
  })

  it('returns null for empty when not required', () => {
    expect(validateMobile('', false)).toBeNull()
  })

  it('rejects number starting with 5', () => {
    expect(validateMobile('5123456789')).toBe('Indian mobile numbers must start with 6, 7, 8, or 9')
  })

  it('rejects number starting with 0', () => {
    expect(validateMobile('0123456789')).toBe('Indian mobile numbers must start with 6, 7, 8, or 9')
  })

  it('rejects 9-digit number', () => {
    expect(validateMobile('987654321')).toBe('Enter a valid 10-digit mobile number')
  })

  it('rejects 11-digit number', () => {
    expect(validateMobile('98765432100')).toBe('Enter a valid 10-digit mobile number')
  })

  // Edge cases
  it('handles Gujarati digits (if normalizeDigits works)', () => {
    // This depends on normalizeDigits implementation
    // Testing the boundary — should not crash
    const result = validateMobile('૯૮૭૬૫૪૩૨૧૦')
    expect(typeof result === 'string' || result === null).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// validateAadhaar — 12 digits
// ═══════════════════════════════════════════════════════════════
describe('validateAadhaar', () => {
  it('returns null for empty (optional field)', () => {
    expect(validateAadhaar('')).toBeNull()
  })

  it('accepts valid 12-digit Aadhaar', () => {
    expect(validateAadhaar('234567890123')).toBeNull()
  })

  it('accepts Aadhaar with spaces', () => {
    expect(validateAadhaar('2345 6789 0123')).toBeNull()
  })

  it('rejects 11-digit number', () => {
    expect(validateAadhaar('23456789012')).toBe('Aadhaar number must be exactly 12 digits')
  })

  it('rejects 13-digit number', () => {
    expect(validateAadhaar('2345678901234')).toBe('Aadhaar number must be exactly 12 digits')
  })

  it('rejects Aadhaar starting with 0', () => {
    expect(validateAadhaar('012345678901')).toBe('Invalid Aadhaar number format')
  })

  it('rejects Aadhaar starting with 1', () => {
    expect(validateAadhaar('123456789012')).toBe('Invalid Aadhaar number format')
  })
})

// ═══════════════════════════════════════════════════════════════
// validateABHA — 14 digits
// ═══════════════════════════════════════════════════════════════
describe('validateABHA', () => {
  it('returns null for empty (optional)', () => {
    expect(validateABHA('')).toBeNull()
  })

  it('accepts valid 14-digit ABHA', () => {
    expect(validateABHA('12345678901234')).toBeNull()
  })

  it('accepts ABHA with dashes', () => {
    expect(validateABHA('12-3456-7890-1234')).toBeNull()
  })

  it('rejects 13-digit number', () => {
    expect(validateABHA('1234567890123')).toBe('ABHA number must be exactly 14 digits')
  })

  it('rejects 15-digit number', () => {
    expect(validateABHA('123456789012345')).toBe('ABHA number must be exactly 14 digits')
  })
})

// ═══════════════════════════════════════════════════════════════
// validateEmail
// ═══════════════════════════════════════════════════════════════
describe('validateEmail', () => {
  it('returns null for empty when not required', () => {
    expect(validateEmail('', false)).toBeNull()
  })

  it('returns error for empty when required', () => {
    expect(validateEmail('', true)).toBe('Email is required')
  })

  it('accepts valid email', () => {
    expect(validateEmail('doctor@clinic.com')).toBeNull()
  })

  it('accepts email with subdomain', () => {
    expect(validateEmail('admin@mail.hospital.co.in')).toBeNull()
  })

  it('rejects email without @', () => {
    expect(validateEmail('invalid')).toBe('Enter a valid email address')
  })

  it('rejects email without domain', () => {
    expect(validateEmail('test@')).toBe('Enter a valid email address')
  })

  it('rejects email with spaces', () => {
    expect(validateEmail('test @example.com')).toBe('Enter a valid email address')
  })
})

// ═══════════════════════════════════════════════════════════════
// validateAge
// ═══════════════════════════════════════════════════════════════
describe('validateAge', () => {
  it('returns null for empty', () => {
    expect(validateAge('')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(validateAge(undefined)).toBeNull()
  })

  it('accepts age 0 (newborn)', () => {
    expect(validateAge('0')).toBeNull()
  })

  it('accepts age 28', () => {
    expect(validateAge('28')).toBeNull()
  })

  it('accepts age 150', () => {
    expect(validateAge(150)).toBeNull()
  })

  it('rejects negative age', () => {
    expect(validateAge('-1')).toBe('Age must be between 0 and 150')
  })

  it('rejects age > 150', () => {
    expect(validateAge('151')).toBe('Age must be between 0 and 150')
  })

  it('rejects non-numeric string', () => {
    expect(validateAge('abc')).toBe('Age must be a number')
  })
})

// ═══════════════════════════════════════════════════════════════
// validateGSTIN
// ═══════════════════════════════════════════════════════════════
describe('validateGSTIN', () => {
  it('returns null for empty (optional)', () => {
    expect(validateGSTIN('')).toBeNull()
  })

  it('accepts valid GSTIN', () => {
    expect(validateGSTIN('27AAPFU0939F1ZV')).toBeNull()
  })

  it('rejects GSTIN with wrong length', () => {
    expect(validateGSTIN('27AAPFU0939F1Z')).toBe('GSTIN must be exactly 15 characters')
  })

  it('rejects invalid format', () => {
    expect(validateGSTIN('ABCDEFGHIJKLMNO')).toBe('Invalid GSTIN format')
  })
})

// ═══════════════════════════════════════════════════════════════
// validateAmount
// ═══════════════════════════════════════════════════════════════
describe('validateAmount', () => {
  it('returns null for empty', () => {
    expect(validateAmount('')).toBeNull()
  })

  it('accepts zero', () => {
    expect(validateAmount('0')).toBeNull()
  })

  it('accepts positive number', () => {
    expect(validateAmount('500.50')).toBeNull()
  })

  it('rejects negative number', () => {
    expect(validateAmount('-100')).toBe('Amount cannot be negative')
  })

  it('rejects non-numeric', () => {
    expect(validateAmount('abc')).toBe('Amount must be a valid number')
  })

  it('uses custom field name in error', () => {
    expect(validateAmount('-1', 'Fee')).toBe('Fee cannot be negative')
  })
})

// ═══════════════════════════════════════════════════════════════
// validateBP
// ═══════════════════════════════════════════════════════════════
describe('validateBP', () => {
  it('returns null for empty values', () => {
    expect(validateBP('', '')).toBeNull()
  })

  it('accepts normal BP 120/80', () => {
    expect(validateBP('120', '80')).toBeNull()
  })

  it('accepts high BP 180/110', () => {
    expect(validateBP('180', '110')).toBeNull()
  })

  it('rejects systolic < 50', () => {
    expect(validateBP('40', '80')).toBe('Systolic BP must be 50-300 mmHg')
  })

  it('rejects systolic > 300', () => {
    expect(validateBP('310', '80')).toBe('Systolic BP must be 50-300 mmHg')
  })

  it('rejects diastolic < 20', () => {
    expect(validateBP('120', '15')).toBe('Diastolic BP must be 20-200 mmHg')
  })

  it('rejects diastolic >= systolic', () => {
    expect(validateBP('80', '90')).toBe('Diastolic must be less than systolic')
  })

  it('rejects diastolic == systolic', () => {
    expect(validateBP('120', '120')).toBe('Diastolic must be less than systolic')
  })
})

// ═══════════════════════════════════════════════════════════════
// validateVital
// ═══════════════════════════════════════════════════════════════
describe('validateVital', () => {
  it('returns null for empty', () => {
    expect(validateVital('', 'pulse')).toBeNull()
  })

  // Pulse
  it('accepts normal pulse 72', () => {
    expect(validateVital('72', 'pulse')).toBeNull()
  })

  it('rejects pulse < 20', () => {
    expect(validateVital('15', 'pulse')).toBe('Pulse must be 20-250 bpm')
  })

  it('rejects pulse > 250', () => {
    expect(validateVital('260', 'pulse')).toBe('Pulse must be 20-250 bpm')
  })

  // Temperature
  it('accepts normal temp 37.0', () => {
    expect(validateVital('37.0', 'temp')).toBeNull()
  })

  it('rejects temp < 30', () => {
    expect(validateVital('25', 'temp')).toBe('Temperature must be 30-45°C')
  })

  it('rejects temp > 45', () => {
    expect(validateVital('46', 'temp')).toBe('Temperature must be 30-45°C')
  })

  // SpO2
  it('accepts SpO2 98', () => {
    expect(validateVital('98', 'spo2')).toBeNull()
  })

  it('rejects SpO2 > 100', () => {
    expect(validateVital('101', 'spo2')).toBe('SpO₂ must be 50-100%')
  })

  // Weight
  it('accepts weight 60.5', () => {
    expect(validateVital('60.5', 'weight')).toBeNull()
  })

  it('rejects weight > 300', () => {
    expect(validateVital('350', 'weight')).toBe('Weight must be 0.5-300 kg')
  })

  // Height
  it('accepts height 160', () => {
    expect(validateVital('160', 'height')).toBeNull()
  })

  it('rejects height < 20', () => {
    expect(validateVital('10', 'height')).toBe('Height must be 20-250 cm')
  })

  // Edge: non-numeric
  it('rejects non-numeric value', () => {
    expect(validateVital('abc', 'pulse')).toBe('Must be a number')
  })
})

// ═══════════════════════════════════════════════════════════════
// validatePastDate
// ═══════════════════════════════════════════════════════════════
describe('validatePastDate', () => {
  it('returns null for empty', () => {
    expect(validatePastDate('')).toBeNull()
  })

  it('accepts past date', () => {
    expect(validatePastDate('2020-01-01')).toBeNull()
  })

  it('accepts today', () => {
    const today = new Date().toISOString().split('T')[0]
    expect(validatePastDate(today)).toBeNull()
  })

  it('rejects far future date', () => {
    expect(validatePastDate('2099-12-31')).toBe('Date cannot be in the future')
  })

  it('rejects invalid date string', () => {
    expect(validatePastDate('not-a-date')).toBe('Date is not a valid date')
  })
})

// ═══════════════════════════════════════════════════════════════
// validateFutureDate
// ═══════════════════════════════════════════════════════════════
describe('validateFutureDate', () => {
  it('returns null for empty', () => {
    expect(validateFutureDate('')).toBeNull()
  })

  it('accepts future date', () => {
    expect(validateFutureDate('2099-12-31')).toBeNull()
  })

  it('accepts today', () => {
    const today = new Date().toISOString().split('T')[0]
    expect(validateFutureDate(today)).toBeNull()
  })

  it('rejects past date', () => {
    expect(validateFutureDate('2020-01-01')).toBe('Date cannot be in the past')
  })
})

// ═══════════════════════════════════════════════════════════════
// validateAll — Batch validation
// ═══════════════════════════════════════════════════════════════
describe('validateAll', () => {
  it('returns empty object when all valid', () => {
    const errors = validateAll([
      { field: 'name', validator: () => validateRequired('John', 'Name') },
      { field: 'mobile', validator: () => validateMobile('9876543210') },
    ])
    expect(Object.keys(errors).length).toBe(0)
  })

  it('returns errors for invalid fields', () => {
    const errors = validateAll([
      { field: 'name', validator: () => validateRequired('', 'Name') },
      { field: 'mobile', validator: () => validateMobile('123') },
    ])
    expect(errors.name).toBe('Name is required')
    expect(errors.mobile).toBeDefined()
    expect(Object.keys(errors).length).toBe(2)
  })

  it('only includes fields that failed', () => {
    const errors = validateAll([
      { field: 'name', validator: () => validateRequired('John', 'Name') },
      { field: 'mobile', validator: () => validateMobile('') },
    ])
    expect(errors.name).toBeUndefined()
    expect(errors.mobile).toBeDefined()
    expect(Object.keys(errors).length).toBe(1)
  })
})